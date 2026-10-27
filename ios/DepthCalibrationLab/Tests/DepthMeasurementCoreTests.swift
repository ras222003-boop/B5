import XCTest
@testable import BasiraDepthCalibrationLab

final class DepthMeasurementCoreTests: XCTestCase {
    private let geometry = DepthGeometry(imageWidth: 160, imageHeight: 120,
                                         depthWidth: 20, depthHeight: 15,
                                         principalX: 80, principalY: 60)

    private func snapshot(value: Float = 2, confidence: UInt8 = 2,
                          age: Double = 0.02, tracking: Bool = true) -> DepthSnapshot {
        DepthSnapshot(geometry: geometry,
                      depthMetres: Array(repeating: value, count: 300),
                      confidence: Array(repeating: confidence, count: 300),
                      highConfidenceValue: 2, ageSeconds: age,
                      trackingNormal: tracking)
    }

    func testOpticalCentreMapsFromRGBToLowerResolutionDepth() {
        let offset = DepthGeometry(imageWidth: 160, imageHeight: 120,
                                   depthWidth: 20, depthHeight: 15,
                                   principalX: 112, principalY: 64)
        XCTAssertEqual(offset.opticalCentreInDepth()?.x, 14)
        XCTAssertEqual(offset.opticalCentreInDepth()?.y, 8)
        let mismatch = DepthGeometry(imageWidth: 160, imageHeight: 120,
                                     depthWidth: 20, depthHeight: 20,
                                     principalX: 80, principalY: 60)
        XCTAssertNil(mismatch.opticalCentreInDepth())
    }

    func testValidHighConfidenceAxialDepth() {
        let result = DepthMeasurementCore.evaluate(snapshot())
        XCTAssertEqual(result.axialMetres ?? 0, 2, accuracy: 0.001)
        XCTAssertEqual(result.highConfidenceCoverage, 1)
        XCTAssertNil(result.rejection)
    }

    func testBadDataAndTrackingNeverProduceMetres() {
        XCTAssertEqual(DepthMeasurementCore.evaluate(snapshot(value: .nan)).rejection, .lowConfidence)
        XCTAssertEqual(DepthMeasurementCore.evaluate(snapshot(value: -1)).rejection, .lowConfidence)
        XCTAssertEqual(DepthMeasurementCore.evaluate(snapshot(confidence: 0)).rejection, .lowConfidence)
        XCTAssertEqual(DepthMeasurementCore.evaluate(snapshot(age: 0.3)).rejection, .staleFrame)
        XCTAssertEqual(DepthMeasurementCore.evaluate(snapshot(tracking: false)).rejection, .trackingLimited)
        var truncated = snapshot()
        truncated = DepthSnapshot(geometry: truncated.geometry,
                                  depthMetres: [2], confidence: truncated.confidence,
                                  highConfidenceValue: 2, ageSeconds: 0,
                                  trackingNormal: true)
        XCTAssertEqual(DepthMeasurementCore.evaluate(truncated).rejection, .invalidPixels)
    }

    func testMixedSurfaceIsRejected() {
        var depths = Array(repeating: Float(1), count: 300)
        for y in 0..<15 {
            for x in 10..<20 { depths[y * 20 + x] = 3 }
        }
        let input = DepthSnapshot(geometry: geometry, depthMetres: depths,
                                  confidence: Array(repeating: 2, count: 300),
                                  highConfidenceValue: 2, ageSeconds: 0,
                                  trackingNormal: true)
        XCTAssertEqual(DepthMeasurementCore.evaluate(input).rejection, .mixedSurface)
    }

    func testThreeNewFramesRequiredAndStopClearsReading() {
        let stream = DepthMeasurementStream()
        let valid = DepthMeasurementCore.evaluate(snapshot())
        XCTAssertEqual(stream.ingest(timestamp: 1, estimate: valid).rejection, .cameraStopped)
        stream.start()
        XCTAssertEqual(stream.ingest(timestamp: 1, estimate: valid).rejection, .stabilizing)
        XCTAssertEqual(stream.ingest(timestamp: 1, estimate: valid).rejection, .repeatedFrame)
        XCTAssertEqual(stream.ingest(timestamp: 2, estimate: valid).rejection, .stabilizing)
        XCTAssertEqual(stream.ingest(timestamp: 3, estimate: valid).rejection, .stabilizing)
        XCTAssertEqual(stream.ingest(timestamp: 4, estimate: valid).axialMetres ?? 0, 2, accuracy: 0.001)
        stream.stop()
        XCTAssertEqual(stream.ingest(timestamp: 5, estimate: valid).rejection, .cameraStopped)
        stream.start()
        XCTAssertEqual(stream.ingest(timestamp: 6, estimate: valid).rejection, .stabilizing)
    }
}
