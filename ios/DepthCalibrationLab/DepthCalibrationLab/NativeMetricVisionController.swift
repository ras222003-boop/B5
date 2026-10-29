import ARKit
import AVFoundation
import CoreImage
import CoreHaptics
import Foundation
import QuartzCore
import UIKit
import WebKit

/// Camera frames for the existing Basira vision page. RGB and optional LiDAR
/// depth are captured from one ARFrame; the page decides when to enable metres.
/// Nothing here enables walking or stair alerts.
final class NativeMetricVisionController: UIViewController, ARSessionDelegate, WKNavigationDelegate, WKUIDelegate {
    private let session = ARSession()
    private let context = CIContext()
    private var webView: WKWebView?
    private var allowedHost = ""
    /// The unified tab owns dismissal; closing must never open another camera.
    var onCloseRequested: (() -> Void)?
    private var running = false
    private var meterEnabled = false
    private var sessionGeneration = 0
    private var firstDepthTimestamp: TimeInterval = .infinity
    private var latestTimestamp: TimeInterval = -1
    private var lastArrival: CFTimeInterval = -1
    private var busy = false
    private var hapticEngine: CHHapticEngine?
    private var hapticEngineRunning = false
    private var lastHapticAt: CFTimeInterval = -.infinity
    private var hadNormalTracking = false
    private var sessionStartedAt: CFTimeInterval = -1
    private var watchdog: Timer?
    private let navigationStatus = UILabel()
    private var navigationFailureDisplayed = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let baseURL = BasiraWebOrigin.baseURL,
              let url = BasiraWebOrigin.url(for: .vision),
              let hostname = baseURL.host?.lowercased() else {
            showFailure("يجب ضبط BasiraVisionURL على صفحة الرؤية المنشورة في بصيرة قبل تشغيل الكاميرا.")
            return
        }
        allowedHost = hostname
        let userContent = WKUserContentController()
        BasiraWebMediaLifecycle.install(in: userContent)
        userContent.addScriptMessageHandler(WeakVisionFrameHandler(self),
                                            contentWorld: .page,
                                            name: "basiraNativeFrame")
        userContent.addUserScript(WKUserScript(source: """
        (() => {
          const messenger = window.webkit?.messageHandlers?.basiraNativeFrame;
          if (!messenger) return;
          const send = (action, extra = {}) => messenger.postMessage({action, ...extra});
          Object.defineProperty(window, 'BasiraNativeFrames', {
            value: Object.freeze({
              start: async () => { await send('start'); },
              setMeterEnabled: async (enabled) => { await send('meter', {enabled: enabled === true}); },
              stop: async () => { await send('stop'); },
              nextFrame: async () => {
                try { return (await send('frame')) ?? null; }
                catch { return null; }
              }
            }), configurable: false
          });
          Object.defineProperty(window, 'BasiraNativeHaptics', {
            value: Object.freeze({
              capabilities: () => send('hapticCapabilities'),
              pulse: options => send('hapticPulse', {
                intensity: options?.intensity, durationMs: options?.durationMs
              }),
              test: () => send('hapticTest'),
              stop: () => send('hapticStop')
            }), configurable: false
          });
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContent
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        webView = web
        web.load(URLRequest(url: url))
        let close = UIButton(type: .system)
        close.setTitle("إغلاق رؤية بصيرة", for: .normal)
        close.addTarget(self, action: #selector(closeCamera), for: .touchUpInside)
        close.backgroundColor = .black.withAlphaComponent(0.85)
        close.tintColor = .white
        close.layer.cornerRadius = 10
        close.accessibilityLabel = "إغلاق الرؤية وإيقاف الكاميرا والقياس"
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            close.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),
            close.heightAnchor.constraint(equalToConstant: 45)
        ])
        navigationStatus.font = .preferredFont(forTextStyle: .footnote)
        navigationStatus.adjustsFontForContentSizeCategory = true
        navigationStatus.numberOfLines = 0
        navigationStatus.textColor = .white
        navigationStatus.backgroundColor = .black.withAlphaComponent(0.92)
        navigationStatus.isHidden = true
        navigationStatus.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(navigationStatus)
        NSLayoutConstraint.activate([
            navigationStatus.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 8),
            navigationStatus.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            navigationStatus.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12)
        ])
        session.delegate = self
        session.delegateQueue = .main
        NotificationCenter.default.addObserver(self, selector: #selector(pauseInBackground), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resumeInForeground), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func startSession(reply: @escaping (Any?, String?) -> Void) {
        if running { reply(NSNull(), nil); return }
        guard ARWorldTrackingConfiguration.isSupported else {
            reply(nil, "arkit_unsupported")
            return
        }
        sessionGeneration += 1
        let attempt = sessionGeneration
        let launch = { [weak self] in
            guard let self else { reply(nil, "camera_unavailable"); return }
            guard self.sessionGeneration == attempt else { reply(nil, "camera_stopped"); return }
            guard UIApplication.shared.applicationState == .active,
                  self.view.window != nil else { reply(nil, "camera_stopped"); return }
            guard !self.running else { reply(NSNull(), nil); return }
            // Scene depth stays OFF until the Auto Meter switch is enabled.
            self.meterEnabled = false
            self.firstDepthTimestamp = .infinity
            self.latestTimestamp = -1
            self.lastArrival = -1
            self.hadNormalTracking = false
            self.sessionStartedAt = CACurrentMediaTime()
            BasiraWebMediaLifecycle.resume(self.webView)
            let config = ARWorldTrackingConfiguration()
            self.session.run(config, options: [.resetTracking, .removeExistingAnchors])
            self.running = true
            self.watchdog?.invalidate()
            self.watchdog = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                guard let self, self.running else { return }
                if NativeVisionSafety.frameGapRequiresStop(lastArrival: self.lastArrival,
                            startedAt: self.sessionStartedAt, now: CACurrentMediaTime()) {
                    self.stopAndSuspendPage()
                }
            }
            reply(NSNull(), nil)
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: launch()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted { launch() }
                    else { reply(nil, "camera_denied") }
                }
            }
        case .denied, .restricted: reply(nil, "camera_denied")
        @unknown default: reply(nil, "camera_unavailable")
        }
    }

    private func setMeterEnabled(_ enabled: Bool, reply: @escaping (Any?, String?) -> Void) {
        guard running else { reply(nil, "camera_stopped"); return }
        if enabled == meterEnabled { reply(NSNull(), nil); return }
        if enabled && !ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            reply(nil, "scene_depth_unsupported")
            return
        }
        meterEnabled = enabled
        firstDepthTimestamp = enabled ? (session.currentFrame?.timestamp ?? latestTimestamp) : .infinity
        let config = ARWorldTrackingConfiguration()
        if enabled { config.frameSemantics = [.sceneDepth] }
        session.run(config)
        reply(NSNull(), nil)
    }

    private func stopSession() {
        watchdog?.invalidate()
        watchdog = nil
        sessionGeneration += 1
        meterEnabled = false
        running = false
        firstDepthTimestamp = .infinity
        latestTimestamp = -1
        lastArrival = -1
        hadNormalTracking = false
        session.pause()
        stopHaptics()
    }

    private func stopHaptics() {
        hapticEngine?.stop(completionHandler: nil)
        hapticEngine = nil
        hapticEngineRunning = false
    }

    private func playHaptic(intensity: Double, durationMs: Double, allowWithoutCamera: Bool) -> Bool {
        let trackingNormal: Bool
        if let frame = session.currentFrame, case .normal = frame.camera.trackingState {
            trackingNormal = true
        } else { trackingNormal = false }
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics,
              UIApplication.shared.applicationState == .active,
              view.window != nil,
              allowWithoutCamera || NativeVisionSafety.mayPulse(running: running,
                    trackingNormal: trackingNormal, lastArrival: lastArrival, now: CACurrentMediaTime()),
              intensity.isFinite, durationMs.isFinite,
              (0...1).contains(intensity), (1...150).contains(durationMs) else { return false }
        let now = CACurrentMediaTime()
        guard now - lastHapticAt >= 0.25 else { return false }
        do {
            if hapticEngine == nil {
                let engine = try CHHapticEngine()
                engine.playsHapticsOnly = true
                engine.isAutoShutdownEnabled = true
                engine.stoppedHandler = { [weak self] _ in
                    DispatchQueue.main.async { self?.hapticEngineRunning = false }
                }
                engine.resetHandler = { [weak self] in
                    DispatchQueue.main.async { self?.hapticEngineRunning = false }
                }
                hapticEngine = engine
            }
            guard let engine = hapticEngine else { return false }
            if !hapticEngineRunning {
                try engine.start()
                hapticEngineRunning = true
            }
            let parameters = [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(max(0.1, intensity))),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.45)
            ]
            // Short non-repeating pulses only. Native bounds are independent of
            // settings or a compromised web scheduler.
            let event = CHHapticEvent(eventType: .hapticContinuous, parameters: parameters,
                                      relativeTime: 0, duration: min(0.12, max(0.035, durationMs / 1000)))
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            lastHapticAt = now
            return true
        } catch {
            stopHaptics()
            return false
        }
    }

    @objc private func pauseInBackground() {
        stopAndSuspendPage()
    }

    @objc private func resumeInForeground() {
        guard view.window != nil else { return }
        // A fresh Start action is required; AR and alerts do not auto-resume.
        BasiraWebMediaLifecycle.resume(webView)
    }

    private func stopAndSuspendPage() {
        // Page receives the suspension only after native state was invalidated.
        // Its resulting bridge.stop does not emit another event (no recursion).
        stopSession()
        BasiraWebMediaLifecycle.suspend(webView)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopAndSuspendPage()
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard running else { return }
        latestTimestamp = frame.timestamp
        lastArrival = CACurrentMediaTime()
        if case .normal = frame.camera.trackingState {
            hadNormalTracking = true
        } else {
            stopHaptics()
            // Initial ARKit warm-up is expected. Loss after valid tracking must
            // stop queued alerts and require a new user-initiated session.
            if hadNormalTracking { stopAndSuspendPage() }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        stopAndSuspendPage()
        showFailure("تعذر الحصول على إطار ARKit متزامن. أوقف التجربة وأعد تشغيلها.")
    }

    func sessionWasInterrupted(_ session: ARSession) {
        stopAndSuspendPage()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        stopAndSuspendPage()
    }

    // Other Basira pages remain reachable, but only the vision path may call
    // the native camera handler. Leaving it stops the AR session immediately.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Subframe failures must neither expand bridge access nor produce a
        // stream of alerts. Only top-level navigation gets a visible status.
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.cancel)
            return
        }
        guard let url = navigationAction.request.url,
              url.scheme == "https",
              url.host?.lowercased() == allowedHost,
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 443 else {
            stopAndSuspendPage()
            showNavigationFailure("توقفت الصفحة لأنها تطلب فتح نطاق خارج بصيرة المعتمد. قد تتطلب الخدمة دخولًا خارجيًا؛ يجب التحقق من مسار دخول يعود إلى منصة بصيرة قبل استخدام الرؤية داخل التطبيق.")
            decisionHandler(.cancel)
            return
        }
        if url.path != "/navigation/vision" { stopAndSuspendPage() }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard UIApplication.shared.applicationState == .active, view.window != nil,
              let base = BasiraWebOrigin.baseURL, let page = webView.url,
              BasiraWebOrigin.allows(page, within: base) else { return }
        // A freshly loaded approved module may make a new user media request.
        // This neither starts ARKit nor restarts media from the previous page.
        BasiraWebMediaLifecycle.resume(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        let failure = error as NSError
        guard !(failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled) else { return }
        stopAndSuspendPage()
        showNavigationFailure("تعذر تحميل رؤية بصيرة. تحقق من اتصال الإنترنت ونطاق المنصة وتسجيل الدخول، ثم أغلق الرؤية وافتحها من جديد.")
    }

    private func showNavigationFailure(_ message: String) {
        guard !navigationFailureDisplayed else { return }
        navigationFailureDisplayed = true
        navigationStatus.text = message
        navigationStatus.isHidden = false
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: message)
        }
    }

    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard let allowedOrigin = BasiraWebOrigin.baseURL,
              webView.url?.path == "/navigation/vision" else {
            decisionHandler(.deny)
            return
        }
        let allowed = BasiraWebMediaLifecycle.mayRequestCapture(
            scheme: origin.protocol, host: origin.host, port: origin.port,
            mainFrame: frame.isMainFrame, page: webView.url, allowedOrigin: allowedOrigin,
            active: UIApplication.shared.applicationState == .active, visible: view.window != nil)
        decisionHandler(allowed ? .prompt : .deny)
    }

    private func showFailure(_ message: String) {
        let alert = UIAlertController(title: "كاميرا بصيرة البحثية", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default))
        if presentedViewController == nil { present(alert, animated: true) }
    }

    func stopForNavigation() {
        stopAndSuspendPage()
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
    }

    @objc private func closeCamera() {
        stopAndSuspendPage()
        if let onCloseRequested {
            onCloseRequested()
            return
        }
        if presentingViewController != nil {
            dismiss(animated: true)
        } else {
            let lab = NativeCalibrationHomeController()
            lab.modalPresentationStyle = .fullScreen
            present(lab, animated: true)
        }
    }

    deinit {
        session.delegate = nil
        watchdog?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    fileprivate func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                guard let self else { reply(nil, "camera_unavailable"); return }
                self.handle(message, reply: reply)
            }
            return
        }
        guard message.name == "basiraNativeFrame",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == allowedHost,
              message.frameInfo.securityOrigin.protocol == "https",
              // WebKit may report the implicit HTTPS port as zero.
              [0, 443].contains(message.frameInfo.securityOrigin.port),
              let page = webView?.url,
              page.scheme == "https", page.host?.lowercased() == allowedHost,
              page.user == nil, page.password == nil,
              page.port == nil || page.port == 443,
              let request = message.body as? [String: Any],
              let action = request["action"] as? String else {
            reply(nil, "invalid_camera_request")
            return
        }
        // React cleanup can run after a same-origin SPA route changed. These
        // two actions only revoke resources; camera/depth/frame access remains
        // restricted to the vision route, including after history.pushState.
        guard NativeVisionSafety.mayHandleBridgeAction(action, path: page.path) else {
            reply(nil, "invalid_camera_request")
            return
        }
        switch action {
        case "start":
            startSession(reply: reply)
        case "meter":
            guard let enabled = request["enabled"] as? Bool else {
                reply(nil, "invalid_meter_request")
                return
            }
            setMeterEnabled(enabled, reply: reply)
        case "stop":
            stopSession()
            reply(NSNull(), nil)
        case "frame":
            sendFrame(reply: reply)
        case "hapticCapabilities":
            let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics
            reply(["supported": supported, "intensityControl": supported], nil)
        case "hapticPulse":
            guard let intensity = request["intensity"] as? Double,
                  let durationMs = request["durationMs"] as? Double else {
                reply(false, nil)
                return
            }
            reply(playHaptic(intensity: intensity, durationMs: durationMs,
                             allowWithoutCamera: false), nil)
        case "hapticTest":
            reply(playHaptic(intensity: 0.5, durationMs: 70,
                             allowWithoutCamera: true), nil)
        case "hapticStop":
            stopHaptics()
            reply(NSNull(), nil)
        default:
            reply(nil, "unknown_camera_request")
        }
    }

    private func sendFrame(reply: @escaping (Any?, String?) -> Void) {
        guard !busy, running,
              let frame = session.currentFrame,
              latestTimestamp == frame.timestamp,
              lastArrival > 0,
              CACurrentMediaTime() - lastArrival < 0.25,
              case .normal = frame.camera.trackingState else {
            reply(NSNull(), nil)
            return
        }
        busy = true
        // The single ARFrame owns both capturedImage and sceneDepth. Wait for a
        // new frame after enabling depth; an earlier RGB frame cannot carry it.
        let depth = meterEnabled && frame.timestamp > firstDepthTimestamp ? frame.sceneDepth : nil
        var result = buildAtomicFrame(frame, depth: depth)
        if result != nil {
            let ageMs = (CACurrentMediaTime() - lastArrival) * 1000
            if ageMs.isFinite && ageMs >= 0 && ageMs <= 800 {
                result?["bridgeAgeMs"] = ageMs
            } else {
                result = nil
            }
        }
        busy = false
        reply(result.map { $0 as Any } ?? NSNull(), nil)
    }

    /// RGB and depth remain in native sensor orientation. The web adapter
    /// rotates both clockwise together before object detection and sampling.
    private func buildAtomicFrame(_ frame: ARFrame, depth: ARDepthData?) -> [String: Any]? {
        let cameraBuffer = frame.capturedImage
        let cameraWidth = CVPixelBufferGetWidth(cameraBuffer), cameraHeight = CVPixelBufferGetHeight(cameraBuffer)
        guard cameraWidth >= 300, cameraHeight >= 200,
              abs(Double(cameraWidth) / Double(cameraHeight) - 4.0 / 3.0) < 0.03 else { return nil }

        let scale = min(640.0 / Double(cameraWidth), 480.0 / Double(cameraHeight))
        let source = CIImage(cvPixelBuffer: cameraBuffer)
        let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(of: scaled, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                                    options: [:]) else { return nil }

        // The RGB camera remains usable if depth is off, unsupported or invalid.
        // Invalid depth is represented by an empty map, never by a guessed value.
        var payload: [String: Any] = [
            "frameId": String(format: "arkit-%0.6f", locale: Locale(identifier: "en_US_POSIX"), frame.timestamp),
            "nativeTimestampMs": frame.timestamp * 1000,
            "source": "ARKIT_DEPTH",
            "capturedWithNativeSession": true,
            "alignedToCameraFrame": false,
            "rawDepthFresh": false,
            "cameraWidth": cameraWidth,
            "cameraHeight": cameraHeight,
            "imageBase64": jpeg.base64EncodedString(),
            "depthEnabled": false,
            "depthWidth": 0,
            "depthHeight": 0,
            "values": [Double](),
            "validCoverage": 0.0
        ]
        guard let depth, let confidence = depth.confidenceMap else { return payload }
        let map = depth.depthMap
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 else { return payload }
        let dw = CVPixelBufferGetWidth(map), dh = CVPixelBufferGetHeight(map)
        guard dw >= 64, dh >= 48,
              CVPixelBufferGetWidth(confidence) == dw, CVPixelBufferGetHeight(confidence) == dh,
              abs(Double(cameraWidth)/Double(cameraHeight) - Double(dw)/Double(dh)) < 0.03 else { return payload }

        guard CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return payload }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else { return payload }
        defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        guard let db = CVPixelBufferGetBaseAddress(map), let cb = CVPixelBufferGetBaseAddress(confidence) else { return payload }
        let depths = db.assumingMemoryBound(to: Float32.self)
        let conf = cb.assumingMemoryBound(to: UInt8.self)
        let dStride = CVPixelBufferGetBytesPerRow(map) / MemoryLayout<Float32>.stride
        let cStride = CVPixelBufferGetBytesPerRow(confidence)
        let high = UInt8(ARConfidenceLevel.high.rawValue)
        let w = 64, h = 48
        var values: [Double] = []
        values.reserveCapacity(w * h)
        var valid = 0
        for y in 0..<h {
            let sy = min(dh-1, Int((Double(y) + 0.5) * Double(dh)/Double(h)))
            for x in 0..<w {
                let sx = min(dw-1, Int((Double(x) + 0.5) * Double(dw)/Double(w)))
                let meters = Double(depths[sy * dStride + sx])
                let ok = conf[sy * cStride + sx] == high &&
                         meters.isFinite && meters > 0 && meters <= 10
                values.append(ok ? (meters * 1000).rounded() / 1000 : 0)
                if ok { valid += 1 }
            }
        }
        let coverage = Double(valid) / Double(w * h)
        // We reject sparse maps instead of guessing depth around an object.
        guard coverage >= 0.7 else { return payload }
        payload["alignedToCameraFrame"] = true
        payload["rawDepthFresh"] = true
        payload["depthEnabled"] = true
        payload["depthWidth"] = w
        payload["depthHeight"] = h
        payload["values"] = values
        payload["validCoverage"] = coverage
        return payload
    }
}

private final class WeakVisionFrameHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: NativeMetricVisionController?
    init(_ owner: NativeMetricVisionController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else { replyHandler(NSNull(), nil); return }
        owner.handle(message, reply: replyHandler)
    }
}
