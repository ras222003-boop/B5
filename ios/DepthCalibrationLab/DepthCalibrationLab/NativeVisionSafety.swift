import Foundation

/// Decisions are independent of UI/ARKit so boundary and invalid-clock cases
/// can be checked on the simulator. Hardware delivery still needs an iPhone.
enum NativeVisionSafety {
    /// Used only after native caller/current-page same-origin checks pass.
    static func mayHandleBridgeAction(_ action: String, path: String) -> Bool {
        path == "/navigation/vision" || ["stop", "hapticStop"].contains(action)
    }

    static func mayPulse(running: Bool, trackingNormal: Bool,
                         lastArrival: TimeInterval, now: TimeInterval) -> Bool {
        let age = now - lastArrival
        return running && trackingNormal && lastArrival > 0 &&
               age.isFinite && age >= 0 && age < 0.8
    }

    static func frameGapRequiresStop(lastArrival: TimeInterval,
                                     startedAt: TimeInterval, now: TimeInterval) -> Bool {
        guard lastArrival.isFinite, startedAt.isFinite, now.isFinite else { return true }
        let reference = lastArrival > 0 ? lastArrival : startedAt
        let age = now - reference
        return !age.isFinite || age < 0 || age > (lastArrival > 0 ? 0.8 : 3)
    }
}
