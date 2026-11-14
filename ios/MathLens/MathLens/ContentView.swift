import MWDATCore
import SwiftUI

#if DEBUG
import MWDATMockDevice
#endif

/// The phone screen: connect to Meta AI and the glasses, see what the glasses
/// show (in full color), and set the server address.
struct ContentView: View {
  let glasses: GlassesController

  #if DEBUG
  @State private var simulated = SimulatedGlasses()
  @State private var simulatedOn = false
  @State private var simulatedProblem =
    "A garden is 6 m long and 4 m wide. What is the area of the garden?"
  #endif

  var body: some View {
    NavigationStack {
      Form {
        if let error = glasses.errorMessage {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
            Button("Dismiss") { glasses.dismissError() }
          }
        }
        #if DEBUG
        if Self.autopilotOn { simulatorSection }
        #endif
        connectionSection
        #if DEBUG
        if !Self.autopilotOn { simulatorSection }
        #endif
        if let step = glasses.currentStep, let scan = glasses.scan {
          stepSection(step, scan: scan)
        }
        if let photo = glasses.lastPhoto {
          Section("Last photo from the glasses") {
            Image(uiImage: photo)
              .resizable()
              .scaledToFit()
              .frame(maxHeight: 220)
          }
        }
        Section {
          Toggle(
            "Demo problems (no server)",
            isOn: Binding(get: { glasses.demoMode }, set: { glasses.demoMode = $0 })
          )
          TextField("Server", text: Binding(get: { glasses.server }, set: { glasses.server = $0 }))
            .disabled(glasses.demoMode)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          Button("Use the Vercel server") { glasses.server = RecognizeClient.defaultServer }
        } header: {
          Text("Server")
        } footer: {
          Text(
            glasses.demoMode
              ? "Demo: each Scan still takes a photo, then shows the next built-in example (area, groups, number line, volume)."
              : "Photos go to <server>/api/recognize. For npm run dev, use http://<your Mac's IP>:5173."
          )
        }
      }
      .navigationTitle("Math Lens")
    }
    #if DEBUG
    .task {
      // `-autopilot` (Xcode scheme argument or simctl launch): runs the whole
      // flow on simulated glasses without touching the screen.
      if Self.autopilotOn { await autopilot() }
    }
    #endif
  }

  #if DEBUG
  private static let autopilotOn = ProcessInfo.processInfo.arguments.contains("-autopilot")

  private func autopilot() async {
    func waitFor(_ what: String, _ condition: () -> Bool) async -> Bool {
      for _ in 0..<120 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(250))
      }
      NSLog("[MathLens] autopilot: timed out waiting for \(what)")
      return false
    }
    simulatedOn = true
    guard await waitFor("simulated glasses", { simulated.display != nil }) else { return }
    guard await waitFor("registration", { glasses.registration == .registered }) else { return }
    await glasses.connect()
    guard await waitFor("display", { glasses.phase == .ready }) else { return }
    try? await Task.sleep(for: .seconds(2))
    glasses.scanTapped()
    guard await waitFor("steps", { glasses.phase == .showing && glasses.scan != nil }) else { return }
    NSLog("[MathLens] autopilot: demo problems loaded: \(DemoScans.all.count)")
    NSLog("[MathLens] autopilot: showing \(glasses.scan?.steps.count ?? 0) steps")
    for _ in 0..<3 {
      try? await Task.sleep(for: .seconds(3))
      glasses.next()
    }
    try? await Task.sleep(for: .seconds(2))
    glasses.hint()
    // Scan again after the simulated stream has had time to end.
    try? await Task.sleep(for: .seconds(25))
    glasses.scanTapped()
    guard await waitFor("second scan", { glasses.phase == .showing && glasses.stepIndex == 0 }) else { return }
    NSLog("[MathLens] autopilot: second scan ok")
    NSLog("[MathLens] autopilot: done")
  }
  #endif

  // MARK: - Connection

  private var connectionSection: some View {
    Section("Glasses") {
      LabeledContent("Meta AI", value: registrationText)
      LabeledContent("Glasses", value: glasses.status)
      if glasses.isConnected {
        LabeledContent("Camera", value: glasses.streamStatus)
      }

      switch glasses.registration {
      case .registered:
        if glasses.needsCameraPermission {
          Button("Allow the glasses camera in Meta AI") {
            Task { await glasses.requestCameraPermission() }
          }
        }
        if glasses.phase == .idle {
          Button("Connect glasses") { Task { await glasses.connect() } }
            .bold()
        } else if glasses.phase == .connecting {
          HStack {
            ProgressView()
            Text("Connecting…")
          }
        } else {
          Button("Scan (same as Scan on the glasses)") { glasses.scanTapped() }
            .disabled(glasses.phase == .capturing || glasses.phase == .recognizing)
          Button("Disconnect", role: .destructive) { glasses.disconnect() }
        }
        if glasses.needsGlassesAppUpdate {
          Button("Update the app on the glasses") { Task { await glasses.openGlassesAppUpdate() } }
        }
        Button("Disconnect from Meta AI", role: .destructive) { Task { await glasses.unregister() } }
          .font(.footnote)
      case .registering:
        HStack {
          ProgressView()
          Text("Waiting for Meta AI…")
        }
      case .available, .unavailable:
        Button("Connect to Meta AI") { Task { await glasses.register() } }
          .bold()
      @unknown default:
        EmptyView()
      }
    }
  }

  private var registrationText: String {
    switch glasses.registration {
    case .registered: "Connected"
    case .registering: "Connecting…"
    case .available: "Not connected"
    case .unavailable: "Unavailable"
    @unknown default: "Unknown"
    }
  }

  // MARK: - Steps

  private func stepSection(_ step: ScanStep, scan: Scan) -> some View {
    Section("On the glasses: \(step.label) · \(glasses.stepIndex + 1)/\(scan.steps.count)") {
      if let picture = glasses.picture(for: glasses.stepIndex) {
        Image(uiImage: picture)
          .resizable()
          .scaledToFit()
          .clipShape(RoundedRectangle(cornerRadius: 12))
      }
      coloredText(step)
        .font(.title3)
      ForEach(Array(step.hints.prefix(glasses.hintsShown).enumerated()), id: \.offset) { _, hint in
        Label(hint, systemImage: "lightbulb")
          .foregroundStyle(.secondary)
      }
      HStack {
        Button("Back") { glasses.previous() }
          .disabled(glasses.stepIndex == 0)
        Spacer()
        Button("Hint") { glasses.hint() }
          .disabled(glasses.hintsShown >= step.hints.count)
        Spacer()
        Button("Next") { glasses.next() }
          .disabled(glasses.stepIndex >= scan.steps.count - 1)
      }
      .buttonStyle(.borderless)
    }
  }

  /// The step with each quantity in its model color (the phone has full color).
  private func coloredText(_ step: ScanStep) -> Text {
    step.text.reduce(Text("")) { text, run in
      if let color = run.color.uiColor {
        text + Text(run.t).foregroundColor(Color(color)).bold()
      } else {
        text + Text(run.t)
      }
    }
  }

  // MARK: - Simulator

  #if DEBUG
  private var simulatorSection: some View {
    Section {
      Toggle("Simulated glasses", isOn: $simulatedOn)
        .onChange(of: simulatedOn) { _, on in
          Task {
            if on {
              glasses.disconnect()
              do {
                try await simulated.turnOn(problem: simulatedProblem)
              } catch {
                NSLog("[MathLens] simulated glasses failed: \(error)")
                simulatedOn = false
              }
            } else {
              glasses.disconnect()
              await simulated.turnOff()
            }
          }
        }
      if !simulatedOn {
        TextField("Problem on the simulated camera", text: $simulatedProblem, axis: .vertical)
      }
      if simulatedOn, let display = simulated.display {
        MockDisplayPreview(display: display)
          .aspectRatio(1, contentMode: .fit)
          .listRowInsets(EdgeInsets())
      }
    } header: {
      Text("Developer")
    } footer: {
      Text("Debug builds only. Pairs mock Meta Ray-Ban Display glasses whose camera sees the problem above.")
    }
  }
  #endif
}

#if DEBUG
/// Shows what the simulated glasses display renders.
private struct MockDisplayPreview: UIViewRepresentable {
  let display: any MockDisplayKit

  func makeUIView(context: Context) -> UIView {
    display.createPreviewView()
  }

  func updateUIView(_ uiView: UIView, context: Context) {}
}
#endif
