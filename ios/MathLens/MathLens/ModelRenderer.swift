import UIKit

/// Draws one solution step as a picture for the glasses display: progress
/// dots, the color-coded 3D model, and the step's math strip (e.g. 6 × 4 = ?).
///
/// NumLens is visual first: the picture and the strip carry the step, so the
/// glasses show few or no words. The model is a port of `buildModel` /
/// `drawModel` in src/ar/arStage.ts (boxes, balls and labels, orthographic
/// projection, far faces first). Colors live in the picture because text on
/// the glasses display can only be white or gray. The background is black,
/// which is see-through on the glasses.
enum ModelRenderer {
  static let size = CGSize(width: 600, height: 340)
  private static let dotsBand: CGFloat = 36
  private static let stripBand: CGFloat = 88

  /// Draws step `index` of `count`. The final answer is never drawn: where
  /// the result would go, the model and the strip show "?".
  static func render(scan: Scan, step: ScanStep, index: Int, count: Int) -> UIImage {
    let model = buildModel(scan: scan, highlight: step.highlight)
    let strip = step.strip
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      let ctx = context.cgContext
      UIColor.black.setFill()
      ctx.fill(CGRect(origin: .zero, size: size))

      drawDots(index: index, count: count, in: ctx)
      let top = dotsBand
      let bottom = strip.isEmpty ? size.height : size.height - stripBand
      let tilt = scan.model.kind == .numberLine ? (x: 0.2, y: -0.15) : (x: 0.55, y: -0.6)
      // Measure the drawn model and fit it, centred, into the space between
      // the dots and the strip, whatever its shape (wide number line, tall box…).
      let area = CGRect(x: 16, y: top, width: size.width - 32, height: bottom - top)
      if scan.model.kind == .numberLine {
        drawNumberLine(scan.model.values, highlight: step.highlight, in: ctx, area: area.insetBy(dx: 14, dy: 4))
      } else {
        // Leave room for the fixed-size labels around the model.
        let (origin, scale) = fit(model, rx: tilt.x, ry: tilt.y, into: area.insetBy(dx: 40, dy: 22))
        draw(model, in: ctx, origin: origin, scale: scale, rx: tilt.x, ry: tilt.y)
      }
      if !strip.isEmpty {
        drawStrip(strip, in: ctx, band: CGRect(x: 0, y: bottom, width: size.width, height: stripBand))
      }
    }
  }

  /// Progress as dots (filled up to the current step) instead of "4/5".
  private static func drawDots(index: Int, count: Int, in ctx: CGContext) {
    guard count > 1 else { return }
    for i in 0..<count {
      let rect = CGRect(x: 20 + CGFloat(i) * 26, y: 14, width: 14, height: 14)
      ctx.setFillColor((i <= index ? UIColor.white : UIColor(white: 0.35, alpha: 1)).cgColor)
      ctx.fillEllipse(in: rect)
    }
  }

  // MARK: - Model

  private enum Role { case length, width, height, total, perimeter, area }

  private static func activeRoles(_ h: Highlight) -> Set<Role> {
    switch h {
    case .length: [.length]
    case .width: [.length, .width]
    case .height: [.length, .width, .height]
    case .perimeter: [.perimeter]
    case .area: [.length, .width, .area]
    case .groups: [.width]
    case .volume, .total: [.total]
    case .none: []
    }
  }

  private typealias Vec3 = SIMD3<Double>

  private enum Prim {
    case box(c: Vec3, s: Vec3, color: UIColor, bright: Bool)
    case ball(c: Vec3, r: Double, color: UIColor, bright: Bool)
    /// `size` is in pixels: labels keep a readable size whatever the model's scale.
    case label(c: Vec3, text: String, color: UIColor, size: Double)
  }

  /// Label sizes in pixels.
  private static let labelPx = 30.0
  private static let resultPx = 46.0

  /// Above these sizes a picture would be too busy on the glasses, so it is
  /// simplified: no grid of tiles or cubes (just outlines and lengths), one
  /// plate with "× groups", or a number instead of many balls.
  private static let maxTiles = 60.0
  private static let maxCubes = 36.0
  private static let maxPlates = 6
  private static let maxBallsPerPlate = 12

  private struct Model {
    var prims: [Prim]
    var extent: Double
  }

  private static let dim = UIColor(hex: 0x8A8A8A)
  private static let lengthColor = ColorRole.length.uiColor!
  private static let widthColor = ColorRole.width.uiColor!
  private static let heightColor = ColorRole.height.uiColor!
  private static let totalColor = ColorRole.total.uiColor!

  private final class Builder {
    var prims: [Prim] = []
    var offset = Vec3(0, 0, 0)
    func box(_ w: Double, _ h: Double, _ d: Double, _ color: UIColor, _ bright: Bool, _ c: Vec3 = .zero) {
      prims.append(.box(c: c + offset, s: Vec3(w, h, d), color: color, bright: bright))
    }
    func ball(_ r: Double, _ color: UIColor, _ bright: Bool, _ c: Vec3) {
      prims.append(.ball(c: c + offset, r: r, color: color, bright: bright))
    }
    func label(_ text: String, _ color: UIColor, _ size: Double, _ c: Vec3) {
      prims.append(.label(c: c + offset, text: text, color: color, size: size))
    }
  }

  private static func num(_ n: Double) -> String {
    n == n.rounded() && abs(n) < 1e12 ? String(Int(n)) : String(n)
  }

  private static func fmt(_ n: Double, _ unit: String) -> String {
    unit.isEmpty ? num(n) : "\(num(n)) \(unit)"
  }

  private static func isInt(_ n: Double) -> Bool { n == n.rounded() }

  private static func buildModel(scan: Scan, highlight h: Highlight) -> Model {
    let m = scan.model
    let roles = activeRoles(h)
    let g = Builder()
    let unit = m.unit

    switch m.kind {
    case .rectangle, .box:
      let L = max(1, m.length)
      let W = max(1, m.width)
      let H = m.kind == .box ? max(1, m.height) : 0
      let extent = max(L, W, H)
      let t = extent * 0.035
      let ls = extent * 0.2
      let total = roles.contains(.total) || roles.contains(.perimeter)
      let lColor = total ? totalColor : lengthColor
      let wColor = total ? totalColor : widthColor
      let lOn = total || roles.contains(.length)
      let wOn = total || roles.contains(.width)
      let hOn = total || roles.contains(.height)

      if m.kind == .rectangle {
        g.box(L, t * 0.5, W, dim, false)
        if roles.contains(.area), isInt(L), isInt(W), L * W <= maxTiles {
          for i in 0..<Int(L) {
            for j in 0..<Int(W) {
              g.box(0.86, t * 0.6, 0.86, totalColor, true,
                    Vec3(-L / 2 + Double(i) + 0.5, t * 0.6, -W / 2 + Double(j) + 0.5))
            }
          }
        }
      } else if isInt(L), isInt(W), isInt(H), L * W * H <= maxCubes {
        for i in 0..<Int(L) {
          for j in 0..<Int(W) {
            for k in 0..<Int(H) {
              let on = roles.contains(.total) || (roles.contains(.area) && k == 0)
              g.box(0.92, 0.92, 0.92, on ? totalColor : dim, on,
                    Vec3(-L / 2 + Double(i) + 0.5, Double(k) + 0.5, -W / 2 + Double(j) + 0.5))
            }
          }
        }
      } else {
        let on = roles.contains(.total)
        g.box(L, H, W, on ? totalColor : dim, on, Vec3(0, H / 2, 0))
      }

      // Colored edges: two length edges, two width edges, one height edge.
      let y = m.kind == .box ? 0 : t
      for z in [-W / 2, W / 2] {
        g.box(L + t, t, t, lOn ? lColor : dim, lOn, Vec3(0, y, z))
      }
      for x in [-L / 2, L / 2] {
        g.box(t, t, W + t, wOn ? wColor : dim, wOn, Vec3(x, y, 0))
      }
      if H > 0 {
        g.box(t, H, t, hOn ? (total ? totalColor : heightColor) : dim, hOn, Vec3(L / 2, H / 2, W / 2))
      }
      if lOn && !total {
        g.label(fmt(m.length, unit), lengthColor, labelPx, Vec3(0, y + ls * 0.6, W / 2 + ls * 0.7))
      }
      if wOn && !total {
        g.label(fmt(m.width, unit), widthColor, labelPx, Vec3(L / 2 + ls * 1.2, y + ls * 0.6, 0))
      }
      if hOn && H > 0 && !total {
        g.label(fmt(m.height, unit), heightColor, labelPx, Vec3(L / 2 + ls * 1.4, H * 0.85, W / 2))
      }
      if total {
        g.label("?", totalColor, resultPx, Vec3(0, max(H, t) + ls * 1.2, 0))
      }
      return Model(prims: g.prims, extent: extent * 1.4)

    case .groups:
      let groups = max(1, Int(m.groups.rounded()))
      let items = max(1, Int(m.perGroup.rounded()))
      // Many groups: one plate and "× groups". Many items: a number on the plate.
      let G = groups <= maxPlates ? groups : 1
      let N = items <= maxBallsPerPlate ? items : 0
      let cols = Int(Double(max(N, 1)).squareRoot().rounded(.up))
      let plate = Double(cols) + 0.6
      let perRow = min(G, 4)
      let total = roles.contains(.total)
      let itemsOn = total || roles.contains(.length)
      let platesOn = roles.contains(.width)
      g.offset = Vec3(0, 0, -Double((G - 1) / perRow) * (plate + 0.8) * 0.5)
      for gi in 0..<G {
        let gx = Double(gi % perRow) * (plate + 0.8) - Double(perRow - 1) * (plate + 0.8) / 2
        let gz = Double(gi / perRow) * (plate + 0.8)
        g.box(plate, 0.15, plate, platesOn ? widthColor : dim, platesOn, Vec3(gx, 0, gz))
        if platesOn && !total && G > 1 {
          g.label("\(gi + 1)", widthColor, labelPx, Vec3(gx, 0, gz + plate / 2 + 0.7))
        }
        if N == 0 {
          g.label("\(items)", total ? totalColor : lengthColor, labelPx, Vec3(gx, 0.5, gz))
        }
        for n in 0..<N {
          // Apples stay orange even when another part is highlighted, so it is
          // always clear what lies on the plates.
          g.ball(0.36, total ? totalColor : lengthColor, itemsOn || total, Vec3(
            gx - Double(cols - 1) / 2 + Double(n % cols),
            0.45,
            gz - Double(cols - 1) / 2 + Double(n / cols)
          ))
        }
      }
      let width = Double(perRow) * (plate + 0.8)
      let ls = width * 0.14
      if G < groups {
        g.label("× \(groups)", widthColor, labelPx, Vec3(plate / 2 + 1.6, 0.3, 0))
      }
      if total {
        g.label("?", totalColor, resultPx, Vec3(0, ls * 2, 0))
      }
      return Model(prims: g.prims, extent: width)

    case .numberLine:
      // One bar per quantity, laid end to end; subtraction steps back.
      let values = m.values.isEmpty ? [0] : m.values
      let sum = values.reduce(0, +)
      let span = max(
        1,
        values.map(abs).max() ?? 0,
        abs(sum),
        values.reduce(0) { $0 + abs($1) } * 0.6
      )
      let scale = 10 / span
      let bar = 0.6
      var cur = 0.0
      var lo = 0.0
      var hi = 0.0
      for (i, v) in values.enumerated() {
        let color = i == 0 ? lengthColor : widthColor
        let on = roles.contains(.total) ? false : i == 0 ? roles.contains(.length) : roles.contains(.width)
        let start = cur * scale
        let end = (cur + v) * scale
        let rowY = v < 0 ? bar * 3 : 0
        g.box(max(0.05, abs(v) * scale), bar, bar, color, on || h == .none, Vec3((start + end) / 2, rowY, 0))
        let text = v < 0 ? "− \(num(abs(v)))" : i == 0 ? num(v) : "+ \(num(v))"
        g.label(text, color, labelPx, Vec3((start + end) / 2, rowY + 1.3, 0))
        cur += v
        lo = min(lo, cur * scale)
        hi = max(hi, cur * scale)
      }
      if roles.contains(.total) {
        g.box(max(0.05, abs(sum) * scale), bar, bar, totalColor, true, Vec3(sum * scale / 2, -bar * 1.6, 0))
        g.label("?", totalColor, resultPx, Vec3(sum * scale / 2, -bar * 1.6 - 1.5, 0))
      }
      // Centre the line horizontally.
      let shift = Vec3((lo + hi) / 2, 0, 0)
      let prims = g.prims.map { p -> Prim in
        switch p {
        case let .box(c, s, color, bright): .box(c: c - shift, s: s, color: color, bright: bright)
        case let .ball(c, r, color, bright): .ball(c: c - shift, r: r, color: color, bright: bright)
        case let .label(c, text, color, size): .label(c: c - shift, text: text, color: color, size: size)
        }
      }
      return Model(prims: prims, extent: max(4, hi - lo) * 1.1)
    }
  }

  // MARK: - Drawing

  /// Light direction (towards the viewer, up and right), normalised.
  private static let light: Vec3 = {
    let v = Vec3(0.3, 0.6, 0.75)
    return v / (v * v).sum().squareRoot()
  }()

  /// Box faces: corner indices (bit 0 = +x, bit 1 = +y, bit 2 = +z) and outward normal.
  private static let faces: [([Int], Vec3)] = [
    ([1, 3, 7, 5], Vec3(1, 0, 0)),
    ([0, 4, 6, 2], Vec3(-1, 0, 0)),
    ([2, 6, 7, 3], Vec3(0, 1, 0)),
    ([0, 1, 5, 4], Vec3(0, -1, 0)),
    ([4, 5, 7, 6], Vec3(0, 0, 1)),
    ([0, 2, 3, 1], Vec3(0, 0, -1)),
  ]

  private static func shade(_ color: UIColor, _ k: Double, _ alpha: Double) -> UIColor {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    let f = { (c: CGFloat) in min(1, c * k) }
    return UIColor(red: f(r), green: f(g), blue: f(b), alpha: alpha)
  }

  private enum Drawable {
    case polygon([CGPoint], fill: UIColor, stroke: UIColor)
    case ball(CGPoint, radius: CGFloat, color: UIColor, alpha: Double)
  }

  /// Rotation about Y, then X: tilts the model so its top face shows.
  private static func rotator(_ rx: Double, _ ry: Double) -> (Vec3) -> Vec3 {
    let (cx, sx, cy, sy) = (cos(rx), sin(rx), cos(ry), sin(ry))
    return { v in
      let x1 = v.x * cy + v.z * sy
      let z1 = -v.x * sy + v.z * cy
      return Vec3(x1, v.y * cx - z1 * sx, v.y * sx + z1 * cx)
    }
  }

  /// Origin and scale that fit the whole drawn model (boxes, balls and
  /// labels) into `rect`, centred.
  private static func fit(_ model: Model, rx: Double, ry: Double, into rect: CGRect) -> (CGPoint, Double) {
    let rot = rotator(rx, ry)
    var minX = Double.infinity, maxX = -Double.infinity, minY = Double.infinity, maxY = -Double.infinity
    func add(_ x: Double, _ y: Double) {
      minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    }
    for p in model.prims {
      switch p {
      case let .box(c, s, _, _):
        for i in 0..<8 {
          let v = rot(Vec3(
            c.x + (i & 1 != 0 ? 0.5 : -0.5) * s.x,
            c.y + (i & 2 != 0 ? 0.5 : -0.5) * s.y,
            c.z + (i & 4 != 0 ? 0.5 : -0.5) * s.z
          ))
          add(v.x, v.y)
        }
      case let .ball(c, r, _, _):
        let v = rot(c)
        add(v.x - r, v.y - r)
        add(v.x + r, v.y + r)
      case let .label(c, _, _, _):
        // Fixed pixel size: render() leaves room for the text around the model.
        let v = rot(c)
        add(v.x, v.y)
      }
    }
    guard minX.isFinite, maxX > minX || maxY > minY else {
      return (CGPoint(x: rect.midX, y: rect.midY), 1)
    }
    let scale = min(rect.width / max(maxX - minX, 0.01), rect.height / max(maxY - minY, 0.01)) * 0.92
    let origin = CGPoint(
      x: rect.midX - (minX + maxX) / 2 * scale,
      y: rect.midY + (minY + maxY) / 2 * scale
    )
    return (origin, scale)
  }

  private static func draw(_ model: Model, in ctx: CGContext, origin: CGPoint, scale: Double, rx: Double, ry: Double) {
    let rot = rotator(rx, ry)
    let project = { (v: Vec3) in CGPoint(x: origin.x + v.x * scale, y: origin.y - v.y * scale) }

    var items: [(z: Double, item: Drawable)] = []
    var labels: [(at: CGPoint, text: String, color: UIColor, px: Double)] = []

    for p in model.prims {
      switch p {
      case let .box(c, s, color, bright):
        let corners = (0..<8).map { i in
          rot(Vec3(
            c.x + (i & 1 != 0 ? 0.5 : -0.5) * s.x,
            c.y + (i & 2 != 0 ? 0.5 : -0.5) * s.y,
            c.z + (i & 4 != 0 ? 0.5 : -0.5) * s.z
          ))
        }
        let alpha = bright ? 1 : 0.5
        for (idx, normal) in faces {
          let n = rot(normal)
          if n.z <= 0 { continue }  // facing away from the viewer
          let pts = idx.map { corners[$0] }
          let lit = 0.55 + 0.45 * max(0, (n * light).sum())
          let fill = shade(color, lit * (bright ? 1.05 : 0.9), alpha)
          let stroke = bright ? UIColor(white: 1, alpha: 0.55) : shade(color, 1, 0.4)
          let z = pts.reduce(0) { $0 + $1.z } / 4
          items.append((z, .polygon(pts.map(project), fill: fill, stroke: stroke)))
        }
      case let .ball(c, r, color, bright):
        let center = rot(c)
        items.append((center.z, .ball(project(center), radius: r * scale, color: color, alpha: bright ? 1 : 0.5)))
      case let .label(c, text, color, size):
        labels.append((project(rot(c)), text, color, size))
      }
    }

    items.sort { $0.z < $1.z }
    ctx.setLineWidth(max(1, scale * 0.02))
    ctx.setLineJoin(.round)
    let space = CGColorSpaceCreateDeviceRGB()
    for (_, item) in items {
      switch item {
      case let .polygon(pts, fill, stroke):
        ctx.beginPath()
        ctx.addLines(between: pts)
        ctx.closePath()
        ctx.setFillColor(fill.cgColor)
        ctx.setStrokeColor(stroke.cgColor)
        ctx.drawPath(using: .fillStroke)
      case let .ball(at, r, color, alpha):
        ctx.saveGState()
        ctx.addEllipse(in: CGRect(x: at.x - r, y: at.y - r, width: r * 2, height: r * 2))
        ctx.clip()
        let colors = [shade(color, 1.35, alpha).cgColor, shade(color, 0.75, alpha).cgColor] as CFArray
        if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
          ctx.drawRadialGradient(
            gradient,
            startCenter: CGPoint(x: at.x - r * 0.35, y: at.y - r * 0.35), startRadius: r * 0.1,
            endCenter: at, endRadius: r,
            options: [.drawsAfterEndLocation]
          )
        }
        ctx.restoreGState()
      }
    }

    // Labels face the viewer and sit on top, outlined so they read over anything.
    for label in labels {
      let px = label.px
      drawOutlined(label.text, color: label.color, size: px, centeredAt: label.at)
    }
  }

  private static func drawOutlined(_ text: String, color: UIColor, size: CGFloat, centeredAt p: CGPoint) {
    let font = UIFont.systemFont(ofSize: size, weight: .bold)
    let outline = NSAttributedString(string: text, attributes: [
      .font: font, .strokeColor: UIColor(white: 0, alpha: 0.85), .strokeWidth: 18,
    ])
    let fill = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    let s = fill.size()
    let at = CGPoint(x: p.x - s.width / 2, y: p.y - s.height / 2)
    outline.draw(at: at)
    fill.draw(at: at)
  }

  // MARK: - Number line

  /// Addition and subtraction as jumps along a real number line: the first
  /// quantity is an orange jump from 0, every later one a blue jump (forward
  /// above the line, backward below it), and the landing point is a green "?".
  /// Only 0 is labelled on the line, so no tick gives the answer away.
  private static func drawNumberLine(_ raw: [Double], highlight h: Highlight, in ctx: CGContext, area: CGRect) {
    let values = raw.isEmpty ? [0] : raw
    let roles = activeRoles(h)
    var points = [0.0]
    for v in values { points.append(points.last! + v) }
    let lo = min(0, points.min()!), hi = max(points.max()!, lo + 1)
    let hasBack = values.dropFirst().contains { $0 < 0 }
    let axisY = area.minY + area.height * (hasBack ? 0.5 : 0.72)
    let x0 = area.minX + 20, x1 = area.maxX - 20
    let px = { (v: Double) in x0 + (v - lo) / (hi - lo) * (x1 - x0) }

    // The line and its ticks.
    ctx.setStrokeColor(UIColor(white: 0.85, alpha: 1).cgColor)
    ctx.setLineWidth(3)
    ctx.strokeLineSegments(between: [CGPoint(x: x0 - 12, y: axisY), CGPoint(x: x1 + 12, y: axisY)])
    let span = hi - lo
    let step = span <= 30 ? 1.0 : (span / 20).rounded(.up)
    var tick = (lo / step).rounded(.up) * step
    ctx.setLineWidth(2)
    while tick <= hi + 1e-9 {
      let big = tick == 0
      ctx.strokeLineSegments(between: [CGPoint(x: px(tick), y: axisY - (big ? 12 : 7)), CGPoint(x: px(tick), y: axisY + (big ? 12 : 7))])
      tick += step
    }
    drawOutlined("0", color: UIColor(white: 0.85, alpha: 1), size: 24, centeredAt: CGPoint(x: px(0), y: axisY + (hasBack ? -26 : 28)))

    // One jump per quantity.
    let maxUp = axisY - area.minY - 40, maxDown = area.maxY - axisY - 34
    let biggest = max(values.map(abs).max() ?? 1, 1)
    for (i, v) in values.enumerated() {
      let color = i == 0 ? lengthColor : widthColor
      let on = h == .none || roles.contains(.total) || (i == 0 ? roles.contains(.length) : roles.contains(.width))
      let a = CGPoint(x: px(points[i]), y: axisY), b = CGPoint(x: px(points[i + 1]), y: axisY)
      let down = i > 0 && v < 0
      let height = down ? min(maxDown * 0.45, 34) : maxUp * (0.45 + 0.55 * abs(v) / biggest)
      let peak = CGPoint(x: (a.x + b.x) / 2, y: axisY + (down ? height : -height))
      let path = UIBezierPath()
      path.move(to: a)
      path.addQuadCurve(to: b, controlPoint: CGPoint(x: peak.x, y: axisY + (peak.y - axisY) * 2))
      ctx.setStrokeColor(color.withAlphaComponent(on ? 1 : 0.35).cgColor)
      ctx.setLineWidth(on ? 5 : 3)
      ctx.setLineCap(.round)
      ctx.addPath(path.cgPath)
      ctx.strokePath()
      // Arrow head at the landing point.
      let dir: CGFloat = b.x >= a.x ? 1 : -1
      let tip = UIBezierPath()
      tip.move(to: b)
      tip.addLine(to: CGPoint(x: b.x - dir * 14, y: b.y + (down ? 10 : -10)))
      tip.move(to: b)
      tip.addLine(to: CGPoint(x: b.x - dir * 2, y: b.y + (down ? 18 : -18)))
      ctx.addPath(tip.cgPath)
      ctx.strokePath()
      let text = i == 0 ? num(v) : (v < 0 ? "− \(num(abs(v)))" : "+ \(num(v))")
      drawOutlined(text, color: color.withAlphaComponent(on ? 1 : 0.45), size: labelPx,
                   centeredAt: CGPoint(x: peak.x, y: peak.y + (down ? 20 : -20)))
    }

    // The landing point: where the answer is, never what it is.
    let end = CGPoint(x: px(points.last!), y: axisY)
    ctx.setFillColor(totalColor.cgColor)
    ctx.fillEllipse(in: CGRect(x: end.x - 9, y: end.y - 9, width: 18, height: 18))
    if roles.contains(.total) || h == .none {
      // Below the line, under any backward jump, so it never sits on an arc.
      drawOutlined("?", color: totalColor, size: resultPx, centeredAt: CGPoint(x: end.x, y: end.y + (hasBack ? 74 : 34)))
    }
  }

  // MARK: - Math strip

  /// How a strip piece is drawn.
  private enum PieceStyle {
    case chip(UIColor)  // a quantity: pill outlined in its model color
    case block  // a result from an earlier step: white-outlined box
    case symbol  // an operator such as + − × ÷ = →
  }

  private static func style(of run: TextRun) -> PieceStyle {
    if let color = run.color.uiColor { return .chip(color) }
    let t = run.t.trimmingCharacters(in: .whitespaces)
    return t.rangeOfCharacter(from: .decimalDigits) != nil ? .block : .symbol
  }

  /// The step's math strip, centred in `band`, shrunk to fit the width.
  private static func drawStrip(_ runs: [TextRun], in ctx: CGContext, band: CGRect) {
    let pad: CGFloat = 16
    let gap: CGFloat = 10
    func layout(_ fontSize: CGFloat) -> [(NSAttributedString, CGSize, PieceStyle)] {
      runs.map { run in
        let style = style(of: run)
        let color: UIColor = if case .chip(let c) = style { c } else { .white }
        let text = NSAttributedString(string: run.t.trimmingCharacters(in: .whitespaces), attributes: [
          .font: UIFont.systemFont(ofSize: fontSize, weight: .heavy),
          .foregroundColor: color,
        ])
        let s = text.size()
        let width: CGFloat = if case .symbol = style { s.width } else { s.width + pad * 2 }
        return (text, CGSize(width: width, height: s.height + 14), style)
      }
    }
    var fontSize: CGFloat = 46
    var pieces = layout(fontSize)
    var total = pieces.reduce(-gap) { $0 + $1.1.width + gap }
    while total > band.width - 24 && fontSize > 18 {
      fontSize -= 2
      pieces = layout(fontSize)
      total = pieces.reduce(-gap) { $0 + $1.1.width + gap }
    }

    var x = band.midX - total / 2
    for (text, box, style) in pieces {
      let rect = CGRect(x: x, y: band.midY - box.height / 2, width: box.width, height: box.height)
      switch style {
      case .chip(let color):
        let path = UIBezierPath(roundedRect: rect, cornerRadius: rect.height / 2)
        ctx.setFillColor(color.withAlphaComponent(0.18).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
        ctx.setStrokeColor(color.cgColor)
        ctx.setLineWidth(4)
        ctx.addPath(path.cgPath)
        ctx.strokePath()
      case .block:
        let path = UIBezierPath(roundedRect: rect, cornerRadius: 10)
        ctx.setFillColor(UIColor(white: 0.22, alpha: 1).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
        ctx.setStrokeColor(UIColor.white.cgColor)
        ctx.setLineWidth(3)
        ctx.addPath(path.cgPath)
        ctx.strokePath()
      case .symbol:
        break
      }
      let s = text.size()
      text.draw(at: CGPoint(x: rect.midX - s.width / 2, y: rect.midY - s.height / 2))
      x += box.width + gap
    }
  }
}
