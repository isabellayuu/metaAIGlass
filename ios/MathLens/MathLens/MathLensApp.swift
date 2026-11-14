import MWDATCore
import SwiftUI

@main
struct MathLensApp: App {
  @State private var glasses: GlassesController

  init() {
    do {
      try Wearables.configure()
    } catch {
      NSLog("[MathLens] Wearables.configure failed: \(error)")
    }
    _glasses = State(wrappedValue: GlassesController(wearables: Wearables.shared))
  }

  var body: some Scene {
    WindowGroup {
      ContentView(glasses: glasses)
        .onOpenURL { url in
          Task { await glasses.handle(url: url) }
        }
    }
  }
}
