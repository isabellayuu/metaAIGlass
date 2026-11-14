import Foundation
import UIKit

/// Mirrors `ScanSchema` in server/schema.ts. Decoding is lenient: a missing
/// field falls back to an empty value so one odd model answer doesn't fail the scan.
struct Scan: Decodable, Sendable {
  var found: Bool
  var problemText: String
  var model: ScanModel
  var answer: String
  var steps: [ScanStep]

  enum CodingKeys: String, CodingKey {
    case found, model, answer, steps
    case problemText = "problem_text"
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    found = try c.decodeIfPresent(Bool.self, forKey: .found) ?? false
    problemText = try c.decodeIfPresent(String.self, forKey: .problemText) ?? ""
    model = try c.decodeIfPresent(ScanModel.self, forKey: .model) ?? ScanModel()
    answer = try c.decodeIfPresent(String.self, forKey: .answer) ?? ""
    steps = try c.decodeIfPresent([ScanStep].self, forKey: .steps) ?? []
  }
}

struct ScanModel: Decodable, Sendable {
  enum Kind: String, Decodable, Sendable {
    case rectangle, box, groups
    case numberLine = "number_line"
  }

  var kind: Kind = .rectangle
  var length: Double = 0
  var width: Double = 0
  var height: Double = 0
  var groups: Double = 0
  var perGroup: Double = 0
  var values: [Double] = []
  var unit: String = ""

  enum CodingKeys: String, CodingKey {
    case kind, length, width, height, groups, values, unit
    case perGroup = "per_group"
  }

  init() {}

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    kind = (try? c.decode(Kind.self, forKey: .kind)) ?? .rectangle
    length = try c.decodeIfPresent(Double.self, forKey: .length) ?? 0
    width = try c.decodeIfPresent(Double.self, forKey: .width) ?? 0
    height = try c.decodeIfPresent(Double.self, forKey: .height) ?? 0
    groups = try c.decodeIfPresent(Double.self, forKey: .groups) ?? 0
    perGroup = try c.decodeIfPresent(Double.self, forKey: .perGroup) ?? 0
    values = try c.decodeIfPresent([Double].self, forKey: .values) ?? []
    unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? ""
  }
}

/// Color role of a run of step text: the model part a quantity belongs to.
enum ColorRole: String, Decodable, Sendable {
  case none, length, width, height, total

  /// The shared palette (src/palette.ts).
  var uiColor: UIColor? {
    switch self {
    case .none: nil
    case .length: UIColor(hex: 0xFFA94D)
    case .width: UIColor(hex: 0x4DABF7)
    case .height: UIColor(hex: 0xF783AC)
    case .total: UIColor(hex: 0x69DB7C)
    }
  }
}

enum Highlight: String, Decodable, Sendable {
  case none, length, width, height, perimeter, area, volume, groups, total
}

struct TextRun: Decodable, Sendable {
  var t: String
  var color: ColorRole

  enum CodingKeys: String, CodingKey { case t, color }

  init(t: String, color: ColorRole) {
    self.t = t
    self.color = color
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    t = try c.decodeIfPresent(String.self, forKey: .t) ?? ""
    color = (try? c.decode(ColorRole.self, forKey: .color)) ?? .none
  }
}

struct ScanStep: Decodable, Sendable {
  var label: String
  var text: [TextRun]
  /// The step as a visual math strip: numbers and symbols only, e.g. 6 × 4 = ?
  var expression: [TextRun]
  /// Optional caption of a few words, shown only when picture and strip are not enough.
  var caption: String
  var highlight: Highlight

  enum CodingKeys: String, CodingKey { case label, text, expression, caption, highlight }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
    text = try c.decodeIfPresent([TextRun].self, forKey: .text) ?? []
    expression = try c.decodeIfPresent([TextRun].self, forKey: .expression) ?? []
    caption = (try c.decodeIfPresent(String.self, forKey: .caption) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    highlight = (try? c.decode(Highlight.self, forKey: .highlight)) ?? .none
  }

  /// The math strip to draw: the server's expression, or (from an older server)
  /// the step's color-coded quantities in order.
  var strip: [TextRun] {
    let pieces = expression.filter { !$0.t.trimmingCharacters(in: .whitespaces).isEmpty }
    return pieces.isEmpty ? coloredRuns : pieces
  }

  /// The step as one plain string (the glasses display has no text colors).
  var plainText: String {
    readableText.map(\.t).joined()
  }

  /// The text pieces with normal spacing between them, so joining them always
  /// reads as a sentence ("cost of" + "3" → "cost of 3"), even when a model
  /// leaves the spaces out. The server tidies text too (server/tidyText.ts).
  var readableText: [TextRun] {
    var out: [TextRun] = []
    for run in text {
      var t = run.t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
      if t.trimmingCharacters(in: .whitespaces).isEmpty {
        if let last = out.last, !last.t.hasSuffix(" ") { out[out.count - 1].t += " " }
        continue
      }
      if let last = out.last {
        if last.t.hasSuffix(" ") && t.hasPrefix(" ") {
          t.removeFirst()
        } else if !last.t.hasSuffix(" ") && !t.hasPrefix(" ") && Self.needsSpace(last.t, t) {
          t = " " + t
        }
      }
      out.append(TextRun(t: t, color: run.color))
    }
    if !out.isEmpty {
      out[0].t = String(out[0].t.drop { $0 == " " })
      while out[out.count - 1].t.hasSuffix(" ") { out[out.count - 1].t.removeLast() }
    }
    return out.filter { !$0.t.isEmpty }
  }

  /// True when the end of `a` and the start of `b` would run together.
  private static func needsSpace(_ a: String, _ b: String) -> Bool {
    guard let end = a.last, let start = b.first else { return false }
    if ".,;:!?)]%’'”".contains(start) || "([“‘$€£".contains(end) { return false }
    let joins = { (c: Character) in c.isLetter || c.isNumber || "=+×÷−".contains(c) }
    return (joins(end) || ")%²³".contains(end)) && (joins(start) || start == "(")
  }

  /// The color-coded quantities in this step, in order and without repeats.
  var coloredRuns: [TextRun] {
    var seen = Set<String>()
    return text.filter { run in
      let key = run.t.trimmingCharacters(in: .whitespaces)
      guard run.color != .none, !key.isEmpty else { return false }
      return seen.insert("\(run.color.rawValue)|\(key)").inserted
    }
  }
}

extension UIColor {
  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: alpha
    )
  }
}
