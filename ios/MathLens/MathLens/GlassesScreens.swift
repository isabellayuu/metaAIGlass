import MWDATDisplay
import UIKit

// Everything the glasses display shows. Kept apart from SwiftUI so the Display
// DSL names (Text, Button, Image) are not ambiguous. Each `send()` replaces the
// whole screen and its tap handlers, so every screen is built from scratch.

typealias Action = @Sendable () -> Void

enum GlassesScreens {
  /// Waiting for the wearer to look at a problem.
  static func ready(onScan: @escaping Action) -> FlexBox {
    FlexBox(direction: .column, spacing: 12, crossAlignment: .center) {
      Icon(name: .fourCornerFrame)
      Text("Math Lens", style: .heading)
      Text("Look at a math problem, then tap Scan.", style: .body, color: .secondary)
      ButtonGroup {
        Button(label: "Scan", style: .primary, iconName: .fourCornerFrame, onClick: onScan)
          .actionRole(.primary)
      }
    }
    .padding(24)
    .onTap(onScan)
  }

  /// A short status line while the photo is taken or read.
  static func busy(_ message: String) -> FlexBox {
    FlexBox(direction: .column, spacing: 12, crossAlignment: .center) {
      Icon(name: .starCircleTriangleAi)
      Text(message, style: .body)
    }
    .padding(24)
  }

  /// Something went wrong; Scan tries again.
  static func problem(_ message: String, onScan: @escaping Action) -> FlexBox {
    FlexBox(direction: .column, spacing: 12, crossAlignment: .center) {
      Icon(name: .exclamationCircle)
      Text(message, style: .body)
      ButtonGroup {
        Button(label: "Scan", style: .primary, iconName: .fourCornerFrame, onClick: onScan)
          .actionRole(.primary)
      }
    }
    .padding(24)
    .onTap(onScan)
  }

  struct StepActions: Sendable {
    var previous: Action
    var hint: Action
    var next: Action
    var scan: Action
  }

  /// One solution step: label and progress, model picture, text, revealed hints, buttons.
  static func step(
    _ step: ScanStep,
    index: Int,
    count: Int,
    hintsShown: Int,
    picture: UIImage?,
    actions: StepActions
  ) -> FlexBox {
    let hints = Array(step.hints.prefix(hintsShown))
    let isLast = index == count - 1
    return FlexBox(direction: .column, spacing: 8) {
      Text("\(step.label) · \(index + 1)/\(count)", style: .meta, color: .secondary)
      if let picture {
        Image(image: picture, sizePreset: .fill, cornerRadius: .medium)
      }
      Text(step.plainText, style: .body)
      for hint in hints {
        Text("Hint: \(hint)", style: .body, color: .secondary)
      }
      ButtonGroup {
        Button(label: "Back", style: .secondary, iconName: .arrowLeft, onClick: actions.previous)
        Button(label: "Hint", style: .secondary, iconName: .lightBulb, onClick: actions.hint)
        if isLast {
          Button(label: "Scan", style: .primary, iconName: .fourCornerFrame, onClick: actions.scan)
            .actionRole(.primary)
        } else {
          Button(label: "Next", style: .primary, iconName: .arrowRight, onClick: actions.next)
            .actionRole(.primary)
        }
        if !isLast {
          Button(label: "Scan", style: .outline, iconName: .fourCornerFrame, onClick: actions.scan)
        }
      }
    }
    .padding(16)
  }
}
