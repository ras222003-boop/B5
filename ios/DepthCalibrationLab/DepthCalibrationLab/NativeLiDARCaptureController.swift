import ARKit
import AVFoundation
import CoreVideo
import QuartzCore
import SceneKit
import UIKit

/// Reads only the central region of an ARKit frame that also supplies the native camera preview.
/// It does NOT align arbitrary bounding boxes to the depth map and does NOT drive safety alerts.
final class NativeLiDARCaptureController: UIViewController, ARSessionDelegate {
    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let captureButton = UIButton(type: .system)
    private let onFinish: ([String: Any]?) -> Void
    private var lastFrameTimestamp: TimeInterval?
    private var lastFrameArrival: CFTimeInterval = 0
    private var finished = false

    init(onFinish: @escaping ([String: Any]?) -> Void) {
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("Storyboard is not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.scene = SCNScene()
        view.addSubview(sceneView)
        NSLayoutConstraint.activate([
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        let crosshair = UILabel()
        crosshair.text = "＋"
        crosshair.font = .systemFont(ofSize: 58, weight: .light)
        crosshair.textColor = .white
        crosshair.textAlignment = .center
        crosshair.isAccessibilityElement = false
        crosshair.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(crosshair)
        NSLayoutConstraint.activate([
            crosshair.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            crosshair.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])

        let close = UIButton(type: .system)
        close.setTitle("إلغاء القياس", for: .normal)
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        close.accessibilityLabel = "إلغاء القياس وإغلاق الكاميرا"
        style(close)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)

        captureButton.setTitle("التقاط قراءة LiDAR", for: .normal)
        captureButton.addTarget(self, action: #selector(capture), for: .touchUpInside)
        captureButton.isEnabled = false
        captureButton.accessibilityLabel = "التقاط قراءة عمق من منتصف الصورة"
        style(captureButton)
        captureButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(captureButton)

        statusLabel.text = "وجّه علامة المنتصف إلى سطح ثابت، ثم التقط القراءة. للاختبار فقط؛ لا تمشِ أثناء القياس."
        statusLabel.textColor = .white
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.backgroundColor = UIColor.black.withAlphaComponent(0.7)
        statusLabel.accessibilityTraits = [.staticText, .updatesFrequently]
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            close.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
            captureButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -22),
            captureButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            captureButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
            statusLabel.bottomAnchor.constraint(equalTo: captureButton.topAnchor, constant: -14),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16)
        ])

