#if DEBUG
import MWDATCore
import MWDATMockDevice
import Observation
import UIKit

/// Simulated Meta Ray-Ban Display glasses (debug builds only), so the whole
/// flow can run in the iOS Simulator: the photo is a generated picture of a
/// word problem and the display renders inside the app.
@Observable
@MainActor
final class SimulatedGlasses {
  private(set) var display: (any MockDisplayKit)?
  @ObservationIgnored private var device: (any MockGlasses)?

  var isOn: Bool { device != nil }

  enum SetupError: LocalizedError {
    case missingFeed
    var errorDescription: String? { "MockCameraFeed.mp4 is missing from the app bundle." }
  }

  /// Pairs mock glasses that are already registered and allowed to use the camera.
  func turnOn(problem: String) async throws {
    guard device == nil else { return }
    // The stream needs an H.265 video feed or it fails as soon as it starts.
    // The Simulator cannot encode H.265, so a short clip ships with debug builds;
    // the photo itself comes from `setCapturedImage`.
    guard let feed = Bundle.main.url(forResource: "MockCameraFeed", withExtension: "mp4") else {
      throw SetupError.missingFeed
    }
    let kit = MockDeviceKit.shared
    kit.enable(config: MockDeviceKitConfig(initiallyRegistered: true, initialPermissionsGranted: true))
    let glasses = try kit.pairGlasses(model: .metaRayBanDisplay)
    glasses.powerOn()
    glasses.unfold()
    glasses.don()
    glasses.services.camera.setCameraFeed(fileURL: feed)
    glasses.services.camera.setCapturedImage(fileURL: try Self.problemImage(problem))
    device = glasses
    display = glasses.services.display
  }

  func turnOff() async {
    guard let device else { return }
    await MockDeviceKit.shared.unpairDevice(device)
    await MockDeviceKit.shared.disable()
    self.device = nil
    display = nil
  }

  /// A photo-like picture of a printed word problem, written to a temp file.
  static func problemImage(_ text: String) throws -> URL {
    let size = CGSize(width: 1008, height: 1792)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      UIColor(white: 0.93, alpha: 1).setFill()
      UIRectFill(CGRect(origin: .zero, size: size))
      let style = NSMutableParagraphStyle()
      style.lineSpacing = 10
      NSAttributedString(string: text, attributes: [
        .font: UIFont.systemFont(ofSize: 64, weight: .medium),
        .foregroundColor: UIColor(white: 0.1, alpha: 1),
        .paragraphStyle: style,
      ]).draw(in: CGRect(x: 90, y: 600, width: size.width - 180, height: 700))
    }
    let url = FileManager.default.temporaryDirectory.appending(path: "mock-problem.jpg")
    try image.jpegData(compressionQuality: 0.9)?.write(to: url)
    return url
  }
}
#endif
