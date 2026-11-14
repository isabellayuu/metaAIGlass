import UIKit

/// Draws one planned diagram (bar_compare, bar_split, scale_pair, before_after,
/// number_line) for the glasses picture, in the same style as the 3D models:
/// black background, the shared colors, large outlined text.
///
/// The model only plans the diagram (server/recognize.ts, the planner prompt);
/// this file decides how it looks, so every diagram stays simple:
/// - at most 3 bars (or 4 points), all on one scale, each with a short label
///   on the left and its value at the end;
/// - the unknown is a dashed green outline with "?" and never a length that
///   would give the answer away;
/// - derived values (common denominators, conversions) have a dotted outline;
/// - distractors are gray.
///
/// Use cases: every step of a supported problem (ModelRenderer.render calls
/// `draw` when the step has a diagram; older answers fall back to the 3D model).
enum DiagramRenderer {
  private static let labelWidth: CGFloat = 132
  private static let valueWidth: CGFloat = 112
  private static let labelPx: CGFloat = 25
  private static let valuePx: CGFloat = 28

  /// Draws `diagram` inside `area`.
  static func draw(_ diagram: Diagram, in ctx: CGContext, area: CGRect) {
    switch diagram.kind {
    case .barCompare: drawBars(diagram, in: ctx, area: area, arrows: false)
    case .beforeAfter: drawBars(diagram, in: ctx, area: area, arrows: true)
    case .scalePair: drawScalePair(diagram, in: ctx, area: area)
    case .barSplit: drawSplit(diagram, in: ctx, area: area)
    case .numberLine: drawNumberLine(diagram, in: ctx, area: area)
    }
  }

  // MARK: - Bars

  /// 2-3 bars on one scale, label on the left and value at the end.
  /// before_after adds an arrow between the bars and shows any change (e.g.
  /// "25% off") on it.
  private static func drawBars(_ d: Diagram, in ctx: CGContext, area: CGRect, arrows: Bool) {
    var bars = d.items
    var change: Diagram.Item?
    if arrows, bars.count == 3 {
      // before, change, after → the middle item labels the arrow.
      change = bars.remove(at: 1)
    }
    let scale = barScale(d, bars)
    let gap: CGFloat = arrows ? 46 : 16
    let barHeight = min(48, (area.height - gap * CGFloat(max(bars.count - 1, 0))) / CGFloat(max(bars.count, 1)))
    let totalHeight = barHeight * CGFloat(bars.count) + gap * CGFloat(max(bars.count - 1, 0))
    var y = area.midY - totalHeight / 2
    let x0 = area.minX + labelWidth
    let maxWidth = area.maxX - valueWidth - x0
    for (i, item) in bars.enumerated() {
      let rect = CGRect(x: x0, y: y, width: maxWidth, height: barHeight)
      drawBar(item, unit: d.unit, scale: scale, track: rect, total: d.total, ctx: ctx)
      drawLabel(item.label, color: color(of: item), leftOf: rect)
      if arrows, i < bars.count - 1 {
        let ay = y + barHeight + gap / 2
        let ax = x0 + 28
        arrow(from: CGPoint(x: ax, y: ay - gap / 2 + 4), to: CGPoint(x: ax, y: ay + gap / 2 - 4), color: .white, ctx: ctx)
        if let change {
          // The change by its own name ("25% off"), not as an amount in the bars' unit.
          let name = change.label.isEmpty ? text(for: change, unit: "") : change.label
          drawLeft(change.isUnknown ? "?" : name, color: color(of: change), size: labelPx, at: CGPoint(x: ax + 22, y: ay))
        }
      }
      y += barHeight + gap
    }
  }

  /// Two aligned bars: the second is the first × factor.
  private static func drawScalePair(_ d: Diagram, in ctx: CGContext, area: CGRect) {
    let bars = Array(d.items.prefix(2))
    let scale = barScale(d, bars)
    let barHeight: CGFloat = 46, gap: CGFloat = 40
    var y = area.midY - (barHeight * 2 + gap) / 2
    let x0 = area.minX + labelWidth
    let maxWidth = area.maxX - valueWidth - x0
    for (i, item) in bars.enumerated() {
      let rect = CGRect(x: x0, y: y, width: maxWidth, height: barHeight)
      drawBar(item, unit: d.unit, scale: scale, track: rect, total: d.total, ctx: ctx)
      drawLabel(item.label, color: color(of: item), leftOf: rect)
      if i == 0 {
        let label = d.factor.map { "× \(ModelRenderer.number($0))" } ?? "× ?"
        ModelRenderer.drawOutlined(label, color: ColorRole.height.uiColor!, size: labelPx,
                                   centeredAt: CGPoint(x: x0 + 44, y: y + barHeight + gap / 2))
      }
      y += barHeight + gap
    }
  }

