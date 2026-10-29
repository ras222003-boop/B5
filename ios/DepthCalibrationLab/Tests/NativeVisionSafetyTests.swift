import XCTest
@testable import BasiraDepthCalibrationLab

final class NativeVisionSafetyTests: XCTestCase {
    func testOnlyResourceRevocationIsAllowedAfterLeavingVisionRoute() {
        for path in ["/navigation", "/assistant", "/navigation/native-vision", "/"] {
            XCTAssertTrue(NativeVisionSafety.mayHandleBridgeAction("stop", path: path))
            XCTAssertTrue(NativeVisionSafety.mayHandleBridgeAction("hapticStop", path: path))
            for action in ["start", "frame", "meter", "hapticPulse", "hapticTest", "hapticCapabilities"] {
                XCTAssertFalse(NativeVisionSafety.mayHandleBridgeAction(action, path: path))
            }
        }
        XCTAssertTrue(NativeVisionSafety.mayHandleBridgeAction("start", path: "/navigation/vision"))
    }

    func testHapticRequiresRunningNormalFreshTracking() {
        XCTAssertTrue(NativeVisionSafety.mayPulse(running: true, trackingNormal: true,
                                                  lastArrival: 10, now: 10.1))
        XCTAssertFalse(NativeVisionSafety.mayPulse(running: false, trackingNormal: true,
                                                   lastArrival: 10, now: 10.1))
        XCTAssertFalse(NativeVisionSafety.mayPulse(running: true, trackingNormal: false,
                                                   lastArrival: 10, now: 10.1))
        for (arrival, now) in [(10.0, 10.9), (-1.0, 10.0), (10.0, 9.0),
                                (10.0, Double.nan), (Double.infinity, 10.0)] {
            XCTAssertFalse(NativeVisionSafety.mayPulse(running: true, trackingNormal: true,
                                                       lastArrival: arrival, now: now))
        }
    }

    func testFrameGapStopsAfterWarmupAndRejectsInvalidClock() {
        XCTAssertFalse(NativeVisionSafety.frameGapRequiresStop(lastArrival: -1, startedAt: 10, now: 12))
        XCTAssertTrue(NativeVisionSafety.frameGapRequiresStop(lastArrival: -1, startedAt: 10, now: 13.1))
        XCTAssertFalse(NativeVisionSafety.frameGapRequiresStop(lastArrival: 12, startedAt: 10, now: 12.5))
        XCTAssertTrue(NativeVisionSafety.frameGapRequiresStop(lastArrival: 12, startedAt: 10, now: 12.9))
        XCTAssertTrue(NativeVisionSafety.frameGapRequiresStop(lastArrival: 12, startedAt: 10, now: 11))
        XCTAssertTrue(NativeVisionSafety.frameGapRequiresStop(lastArrival: 12, startedAt: 10, now: .nan))
        XCTAssertTrue(NativeVisionSafety.frameGapRequiresStop(lastArrival: .nan, startedAt: 10, now: 11))
    }
}
