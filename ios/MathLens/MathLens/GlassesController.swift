import Foundation
import MWDATCamera
import MWDATCore
import MWDATDisplay
import Observation
import UIKit

/// Runs the whole glasses flow: registration with Meta AI, one DeviceSession
/// with Display + Camera, photo → server → steps on the glasses display.
@Observable
@MainActor
final class GlassesController {
  enum Phase: Equatable {
    case idle  // no session
    case connecting  // session starting, waiting for the display
    case ready  // waiting for the wearer to tap Scan
    case capturing  // photo requested from the glasses camera
    case recognizing  // photo sent to the server
    case showing  // steps on the display
  }

  private(set) var registration: RegistrationState
  private(set) var phase: Phase = .idle {
    didSet { if phase != oldValue { NSLog("[MathLens] phase: \(phase)") } }
  }
  private(set) var status = "Not connected"
  private(set) var errorMessage: String?
  private(set) var needsCameraPermission = false
  private(set) var needsGlassesAppUpdate = false
  private(set) var scan: Scan?
  private(set) var stepIndex = 0
  private(set) var lastPhoto: UIImage?
  private(set) var streamStatus = "Camera off"
  var server: String {
    didSet { UserDefaults.standard.set(server, forKey: "server") }
  }
  /// Show built-in example problems instead of asking the server.
  var demoMode: Bool {
    didSet { UserDefaults.standard.set(demoMode, forKey: "demoMode") }
  }
  @ObservationIgnored private var demoIndex = 0

  /// Message shown on the glasses instead of the steps (no problem found, errors).
  private var glassesNotice: String?

  @ObservationIgnored let wearables: any WearablesInterface
  @ObservationIgnored private var selector: AutoDeviceSelector
  @ObservationIgnored private var session: DeviceSession?
  @ObservationIgnored private var display: Display?
  @ObservationIgnored private var displayReady = false
  @ObservationIgnored private var camera: Camera?
  @ObservationIgnored private var stream: MWDATCamera.Stream?
  @ObservationIgnored private var streamState: StreamState = .stopped
  @ObservationIgnored private var tokens = ListenerTokenBag()
  @ObservationIgnored private var cameraTokens = ListenerTokenBag()
  @ObservationIgnored private var cameraNeedsRestart = false
  @ObservationIgnored private var sessionTasks: [Task<Void, Never>] = []
  @ObservationIgnored private var registrationTask: Task<Void, Never>?
  @ObservationIgnored private var timeoutTask: Task<Void, Never>?
  @ObservationIgnored private var captureWhenStreaming = false
  @ObservationIgnored private var sendChain: Task<Void, Never>?
  @ObservationIgnored private var pictures: [Int: UIImage] = [:]

  init(wearables: any WearablesInterface) {
    self.wearables = wearables
    self.registration = wearables.registrationState
    self.selector = AutoDeviceSelector(wearables: wearables, filter: { $0.supportsDisplay() })
    self.server = UserDefaults.standard.string(forKey: "server") ?? RecognizeClient.defaultServer
    self.demoMode = UserDefaults.standard.bool(forKey: "demoMode")
    registrationTask = Task { [weak self] in
      guard let stream = self?.wearables.registrationStateStream() else { return }
      for await state in stream {
        guard let self else { return }
        self.registration = state
        if state == .available || state == .unavailable {
          self.disconnect()
          self.selector = AutoDeviceSelector(wearables: self.wearables, filter: { $0.supportsDisplay() })
        }
      }
    }
  }

  var isConnected: Bool { phase != .idle && phase != .connecting }
  var currentStep: ScanStep? {
    guard let scan, scan.steps.indices.contains(stepIndex) else { return nil }
    return scan.steps[stepIndex]
  }

  // MARK: - Registration and permission (phone side)

  func register() async {
    errorMessage = nil
    do {
      try await wearables.startRegistration()
    } catch {
      fail(error.description)
    }
  }

  func unregister() async {
    disconnect()
    do {
      try await wearables.startUnregistration()
    } catch {
      fail(error.description)
    }
  }

  /// Callback from Meta AI after registration or a permission request.
  func handle(url: URL) async {
    guard
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true
    else { return }
    do {
      _ = try await wearables.handleUrl(url)
    } catch {
      fail(error.description)
    }
  }