  /// One whole bar in equal parts, the first `shaded` parts filled.
  private static func drawSplit(_ d: Diagram, in ctx: CGContext, area: CGRect) {
    let item = d.items.first
    let parts = max(1, d.parts)
    let shaded = min(d.shaded, parts)
    let height: CGFloat = 60
    let rect = CGRect(x: area.minX + 20, y: area.midY - height / 2 + 6, width: area.width - 40, height: height)
    let fill = item.map(color(of:)) ?? ColorRole.length.uiColor!
    let w = rect.width / CGFloat(parts)
    for i in 0..<parts {
      let r = CGRect(x: rect.minX + CGFloat(i) * w, y: rect.minY, width: w, height: rect.height).insetBy(dx: 2, dy: 0)
      let path = UIBezierPath(roundedRect: r, cornerRadius: 6)
      if i < shaded {
        ctx.setFillColor(fill.cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
      }
      ctx.setStrokeColor(fill.withAlphaComponent(i < shaded ? 1 : 0.7).cgColor)
      ctx.setLineWidth(3)
      ctx.addPath(path.cgPath)
      ctx.strokePath()
    }
    // What the whole bar is, above it; the shaded share under the shaded parts.
    if let item {
      let whole = item.isUnknown ? "\(item.label) = ?" : (d.unit.isEmpty ? item.label : "\(item.label): \(text(for: item, unit: d.unit))")
      ModelRenderer.drawOutlined(whole, color: fill, size: labelPx, centeredAt: CGPoint(x: rect.midX, y: rect.minY - 24))
    }
    if shaded > 0 {
      ModelRenderer.drawOutlined("\(shaded)/\(parts)", color: .white, size: labelPx,
                                 centeredAt: CGPoint(x: rect.minX + w * CGFloat(shaded) / 2, y: rect.maxY + 24))
    }
  }

  // MARK: - Number line

  /// A line from start to end with 2-4 marked points; the unknown is a "?"
  /// at the end of the line, never at the answer's position.
  private static func drawNumberLine(_ d: Diagram, in ctx: CGContext, area: CGRect) {
    let known = d.items.filter { !$0.isUnknown }
    var lo = d.start, hi = d.end
    if hi <= lo {
      lo = min(0, known.compactMap(\.value).min() ?? 0)
      hi = max(lo + 1, known.compactMap(\.value).max() ?? 1)
    }
    let y = area.midY + 22
    let x0 = area.minX + 30, x1 = area.maxX - 70
    let px = { (v: Double) in x0 + CGFloat((v - lo) / (hi - lo)) * (x1 - x0) }
    ctx.setStrokeColor(UIColor(white: 0.85, alpha: 1).cgColor)
    ctx.setLineWidth(3)
    ctx.strokeLineSegments(between: [CGPoint(x: x0 - 10, y: y), CGPoint(x: x1 + 10, y: y)])
    for v in [lo, hi] {
      ctx.strokeLineSegments(between: [CGPoint(x: px(v), y: y - 10), CGPoint(x: px(v), y: y + 10)])
      ModelRenderer.drawOutlined(ModelRenderer.number(v), color: UIColor(white: 0.85, alpha: 1), size: 20,
                                 centeredAt: CGPoint(x: px(v), y: y + 28))
    }
    // Known points, labels alternating above and below so they never overlap.
    for (i, item) in known.enumerated() {
      guard let v = item.value else { continue }
      let c = color(of: item)
      let p = CGPoint(x: px(min(max(v, lo), hi)), y: y)
      ctx.setFillColor(c.cgColor)
      ctx.fillEllipse(in: CGRect(x: p.x - 9, y: p.y - 9, width: 18, height: 18))
      let up = i % 2 == 0
      let name = item.label.isEmpty ? ModelRenderer.number(v) : "\(item.label) \(ModelRenderer.number(v))"
      ModelRenderer.drawOutlined(name, color: c, size: labelPx, centeredAt: CGPoint(x: p.x, y: y + (up ? -34 : 58)))
    }
    if d.items.contains(where: \.isUnknown) {
      ModelRenderer.drawOutlined("?", color: ColorRole.total.uiColor!, size: 40, centeredAt: CGPoint(x: x1 + 44, y: y))
    }
  }

  // MARK: - Pieces

  /// The value that fills the widest bar.
  private static func barScale(_ d: Diagram, _ bars: [Diagram.Item]) -> Double {
    max(d.total ?? 0, bars.compactMap(\.value).map(abs).max() ?? 0, 1e-9)
  }

  /// One bar: a faint track for the whole (when there is a total), the value
  /// as a filled bar, or the unknown as a dashed outline with "?".
  private static func drawBar(_ item: Diagram.Item, unit: String, scale: Double, track: CGRect, total: Double?, ctx: CGContext) {
    let c = color(of: item)
    if total != nil {
      let path = UIBezierPath(roundedRect: track, cornerRadius: 8)
      ctx.setStrokeColor(UIColor(white: 0.35, alpha: 1).cgColor)
      ctx.setLineWidth(2)
      ctx.addPath(path.cgPath)
      ctx.strokePath()
    }
    if item.isUnknown {
      // Same length as the track: the bar never shows how big the answer is.
      let path = UIBezierPath(roundedRect: track, cornerRadius: 8)
      ctx.saveGState()
      ctx.setLineDash(phase: 0, lengths: [10, 7])
      ctx.setStrokeColor(c.cgColor)
      ctx.setLineWidth(4)
      ctx.addPath(path.cgPath)
      ctx.strokePath()
      ctx.restoreGState()
      ModelRenderer.drawOutlined("?", color: c, size: 36, centeredAt: CGPoint(x: track.midX, y: track.midY))
      return
    }
    let share = CGFloat(min(1, abs(item.value ?? 0) / scale))
    let rect = CGRect(x: track.minX, y: track.minY, width: max(track.width * share, 6), height: track.height)
    let path = UIBezierPath(roundedRect: rect, cornerRadius: 8)
    ctx.setFillColor(c.withAlphaComponent(item.derived ? 0.35 : 0.9).cgColor)
    ctx.addPath(path.cgPath)
    ctx.fillPath()
    if item.derived {
      ctx.saveGState()
      ctx.setLineDash(phase: 0, lengths: [3, 5])
      ctx.setStrokeColor(c.cgColor)
      ctx.setLineWidth(3)
      ctx.addPath(path.cgPath)
      ctx.strokePath()
      ctx.restoreGState()
    }
    drawLeft(text(for: item, unit: unit), color: c, size: valuePx,
             at: CGPoint(x: max(rect.maxX, track.minX + 6) + 12, y: track.midY), maxWidth: track.maxX + valueWidth - rect.maxX - 16)
  }

  /// The short label to the left of a bar, shrunk to fit its column.
  private static func drawLabel(_ label: String, color: UIColor, leftOf bar: CGRect) {
    // A fraction label is already shown at the end of its bar.
    guard !label.isEmpty, label != "?", !label.contains("/") else { return }
    var size = labelPx
    while size > 14, NSAttributedString(string: label, attributes: [.font: UIFont.systemFont(ofSize: size, weight: .bold)]).size().width > labelWidth - 14 {
      size -= 1
    }
    let width = NSAttributedString(string: label, attributes: [.font: UIFont.systemFont(ofSize: size, weight: .bold)]).size().width
    ModelRenderer.drawOutlined(label, color: color, size: size, centeredAt: CGPoint(x: bar.minX - 10 - width / 2, y: bar.midY))
  }

  /// A value with its unit: "€80", "25%", "2 cups".
  private static func text(for item: Diagram.Item, unit: String) -> String {
    guard let v = item.value else { return "?" }
    // A fraction is easier to read as 3/4 than as 0.75.
    if unit.isEmpty, item.label.contains("/") { return item.label }
    let n = ModelRenderer.number(v)
    if unit.isEmpty { return n }
    if ["€", "$", "£"].contains(unit) { return unit + n }
    if unit == "%" { return n + "%" }
    return "\(n) \(unit)"
  }

  /// The item's color: its planned color, gray for distractors, green for the unknown.
  private static func color(of item: Diagram.Item) -> UIColor {
    if item.isUnknown { return ColorRole.total.uiColor! }
    if item.role == .distractor { return UIColor(white: 0.55, alpha: 1) }
    return item.color.uiColor ?? ColorRole.length.uiColor!
  }

  /// Outlined text starting at `at` (vertically centred), shrunk to `maxWidth`.
  private static func drawLeft(_ text: String, color: UIColor, size: CGFloat, at: CGPoint, maxWidth: CGFloat = .infinity) {
    var size = size
    func width(_ s: CGFloat) -> CGFloat {
      NSAttributedString(string: text, attributes: [.font: UIFont.systemFont(ofSize: s, weight: .bold)]).size().width
    }
    while size > 14, width(size) > maxWidth { size -= 1 }
    ModelRenderer.drawOutlined(text, color: color, size: size, centeredAt: CGPoint(x: at.x + width(size) / 2, y: at.y))
  }

  private static func arrow(from a: CGPoint, to b: CGPoint, color: UIColor, ctx: CGContext) {
    ctx.setStrokeColor(color.cgColor)
    ctx.setLineWidth(3)
    ctx.setLineCap(.round)
    ctx.strokeLineSegments(between: [a, b, b, CGPoint(x: b.x - 7, y: b.y - 8), b, CGPoint(x: b.x + 7, y: b.y - 8)])
  }
}
