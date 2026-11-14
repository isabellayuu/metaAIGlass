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
      Text("NumLens", style: .heading)
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
    var next: Action
    var scan: Action
  }

  /// One solution step: the picture (progress dots, model and math strip) and
  /// below it the same sentence the phone shows. Buttons are icons only:
  /// back, next (or scan on the last step).
  static func step(
    _ step: ScanStep,
    index: Int,
    count: Int,
    picture: UIImage?,
    actions: StepActions
  ) -> FlexBox {
    let isLast = index == count - 1
    // The step's sentence, as on the phone (the caption if there is none).
    let words = step.plainText.isEmpty ? step.caption : step.plainText
    return FlexBox(direction: .column, spacing: 8) {
      if let picture {
        Image(image: picture, sizePreset: .fill, cornerRadius: .medium)
      }
      if !words.isEmpty {
        Text(words, style: .body)
      }
      ButtonGroup {
        Button(label: "", style: .secondary, iconName: .arrowLeft, onClick: actions.previous)
        if isLast {
          Button(label: "", style: .primary, iconName: .fourCornerFrame, onClick: actions.scan)
            .actionRole(.primary)
        } else {
          Button(label: "", style: .primary, iconName: .arrowRight, onClick: actions.next)
            .actionRole(.primary)
        }
        if !isLast {
          Button(label: "", style: .outline, iconName: .fourCornerFrame, onClick: actions.scan)
        }
      }
    }
    .padding(16)
  }
}