  /// Opens Meta AI so the wearer can allow the glasses camera.
  func requestCameraPermission() async {
    errorMessage = nil
    do {
      let result = try await wearables.requestPermission(.camera)
      needsCameraPermission = result != .granted
      if result == .granted {
        await connect()
      } else {
        fail("Camera permission was denied. Allow it in the Meta AI app to scan problems.")
      }
    } catch {
      fail(error.description)
    }
  }

  func openGlassesAppUpdate() async {
    do {
      try await wearables.openDATGlassesAppUpdate()
    } catch {
      fail(error.localizedDescription)
    }
  }

  // MARK: - Session

  func connect() async {
    guard phase == .idle else { return }
    errorMessage = nil
    guard registration == .registered else {
      fail("Connect NumLens to Meta AI first.")
      return
    }

    phase = .connecting
    status = "Checking camera permission…"
    do {
      if try await wearables.checkPermissionStatus(.camera) != .granted {
        needsCameraPermission = true
        phase = .idle
        status = "Camera permission needed"
        return
      }
      needsCameraPermission = false
    } catch {
      phase = .idle
      status = "Not connected"
      fail(error.description)
      return
    }

    status = "Looking for glasses…"
    guard await waitForDisplayGlasses(seconds: 10) else {
      phase = .idle
      status = "Not connected"
      fail("Glasses not connected. Turn them on, unfold them, and check they are connected in the Meta AI app.")
      return
    }

    let session: DeviceSession
    do {
      session = try wearables.createSession(deviceSelector: selector)
    } catch {
      phase = .idle
      status = "Not connected"
      fail(error.description)
      return
    }
    self.session = session
    status = "Starting session…"

    let states = session.stateStream()
    let errors = session.errorStream()
    sessionTasks.append(Task { [weak self] in
      for await state in states {
        guard let self, !Task.isCancelled else { return }
        self.sessionChanged(state)
      }
    })
    sessionTasks.append(Task { [weak self] in
      for await error in errors {
        guard let self, !Task.isCancelled else { return }
        if error == .datAppOnTheGlassesUpdateRequired { self.needsGlassesAppUpdate = true }
        self.fail(error.description)
      }
    })
    startTimeout(seconds: 20, "The glasses did not respond. Check they are on and close to the phone.")

    do {
      try session.start()
    } catch {
      if error == .datAppOnTheGlassesUpdateRequired { needsGlassesAppUpdate = true }
      fail(error.description)
      disconnect()
    }
  }

  func disconnect() {
    timeoutTask?.cancel()
    timeoutTask = nil
    sessionTasks.forEach { $0.cancel() }
    sessionTasks = []
    tokens.clear()
    tokens = ListenerTokenBag()
    cameraTokens.clear()
    cameraTokens = ListenerTokenBag()
    cameraNeedsRestart = false
    display?.stop()
    camera?.stop()
    session?.stop()
    display = nil
    displayReady = false
    camera = nil
    stream = nil
    streamState = .stopped
    session = nil
    captureWhenStreaming = false
    phase = .idle
    status = "Not connected"
    streamStatus = "Camera off"
  }