        sceneView.session.delegate = self
        sceneView.session.delegateQueue = .main
    }

    private func style(_ button: UIButton) {
        button.backgroundColor = UIColor.black.withAlphaComponent(0.72)
        button.tintColor = .white
        button.layer.cornerRadius = 12
        button.contentEdgeInsets = UIEdgeInsets(top: 12, left: 18, bottom: 12, right: 18)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        requestCameraAndStart()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
        sceneView.session.delegate = nil
    }

    private func requestCameraAndStart() {
        guard ARWorldTrackingConfiguration.isSupported,
              ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            statusLabel.text = "الجهاز لا يوفّر عمق ARKit من LiDAR. لا يمكن القياس."
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startARSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.startARSession() }
                    else { self?.statusLabel.text = "تم رفض إذن الكاميرا. لا يمكن القياس." }
                }
            }
        case .restricted, .denied:
            statusLabel.text = "اسمح باستخدام الكاميرا من إعدادات iPhone ثم أعد المحاولة."
        @unknown default:
            statusLabel.text = "تعذر التحقق من إذن الكاميرا."
        }
    }

    private func startARSession() {
        guard !finished else { return }
        let configuration = ARWorldTrackingConfiguration()
        configuration.frameSemantics = [.sceneDepth]
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        captureButton.isEnabled = true
        statusLabel.text = "انتظر استقرار الصورة. وجّه علامة المنتصف إلى سطح ثابت، ثم اضغط التقاط."
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        lastFrameTimestamp = frame.timestamp
        lastFrameArrival = CACurrentMediaTime()
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        captureButton.isEnabled = false
        statusLabel.text = "فشل تشغيل ARKit. أعد فتح مختبر العمق."
    }

    @objc private func capture() {
        guard !finished,
              let frame = sceneView.session.currentFrame,
              let newestTimestamp = lastFrameTimestamp,
              abs(frame.timestamp - newestTimestamp) < 0.001,
              CACurrentMediaTime() - lastFrameArrival < 0.25 else {
            statusLabel.text = "إطار العمق قديم أو غير متزامن. ثبّت الهاتف وحاول مجددًا."
            return
        }
        guard case .normal = frame.camera.trackingState else {
            statusLabel.text = "تتبع ARKit غير مستقر. حرّك الهاتف ببطء في مكان ثابت ثم حاول."
            return
        }
        guard let sceneDepth = frame.sceneDepth,
              let result = readCentralDepth(sceneDepth) else {
            statusLabel.text = "لم تتوفر قراءة LiDAR عالية الثقة في منتصف الصورة. غيّر اتجاه الهدف."
            return
        }

        // Only a CENTER-ray measurement; sceneDepth and preview belong to this SAME ARFrame.
        // No claim of pixelwise alignment with the separate Basira web getUserMedia video.
        let payload: [String: Any] = [
            "source": "ARKIT_DEPTH",
            "frameId": String(format: "arkit-%0.6f", frame.timestamp),
            "frameTimestampMs": frame.timestamp * 1000,
            "distanceMeters": result.meters,
            "confidence": result.highConfidenceCoverage,
            "alignedToCameraFrame": true,
            "capturedWithNativeSession": true,
            "rawDepthFresh": true
        ]
        finish(payload)
    }

    /// Read a central 9x9 ROI. Only ARKit HIGH-confidence depth contributes.
    /// Coverage (high-confidence valid pixels / all pixels) is an APP metric,
    /// not an undocumented numeric reinterpretation of ARConfidenceLevel.
    private func readCentralDepth(_ sceneDepth: ARDepthData) -> (meters: Double, highConfidenceCoverage: Double)? {
        let depth = sceneDepth.depthMap
        guard let confidence = sceneDepth.confidenceMap,
              CVPixelBufferGetPixelFormatType(depth) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 else {
            return nil
        }
        let width = CVPixelBufferGetWidth(depth)
        let height = CVPixelBufferGetHeight(depth)
        guard width >= 11, height >= 11,
              CVPixelBufferGetWidth(confidence) == width,
              CVPixelBufferGetHeight(confidence) == height,
              CVPixelBufferLockBaseAddress(depth, .readOnly) == kCVReturnSuccess else {
            return nil
        }
        defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }

        guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else {
            return nil
        }
        defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }

        guard let depthBase = CVPixelBufferGetBaseAddress(depth),
              let confidenceBase = CVPixelBufferGetBaseAddress(confidence) else {
            return nil
        }
        let depthRows = CVPixelBufferGetBytesPerRow(depth) / MemoryLayout<Float32>.stride
        let confidenceRows = CVPixelBufferGetBytesPerRow(confidence)
        let depths = depthBase.assumingMemoryBound(to: Float32.self)
        let confidences = confidenceBase.assumingMemoryBound(to: UInt8.self)

        let cx = width / 2, cy = height / 2
        let radius = 4
        let count = (radius * 2 + 1) * (radius * 2 + 1)
        let high = UInt8(ARConfidenceLevel.high.rawValue)
        var readings: [Double] = []
        for y in (cy-radius)...(cy+radius) {
            for x in (cx-radius)...(cx+radius) {
                guard confidences[y * confidenceRows + x] == high else { continue }
                let meters = Double(depths[y * depthRows + x])
                if meters.isFinite && meters > 0 && meters <= 10 {
                    readings.append(meters)
                }
            }
        }
        let coverage = Double(readings.count) / Double(count)
        guard coverage >= 0.7 else { return nil }
        readings.sort()
        return (readings[readings.count / 2], coverage)
    }

    @objc private func cancel() {
        finish(nil)
    }

    private func finish(_ sample: [String: Any]?) {
        guard !finished else { return }
        finished = true
        captureButton.isEnabled = false
        sceneView.session.pause()
        dismiss(animated: true) { [onFinish] in onFinish(sample) }
    }
}
