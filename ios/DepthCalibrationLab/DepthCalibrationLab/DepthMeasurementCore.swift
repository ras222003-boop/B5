import Foundation

/// ARKit scene depth is axial distance from the camera plane, in metres.
/// These checks are independent of ARKit so they can run in simulator tests.
enum DepthRejection: Equatable {
    case cameraStopped, unsupportedDevice, cameraPermission, trackingLimited
    case sessionFailed, interrupted
    case noFrame, staleFrame, repeatedFrame, noDepth, invalidGeometry
    case invalidPixels, lowConfidence, mixedSurface, stabilizing

    var arabicDescription: String {
        switch self {
        case .cameraStopped: return "الكاميرا متوقفة."
        case .unsupportedDevice: return "هذا الجهاز لا يوفر عمق LiDAR عبر ARKit."
        case .cameraPermission: return "إذن الكاميرا غير متاح. اسمح به من إعدادات iPhone."
        case .trackingLimited: return "تتبع ARKit غير مستقر. ثبّت الهاتف أمام سطح واضح."
        case .sessionFailed: return "فشلت جلسة ARKit. أعد تشغيل الكاميرا."
        case .interrupted: return "انقطعت جلسة الكاميرا. أعد تشغيلها."
        case .noFrame: return "ننتظر أول إطار من الكاميرا."
        case .staleFrame: return "إطار الكاميرا قديم؛ لا توجد قراءة صالحة."
        case .repeatedFrame: return "لم يصل إطار جديد بعد."
        case .noDepth: return "لا تتوفر خريطة عمق لهذا الإطار."
        case .invalidGeometry: return "تعذرت محاذاة العمق مع صورة الكاميرا."
        case .invalidPixels: return "قيم العمق غير صالحة."
        case .lowConfidence: return "ثقة LiDAR منخفضة في منطقة القياس."
        case .mixedSurface: return "منطقة القياس تحتوي أسطحًا بمسافات مختلفة."
        case .stabilizing: return "ننتظر ثبات القراءة عبر عدة إطارات."
        }
    }
}

struct DepthGeometry {
    let imageWidth: Int
    let imageHeight: Int
    let depthWidth: Int
    let depthHeight: Int
    let principalX: Double
    let principalY: Double

    /// Maps the camera intrinsics' optical centre from RGB pixels into depth pixels.
    /// RGB and depth must belong to the same ARFrame; aspect mismatch is rejected.
    func opticalCentreInDepth() -> (x: Int, y: Int)? {
        guard imageWidth > 0, imageHeight > 0, depthWidth >= 11, depthHeight >= 11,
              principalX.isFinite, principalY.isFinite,
              principalX >= 0, principalX < Double(imageWidth),
              principalY >= 0, principalY < Double(imageHeight) else { return nil }
        let imageAspect = Double(imageWidth) / Double(imageHeight)
        let depthAspect = Double(depthWidth) / Double(depthHeight)
        guard abs(imageAspect - depthAspect) / imageAspect <= 0.02 else { return nil }
        let x = Int(principalX * Double(depthWidth) / Double(imageWidth))
        let y = Int(principalY * Double(depthHeight) / Double(imageHeight))
        guard x >= 4, x + 4 < depthWidth, y >= 4, y + 4 < depthHeight else { return nil }
        return (x, y)
    }
}

struct DepthSnapshot {
    let geometry: DepthGeometry
    let depthMetres: [Float]
    let confidence: [UInt8]
    let highConfidenceValue: UInt8
    let ageSeconds: Double
    let trackingNormal: Bool
}

struct DepthEstimate {
    let axialMetres: Double?
    let highConfidenceCoverage: Double
    let rejection: DepthRejection?

    static func rejected(_ reason: DepthRejection, coverage: Double = 0) -> Self {
        .init(axialMetres: nil, highConfidenceCoverage: coverage, rejection: reason)
    }
}

enum DepthMeasurementCore {
    static func evaluate(_ snapshot: DepthSnapshot) -> DepthEstimate {
        guard snapshot.trackingNormal else { return .rejected(.trackingLimited) }
        guard snapshot.ageSeconds.isFinite, snapshot.ageSeconds >= 0,
              snapshot.ageSeconds <= 0.25 else { return .rejected(.staleFrame) }
        guard let centre = snapshot.geometry.opticalCentreInDepth() else {
            return .rejected(.invalidGeometry)
        }
        let width = snapshot.geometry.depthWidth
        let height = snapshot.geometry.depthHeight
        guard width <= Int.max / height,
              snapshot.depthMetres.count == width * height,
              snapshot.confidence.count == width * height else {
            return .rejected(.invalidPixels)
        }
        var samples: [Double] = []
        for y in (centre.y - 4)...(centre.y + 4) {
            for x in (centre.x - 4)...(centre.x + 4) {
                let index = y * width + x
                guard snapshot.confidence[index] == snapshot.highConfidenceValue else { continue }
                let value = Double(snapshot.depthMetres[index])
                if value.isFinite && value >= 0.2 && value <= 8 { samples.append(value) }
            }
        }
        let coverage = Double(samples.count) / 81
        guard coverage >= 0.7 else { return .rejected(.lowConfidence, coverage: coverage) }
        samples.sort()
        let median = samples[samples.count / 2]
        let tenth = samples[samples.count / 10]
        let ninetieth = samples[(samples.count * 9) / 10]
        guard ninetieth - tenth <= max(0.10, median * 0.08) else {
            return .rejected(.mixedSurface, coverage: coverage)
        }
        return .init(axialMetres: median, highConfidenceCoverage: coverage, rejection: nil)
    }
}

/// Requires three new, mutually consistent frames before exposing a distance.
final class DepthMeasurementStream {
    private(set) var isRunning = false
    private var lastTimestamp: TimeInterval?
    private var accepted: [Double] = []

    func start() {
        isRunning = true
        lastTimestamp = nil
        accepted.removeAll()
    }

    func stop() {
        isRunning = false
        lastTimestamp = nil
        accepted.removeAll()
    }

    func ingest(timestamp: TimeInterval, estimate: DepthEstimate) -> DepthEstimate {
        guard isRunning else { return .rejected(.cameraStopped) }
        guard timestamp.isFinite, lastTimestamp.map({ timestamp > $0 }) ?? true else {
            accepted.removeAll()
            return .rejected(.repeatedFrame)
        }
        lastTimestamp = timestamp
        guard let metres = estimate.axialMetres, estimate.rejection == nil else {
            accepted.removeAll()
            return estimate
        }
        accepted.append(metres)
        if accepted.count > 3 { accepted.removeFirst() }
        guard accepted.count == 3 else { return .rejected(.stabilizing, coverage: estimate.highConfidenceCoverage) }
        let low = accepted.min() ?? metres
        let high = accepted.max() ?? metres
        guard high - low <= max(0.10, metres * 0.08) else {
            accepted.removeAll()
            return .rejected(.mixedSurface, coverage: estimate.highConfidenceCoverage)
        }
        let stable = accepted.sorted()[1]
        return .init(axialMetres: stable, highConfidenceCoverage: estimate.highConfidenceCoverage, rejection: nil)
    }
}