  /// Polls until a display-capable device is linked, so createSession has one to pick.
  private func waitForDisplayGlasses(seconds: Double) async -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      let ready = wearables.devices.contains { id in
        guard let device = wearables.deviceForIdentifier(id) else { return false }
        return device.supportsDisplay() && device.linkState == .connected
      }
      if ready { return true }
      try? await Task.sleep(for: .milliseconds(250))
    }
    return false
  }

  private func sessionChanged(_ state: DeviceSessionState) {
    switch state {
    case .started:
      status = "Connected"
      attachCapabilities()
    case .paused:
      status = "Paused by the glasses"
    case .stopped:
      if session != nil {
        disconnect()
        status = "Disconnected"
      }
    case .idle, .starting, .stopping:
      break
    @unknown default:
      break
    }
  }

  private func attachCapabilities() {
    guard let session, display == nil else { return }
    do {
      let display = try session.addDisplay()
      self.display = display
      display.statePublisher.listen { [weak self] state in
        Task { @MainActor in self?.displayChanged(state) }
      }.store(in: tokens)
      display.start()
    } catch {
      if error == .datAppOnTheGlassesUpdateRequired { needsGlassesAppUpdate = true }
      fail("Could not open the glasses display: \(error.description)")
      disconnect()
      return
    }

    startCamera()
  }

  /// Attaches the camera and starts its stream. Also used to replace a stream
  /// that ended with an error, so the next Scan still works.
  private func startCamera() {
    guard let session else { return }
    cameraTokens.clear()
    cameraTokens = ListenerTokenBag()
    camera?.stop()
    camera = nil
    stream = nil
    streamState = .stopped
    cameraNeedsRestart = false
    do {
      let config = StreamConfiguration(videoCodec: .raw, resolution: .medium, frameRate: 15)
      guard let camera = try session.addCamera(config: config) else {
        fail("Could not start the glasses camera.")
        return
      }
      self.camera = camera
      let stream = camera.stream
      self.stream = stream
      stream.statePublisher.listen { [weak self] state in
        Task { @MainActor in self?.streamChanged(state) }
      }.store(in: cameraTokens)
      stream.photoDataPublisher.listen { [weak self] photo in
        Task { @MainActor in await self?.photoArrived(photo.data) }
      }.store(in: cameraTokens)
      stream.errorPublisher.listen { [weak self] error in
        Task { @MainActor in self?.cameraFailed(error) }
      }.store(in: cameraTokens)
      stream.start()
    } catch {
      fail("Could not start the glasses camera: \(error.description)")
    }
  }

  private func displayChanged(_ state: DisplayState) {
    switch state {
    case .started:
      displayReady = true
      timeoutTask?.cancel()
      if phase == .connecting { phase = scan == nil ? .ready : .showing }
      refreshGlasses()
    case .stopped:
      displayReady = false
      if session != nil {
        disconnect()
        status = "Display closed"
      }
    case .starting, .stopping:
      break
    }
  }

  private func streamChanged(_ state: StreamState) {
    streamState = state
    switch state {
    case .streaming:
      streamStatus = "Camera on"
      if captureWhenStreaming {
        captureWhenStreaming = false
        takePhoto()
      }
    case .waitingForDevice: streamStatus = "Camera waiting for glasses"
    case .starting: streamStatus = "Camera starting"
    case .paused: streamStatus = "Camera paused"
    case .stopping, .stopped: streamStatus = "Camera off"
    }
  }

  private func cameraFailed(_ error: StreamError) {
    switch error {
    case .permissionDenied:
      needsCameraPermission = true
      reportCameraProblem("Camera permission denied. Allow it in the Meta AI app.")
    case .hingesClosed:
      reportCameraProblem("The glasses are folded. Unfold them and try again.")
    default:
      // The stream ended (for example after idling). Only a failure during a
      // scan matters to the wearer; otherwise start a fresh stream on next Scan.
      NSLog("[MathLens] camera stream ended: \(error.description)")
      cameraNeedsRestart = true
      streamStatus = "Camera stopped (restarts on Scan)"
      if phase == .capturing {
        reportCameraProblem("The camera stopped. Tap Scan to try again.")
      }
    }
  }

  private func reportCameraProblem(_ message: String) {
    if phase == .capturing {
      showNotice(message)
    }
    fail(message)
  }

  // MARK: - Scan

  func scanTapped() {
    guard isConnected, phase != .capturing, phase != .recognizing else { return }
    errorMessage = nil
    glassesNotice = nil
    phase = .capturing
    refreshGlasses()
    startTimeout(seconds: 15, "The glasses did not send a photo. Try again.")
    if streamState == .streaming && !cameraNeedsRestart {
      takePhoto()
    } else {
      captureWhenStreaming = true
      if cameraNeedsRestart || stream == nil {
        startCamera()
      } else if streamState == .stopped {
        stream?.start()
      }
    }
  }

  private func takePhoto() {
    guard let stream, stream.capturePhoto(format: .jpeg) else {
      showNotice("The camera is busy. Try again.")
      return
    }
  }

  private func photoArrived(_ raw: Data) async {
    guard phase == .capturing else { return }
    timeoutTask?.cancel()
    phase = .recognizing
    refreshGlasses()

    // Blur faces on the phone before the photo is shown or sent anywhere.
    // If the check fails, the photo is dropped (fail-closed).
    let data: Data
    do {
      let blurred = try await Task.detached(priority: .userInitiated) {
        try FaceBlur.blurFaces(in: raw)
      }.value
      data = blurred.jpeg
      if blurred.faceCount > 0 { NSLog("[MathLens] blurred \(blurred.faceCount) face(s)") }
    } catch {
      guard phase == .recognizing else { return }
      showNotice("Could not check the photo for faces. Try again.")
      fail("Photo not sent: \(error.localizedDescription)")
      return
    }
    lastPhoto = UIImage(data: data)

    do {
      let result: Scan
      if demoMode, !DemoScans.all.isEmpty {
        try? await Task.sleep(for: .milliseconds(800))
        result = DemoScans.all[demoIndex % DemoScans.all.count]
        demoIndex += 1
      } else {
        result = try await RecognizeClient(server: server).recognize(jpeg: data)
      }
      guard phase == .recognizing else { return }
      if result.found, !result.steps.isEmpty {
        scan = result
        stepIndex = 0
        pictures = [:]
        phase = .showing
        refreshGlasses()
      } else {
        showNotice("No math problem found, try again")
      }
    } catch {
      guard phase == .recognizing else { return }
      showNotice(error.localizedDescription)
      fail(error.localizedDescription)
    }
  }

  // MARK: - Steps

  func next() {
    guard let scan, phase == .showing, stepIndex < scan.steps.count - 1 else { return }
    stepIndex += 1
    refreshGlasses()
  }

  func previous() {
    guard phase == .showing, stepIndex > 0 else { return }
    stepIndex -= 1
    refreshGlasses()
  }

  /// The model picture for a step, drawn once per step.
  func picture(for index: Int) -> UIImage? {
    guard let scan, scan.steps.indices.contains(index) else { return nil }
    if let cached = pictures[index] { return cached }
    let image = ModelRenderer.render(
      scan: scan,
      step: scan.steps[index],
      index: index,
      count: scan.steps.count
    )
    pictures[index] = image
    return image
  }

  // MARK: - Glasses display

  private func showNotice(_ message: String) {
    timeoutTask?.cancel()
    captureWhenStreaming = false
    glassesNotice = message
    phase = scan == nil ? .ready : .showing
    refreshGlasses()
  }

  /// Rebuilds the glasses screen from the current state and sends it.
  private func refreshGlasses() {
    guard let display, displayReady else { return }
    let onScan: Action = { [weak self] in Task { @MainActor in self?.scanTapped() } }

    if let notice = glassesNotice, phase == .ready || phase == .showing {
      glassesNotice = nil
      send(GlassesScreens.problem(notice, onScan: onScan), on: display)
      return
    }

    switch phase {
    case .idle, .connecting:
      return
    case .ready:
      send(GlassesScreens.ready(onScan: onScan), on: display)
    case .capturing:
      send(GlassesScreens.busy("Taking a photo…"), on: display)
    case .recognizing:
      send(GlassesScreens.busy("Reading the problem…"), on: display)
    case .showing:
      guard let scan, let step = currentStep else {
        send(GlassesScreens.ready(onScan: onScan), on: display)
        return
      }
      let actions = GlassesScreens.StepActions(
        previous: { [weak self] in Task { @MainActor in self?.previous() } },
        next: { [weak self] in Task { @MainActor in self?.next() } },
        scan: onScan
      )
      send(
        GlassesScreens.step(
          step,
          index: stepIndex,
          count: scan.steps.count,
          picture: picture(for: stepIndex),
          actions: actions
        ),
        on: display
      )
    }
  }

  /// Sends in order: each send waits for the previous one.
  private func send(_ view: FlexBox, on display: Display) {
    let previous = sendChain
    sendChain = Task { [weak self] in
      await previous?.value
      do {
        try await display.send(view)
      } catch {
        let message = (error as? DisplayError)?.description ?? error.localizedDescription
        self?.fail("Glasses display: \(message)")
      }
    }
  }

  // MARK: - Errors

  private func startTimeout(seconds: Double, _ message: String) {
    timeoutTask?.cancel()
    timeoutTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(seconds))
      guard !Task.isCancelled, let self else { return }
      if self.phase == .connecting {
        self.fail(message)
        self.disconnect()
      } else if self.phase == .capturing {
        self.showNotice(message)
        self.fail(message)
      }
    }
  }

  private func fail(_ message: String) {
    NSLog("[MathLens] error: \(message)")
    errorMessage = message
  }

  func dismissError() {
    errorMessage = nil
  }
}
