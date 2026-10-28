import ARKit
import AVFoundation
import Combine
import CoreVideo
import QuartzCore
import SceneKit
import SwiftUI
import UIKit

/// A single ARSession owns both the displayed camera frame and its sceneDepth.
final class NativeDepthSession: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    @Published private(set) var metres: Double?
    @Published private(set) var highConfidenceCoverage = 0.0
    @Published private(set) var rejection: DepthRejection? = .cameraStopped
    @Published private(set) var trackingText = "متوقف"
    @Published private(set) var marker = CGPoint(x: 0.5, y: 0.5)
    @Published private(set) var isRunning = false

    var viewportSize: CGSize = .zero
    private let stream = DepthMeasurementStream()
    private var lastFrameArrival: CFTimeInterval = 0
    private var lastEvaluation: CFTimeInterval = 0
    private var watchdog: Timer?
    private var lastAnnouncement: CFTimeInterval = 0
    private var distanceAnnouncement = DistanceAnnouncementGate()
    private var wantsRun = false

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = .main
    }

    func start() {
        guard !isRunning else { return }
        wantsRun = true
        guard ARWorldTrackingConfiguration.isSupported,
              ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            reject(.unsupportedDevice)
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: runSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard self.wantsRun else { return }
                    if allowed { self.runSession() } else { self.reject(.cameraPermission) }
                }
            }
        case .denied, .restricted: reject(.cameraPermission)
        @unknown default: reject(.cameraPermission)
        }
    }

    private func runSession() {
        guard wantsRun else { return }
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = [.sceneDepth]
        stream.start()
        distanceAnnouncement.reset()
        isRunning = true
        lastFrameArrival = CACurrentMediaTime()
        lastEvaluation = 0
        trackingText = "جاري البدء"
        reject(.noFrame)
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, self.isRunning else { return }
            if CACurrentMediaTime() - self.lastFrameArrival > 0.75 {
                self.trackingText = "لا تصل إطارات"
                self.reject(.staleFrame)
                self.stream.start() // old stabilization samples can never survive a gap
            }
        }
    }

    func stop(reason: DepthRejection = .cameraStopped) {
        wantsRun = false
        watchdog?.invalidate()
        watchdog = nil
        isRunning = false
        stream.stop()
        distanceAnnouncement.reset()
        session.pause()
        trackingText = "متوقف"
        reject(reason)
        marker = CGPoint(x: 0.5, y: 0.5)
    }

    private func reject(_ reason: DepthRejection) {
        let previous = rejection
        metres = nil
        highConfidenceCoverage = 0
        rejection = reason
        if previous != reason, reason != .stabilizing {
            announce(reason.arabicDescription)
        }
    }

    @discardableResult
    private func announce(_ message: String) -> Bool {
        let now = CACurrentMediaTime()
        guard UIAccessibility.isVoiceOverRunning, now - lastAnnouncement >= 4 else { return false }
        lastAnnouncement = now
        UIAccessibility.post(notification: .announcement, argument: message)
        return true
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard isRunning else { return }
        let arrival = CACurrentMediaTime()
        lastFrameArrival = arrival
        guard arrival - lastEvaluation >= 0.18 else { return }
        lastEvaluation = arrival

        guard case .normal = frame.camera.trackingState else {
            trackingText = trackingDescription(frame.camera.trackingState)
            stream.start()
            reject(.trackingLimited)
            return
        }
        trackingText = "طبيعي"
        guard let depth = frame.sceneDepth else {
            stream.start()
            reject(.noDepth)
            return
        }
        guard let snapshot = makeSnapshot(frame: frame, depth: depth, arrival: arrival) else {
            stream.start()
            reject(.invalidPixels)
            return
        }
        guard let latest = session.currentFrame,
              abs(latest.timestamp - frame.timestamp) <= 0.10 else {
            stream.start()
            reject(.staleFrame)
            return
        }
        if snapshot.geometry.opticalCentreInDepth() != nil {
            updateMarker(frame: frame, geometry: snapshot.geometry)
        }
        let estimate = DepthMeasurementCore.evaluate(snapshot)
        let stable = stream.ingest(timestamp: frame.timestamp, estimate: estimate)
        guard let value = stable.axialMetres else {
            reject(stable.rejection ?? .invalidPixels)
            highConfidenceCoverage = stable.highConfidenceCoverage
            return
        }
        metres = value
        highConfidenceCoverage = stable.highConfidenceCoverage
        rejection = nil
        if distanceAnnouncement.shouldAnnounce(value),
           announce(String(format: "المسافة المحورية %.1f متر", value)) {
            distanceAnnouncement.record(value)
        }
    }

    private func makeSnapshot(frame: ARFrame, depth: ARDepthData,
                              arrival: CFTimeInterval) -> DepthSnapshot? {
        let depthMap = depth.depthMap
        guard let confidenceMap = depth.confidenceMap,
              CVPixelBufferGetPixelFormatType(depthMap) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidenceMap) == kCVPixelFormatType_OneComponent8 else {
            return nil
        }
        let width = CVPixelBufferGetWidth(depthMap)
        let height = CVPixelBufferGetHeight(depthMap)
        guard width >= 11, height >= 11, width <= 1024, height <= 1024,
              CVPixelBufferGetWidth(confidenceMap) == width,
              CVPixelBufferGetHeight(confidenceMap) == height,
              CVPixelBufferLockBaseAddress(depthMap, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        guard CVPixelBufferLockBaseAddress(confidenceMap, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(confidenceMap, .readOnly) }
        guard let rawDepth = CVPixelBufferGetBaseAddress(depthMap),
              let rawConfidence = CVPixelBufferGetBaseAddress(confidenceMap) else { return nil }
        let depthStride = CVPixelBufferGetBytesPerRow(depthMap) / MemoryLayout<Float>.stride
        let confidenceStride = CVPixelBufferGetBytesPerRow(confidenceMap)
        guard depthStride >= width, confidenceStride >= width else { return nil }
        let sourceDepth = rawDepth.assumingMemoryBound(to: Float.self)
        let sourceConfidence = rawConfidence.assumingMemoryBound(to: UInt8.self)
        var depths = [Float](repeating: 0, count: width * height)
        var confidences = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height {
            for x in 0..<width {
                depths[y * width + x] = sourceDepth[y * depthStride + x]
                confidences[y * width + x] = sourceConfidence[y * confidenceStride + x]
            }
        }
        let rgb = frame.capturedImage
        let geometry = DepthGeometry(
            imageWidth: CVPixelBufferGetWidth(rgb), imageHeight: CVPixelBufferGetHeight(rgb),
            depthWidth: width, depthHeight: height,
            principalX: Double(frame.camera.intrinsics.columns.2.x),
            principalY: Double(frame.camera.intrinsics.columns.2.y)
        )
        return DepthSnapshot(geometry: geometry, depthMetres: depths,
                             confidence: confidences,
                             highConfidenceValue: UInt8(ARConfidenceLevel.high.rawValue),
                             ageSeconds: CACurrentMediaTime() - arrival,
                             trackingNormal: true)
    }

    private func updateMarker(frame: ARFrame, geometry: DepthGeometry) {
        guard viewportSize.width > 0, viewportSize.height > 0 else { return }
        let imagePoint = CGPoint(x: CGFloat(geometry.principalX / Double(geometry.imageWidth)),
                                 y: CGFloat(geometry.principalY / Double(geometry.imageHeight)))
        let mapped = imagePoint.applying(frame.displayTransform(for: .portrait, viewportSize: viewportSize))
        guard mapped.x.isFinite, mapped.y.isFinite,
              (0...1).contains(mapped.x), (0...1).contains(mapped.y) else { return }
        if abs(mapped.x - marker.x) > 0.005 || abs(mapped.y - marker.y) > 0.005 { marker = mapped }
    }

    private func trackingDescription(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .normal: return "طبيعي"
        case .notAvailable: return "غير متاح"
        case .limited(let reason):
            switch reason {
            case .initializing: return "تهيئة التتبع"
            case .excessiveMotion: return "حركة سريعة"
            case .insufficientFeatures: return "معالم بصرية غير كافية"
            case .relocalizing: return "إعادة تحديد الموقع"
            @unknown default: return "تتبع محدود"
            }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) { stop(reason: .sessionFailed) }
    func sessionWasInterrupted(_ session: ARSession) { stop(reason: .interrupted) }
}

struct NativeCameraPreview: UIViewRepresentable {
    @ObservedObject var model: NativeDepthSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.scene = SCNScene()
        view.session = model.session
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}
