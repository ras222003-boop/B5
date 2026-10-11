import ARKit
import AVFoundation
import CoreImage
import Foundation
import QuartzCore
import UIKit
import WebKit

/// Experimental native camera: camera pixels AND depth come from the same ARFrame.
/// No web getUserMedia() stream is ever used. Nothing here enables walking alerts.
final class NativeMetricVisionController: UIViewController, ARSessionDelegate, WKNavigationDelegate {
    private let session = ARSession()
    private let context = CIContext()
    private var webView: WKWebView?
    private var allowedHost = ""
    private var running = false
    private var latestTimestamp: TimeInterval = -1
    private var lastArrival: CFTimeInterval = -1
    private var busy = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BasiraVisionURL") as? String,
              let url = URL(string: raw),
              url.scheme == "https",
              let hostname = url.host?.lowercased(),
              !hostname.contains(".example"),
              url.path == "/navigation/native-vision" else {
            showFailure("يجب ضبط BasiraVisionURL على صفحة كاميرا LiDAR المنشورة في بصيرة قبل تشغيل التعرف على الأجسام.")
            return
        }
        allowedHost = hostname
        let userContent = WKUserContentController()
        userContent.addScriptMessageHandler(WeakVisionFrameHandler(self),
                                            contentWorld: .page,
                                            name: "basiraNativeFrame")
        userContent.addUserScript(WKUserScript(source: """
        (() => {
          const messenger = window.webkit?.messageHandlers?.basiraNativeFrame;
          if (!messenger) return;
          Object.defineProperty(window, 'BasiraNativeFrames', {
            value: Object.freeze({
              nextFrame: async () => {
                try { return (await messenger.postMessage({action:'frame'})) ?? null; }
                catch { return null; }
              }
            }), configurable: false
          });
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContent
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
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
        close.setTitle("إغلاق كاميرا LiDAR", for: .normal)
        close.addTarget(self, action: #selector(closeCamera), for: .touchUpInside)
        close.backgroundColor = .black.withAlphaComponent(0.85)
        close.tintColor = .white
        close.layer.cornerRadius = 10
        close.accessibilityLabel = "إغلاق الكاميرا وإيقاف مستشعر LiDAR"
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            close.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),
            close.heightAnchor.constraint(equalToConstant: 45)
        ])
        session.delegate = self
        session.delegateQueue = .main
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !allowedHost.isEmpty else { return }
        if !ARWorldTrackingConfiguration.isSupported ||
           !ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            showFailure("هذا الجهاز لا يدعم ARKit Scene Depth. لن تظهر أمتار تقديرية.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: startSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    if allowed { self?.startSession() }
                    else { self?.showFailure("ارفضت صلاحية الكاميرا؛ يجب تفعيلها لإجراء القياس.") }
                }
            }
        case .denied, .restricted:
            showFailure("اسمح باستخدام الكاميرا من إعدادات iOS ثم أعد فتح المختبر.")
        @unknown default:
            showFailure("تعذر طلب إذن الكاميرا.")
        }
    }

    private func startSession() {
        guard !running else { return }
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = [.sceneDepth]
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        running = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        running = false
        session.pause()
        session.delegate = nil
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        latestTimestamp = frame.timestamp
        lastArrival = CACurrentMediaTime()
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        running = false
        showFailure("تعذر الحصول على إطار ARKit متزامن. أوقف التجربة وأعد تشغيلها.")
    }

    private func showFailure(_ message: String) {
        let alert = UIAlertController(title: "كاميرا بصيرة البحثية", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default))
        if presentedViewController == nil { present(alert, animated: true) }
    }

    @objc private func closeCamera() { dismiss(animated: true) }

    fileprivate func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard !busy, running, message.name == "basiraNativeFrame",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == allowedHost,
              let page = webView?.url,
              page.scheme == "https", page.host?.lowercased() == allowedHost,
              page.path == "/navigation/native-vision",
              let request = message.body as? [String: String],
              request["action"] == "frame",
              let frame = session.currentFrame,
              latestTimestamp == frame.timestamp,
              lastArrival > 0,
              CACurrentMediaTime() - lastArrival < 0.25,
              case .normal = frame.camera.trackingState,
              let depth = frame.sceneDepth else {
            reply(NSNull(), nil)
            return
        }
        busy = true
        // Capture all data synchronously on the main ARSession queue before replying to JS.
        let result = buildAtomicFrame(frame, depth: depth)
        busy = false
        reply(result.map { $0 as Any } ?? NSNull(), nil)
    }

    /// Apple documents sceneDepth pixels as corresponding to regions of capturedImage.
    /// RGB and depth are kept in native sensor orientation. Both are rotated together
    /// by the React canvas adapter to avoid mixing crop/display transforms.
    private func buildAtomicFrame(_ frame: ARFrame, depth: ARDepthData) -> [String: Any]? {
        let cameraBuffer = frame.capturedImage
        let map = depth.depthMap
        guard let confidence = depth.confidenceMap,
              CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 else { return nil }

        let cameraWidth = CVPixelBufferGetWidth(cameraBuffer), cameraHeight = CVPixelBufferGetHeight(cameraBuffer)
        let dw = CVPixelBufferGetWidth(map), dh = CVPixelBufferGetHeight(map)
        guard cameraWidth > 0, cameraHeight > 0, dw >= 64, dh >= 48,
              CVPixelBufferGetWidth(confidence) == dw, CVPixelBufferGetHeight(confidence) == dh,
              abs(Double(cameraWidth)/Double(cameraHeight) - Double(dw)/Double(dh)) < 0.03 else { return nil }

        let scale = min(640.0 / Double(cameraWidth), 480.0 / Double(cameraHeight))
        let source = CIImage(cvPixelBuffer: cameraBuffer)
        let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(of: scaled, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                                    options: [:]) else { return nil }

        guard CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        guard let db = CVPixelBufferGetBaseAddress(map), let cb = CVPixelBufferGetBaseAddress(confidence) else { return nil }
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
        guard coverage >= 0.7 else { return nil }
        return [
            "frameId": String(format: "arkit-%0.6f", frame.timestamp),
            "nativeTimestampMs": frame.timestamp * 1000,
            "source": "ARKIT_DEPTH",
            "capturedWithNativeSession": true,
            "alignedToCameraFrame": true,
            "rawDepthFresh": true,
            "cameraWidth": cameraWidth,
            "cameraHeight": cameraHeight,
            "imageBase64": jpeg.base64EncodedString(),
            "depthWidth": w, "depthHeight": h,
            "values": values,
            "validCoverage": coverage
        ]
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
