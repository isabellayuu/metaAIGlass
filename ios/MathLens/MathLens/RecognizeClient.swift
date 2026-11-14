import Foundation
import UIKit

/// Sends a glasses photo to the Math Lens server (POST /api/recognize).
/// The Gemini key lives on the server; the app only knows the server URL.
struct RecognizeClient: Sendable {
  static let defaultServer = "https://meta-ai-glass.vercel.app"

  var server: String

  enum Failure: LocalizedError {
    case badServerURL(String)
    case badImage
    case network(String)
    case server(Int, String)
    case badResponse

    var errorDescription: String? {
      switch self {
      case .badServerURL(let url): "Server address is not valid: \(url)"
      case .badImage: "Could not read the photo from the glasses."
      case .network(let message): "Network error: \(message)"
      case .server(let status, let message): "Server error \(status): \(message)"
      case .badResponse: "The server sent an answer the app could not read."
      }
    }
  }

  func recognize(jpeg: Data) async throws -> Scan {
    guard
      let base = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
      base.scheme == "https" || base.scheme == "http"
    else {
      throw Failure.badServerURL(server)
    }
    guard let body = Self.prepare(jpeg) else { throw Failure.badImage }

    var request = URLRequest(url: base.appending(path: "api/recognize"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.timeoutInterval = 60
    request.httpBody = try JSONSerialization.data(withJSONObject: ["image": body.base64EncodedString()])

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw Failure.network(error.localizedDescription)
    }

    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      let message =
        (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
        ?? HTTPURLResponse.localizedString(forStatusCode: status)
      throw Failure.server(status, message)
    }
    do {
      return try JSONDecoder().decode(Scan.self, from: data)
    } catch {
      throw Failure.badResponse
    }
  }

  /// Re-encodes the photo so the request stays well under Vercel's 4.5 MB body limit.
  private static func prepare(_ jpeg: Data) -> Data? {
    guard let image = UIImage(data: jpeg) else { return nil }
    let longest = max(image.size.width, image.size.height)
    let maxSide: CGFloat = 1600
    guard longest > maxSide || jpeg.count > 1_500_000 else { return jpeg }
    let k = min(1, maxSide / longest)
    let size = CGSize(width: (image.size.width * k).rounded(), height: (image.size.height * k).rounded())
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    return resized.jpegData(compressionQuality: 0.82)
  }
}
