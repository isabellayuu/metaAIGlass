import CoreImage
import CoreML
import Foundation
import ImageIO
import Vision

/// Blurs every face in a photo from the glasses before the photo leaves the phone.
///
/// The glasses camera sees whatever the wearer looks at, which can include
/// classmates, teachers or family. For their privacy Math Lens finds faces on
/// the phone with Apple's Vision framework and covers each one with a heavy
/// pixelate + blur, so faces are never sent to the server (or to Gemini) and
/// never shown in the app. Everything runs on the device.
///
/// Use cases:
/// - A photo from the real glasses camera (GlassesController.photoArrived).
/// - The simulated camera in debug builds goes through the same path.
///
/// Fail-closed: if the photo cannot be checked for faces, the caller gets an
/// error and the photo is not sent at all.
///
/// Only Vision, Core Image and ImageIO are used (no UIKit), so the same file
/// also builds on macOS for testing.
enum FaceBlur {
  struct Result: Sendable {
    /// The photo as JPEG, with faces blurred (or the original if there were none).
    let jpeg: Data
    /// How many faces were found and blurred.
    let faceCount: Int
  }

  enum Failure: LocalizedError {
    case unreadable
    case cannotEncode

    var errorDescription: String? {
      switch self {
      case .unreadable: "Could not read the photo to check it for faces."
      case .cannotEncode: "Could not save the photo after blurring faces."
      }
    }
  }

  /// Returns `jpeg` with every detected face blurred. Throws if face detection
  /// cannot run, so an unchecked photo is never passed on.
  static func blurFaces(in jpeg: Data) throws -> Result {
    guard let decoded = CIImage(data: jpeg, options: [.applyOrientationProperty: true]) else {
      throw Failure.unreadable
    }
    // Move the image to the origin so Vision's normalized boxes map directly.
    let image = decoded.transformed(
      by: CGAffineTransform(translationX: -decoded.extent.minX, y: -decoded.extent.minY)
    )
    let extent = image.extent

    let request = VNDetectFaceRectanglesRequest()
    #if targetEnvironment(simulator)
    // The Simulator has no Neural Engine; without this Vision fails with
    // "Could not create inference context". Real devices keep the default.
    if let cpu = try request.supportedComputeStageDevices[.main]?.first(where: {
      if case .cpu = $0 { true } else { false }
    }) {
      request.setComputeDevice(cpu, for: .main)
    }
    #endif
    try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
    let faces = request.results ?? []
    guard !faces.isEmpty else { return Result(jpeg: jpeg, faceCount: 0) }

    let blurred = heavyBlur(image)
    let mask = faceMask(faces.map(\.boundingBox), in: extent)
    let output = blurred.applyingFilter("CIBlendWithMask", parameters: [
      kCIInputBackgroundImageKey: image,
      kCIInputMaskImageKey: mask,
    ]).cropped(to: extent)

    let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
    guard let data = CIContext().jpegRepresentation(of: output, colorSpace: space, options: [quality: 0.85]) else {
      throw Failure.cannotEncode
    }
    return Result(jpeg: data, faceCount: faces.count)
  }

  /// Pixelates and blurs the whole image strongly enough that a face cannot be recognized.
  private static func heavyBlur(_ image: CIImage) -> CIImage {
    let side = max(image.extent.width, image.extent.height)
    return image.clampedToExtent()
      .applyingFilter("CIPixellate", parameters: [
        kCIInputScaleKey: max(8, side / 40),
        kCIInputCenterKey: CIVector(x: 0, y: 0),
      ])
      .applyingGaussianBlur(sigma: max(4, side / 100))
      .cropped(to: image.extent)
  }

  /// White soft-edged circles over each face (grown to cover hair and chin), black elsewhere.
  /// `boxes` are Vision's normalized rectangles (origin bottom-left, like Core Image).
  private static func faceMask(_ boxes: [CGRect], in extent: CGRect) -> CIImage {
    var mask = CIImage(color: CIColor.black).cropped(to: extent)
    for box in boxes {
      let rect = CGRect(
        x: box.minX * extent.width,
        y: box.minY * extent.height,
        width: box.width * extent.width,
        height: box.height * extent.height
      )
      let radius = max(rect.width, rect.height) * 0.85
      let circle = CIFilter(name: "CIRadialGradient", parameters: [
        "inputCenter": CIVector(x: rect.midX, y: rect.midY + rect.height * 0.1),
        "inputRadius0": radius * 0.9,
        "inputRadius1": radius,
        "inputColor0": CIColor.white,
        "inputColor1": CIColor.clear,
      ])?.outputImage?.cropped(to: extent)
      if let circle {
        mask = circle.composited(over: mask)
      }
    }
    return mask
  }
}
