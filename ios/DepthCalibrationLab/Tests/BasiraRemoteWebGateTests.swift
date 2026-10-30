import XCTest
@testable import BasiraDepthCalibrationLab

final class BasiraRemoteWebGateTests: XCTestCase {
    private let revision = String(repeating: "a", count: 40)
    private let htmlDigest = String(repeating: "b", count: 64)

    private func manifest(source: String? = nil, routes: [String]? = nil) throws -> Data {
        let required = routes ?? [
            "/navigation", "/navigation/vision", "/navigation/guidance",
            "/exam-demo", "/assistant", "/account", "/settings/voice", "/teacher"
        ]
        let candidate: [String: Any] = [
            "schemaVersion": 1,
            "product": "basira",
            "status": "BUILT",
            "sourceVerified": true,
            "sourceRevision": source ?? revision,
            "webBundle": ["indexSha256": htmlDigest],
            "declaredRoutes": required
        ]
        return try JSONSerialization.data(withJSONObject: candidate)
    }

    private func ready(status: String = "READY", map: String = "READY") throws -> Data {
        let candidate: [String: Any] = [
            "status": status,
            "capabilities": [
                "api": "READY",
                "database": "READY",
                "authentication": "READY",
                "mapCore": map
            ]
        ]
        return try JSONSerialization.data(withJSONObject: candidate)
    }

    @MainActor
    func testMatchingWebBuildReturnsExpectedHtmlHash() throws {
        XCTAssertEqual(
            BasiraRemoteWebGate.indexDigest(for: try manifest(), expectedRevision: revision),
            htmlDigest
        )
    }

    @MainActor
    func testStaleOrUnverifiedWebBuildNeverPasses() throws {
        XCTAssertNil(BasiraRemoteWebGate.indexDigest(
            for: try manifest(source: String(repeating: "c", count: 40)),
            expectedRevision: revision
        ))
        XCTAssertNil(BasiraRemoteWebGate.indexDigest(
            for: try manifest(), expectedRevision: "main"
        ))
        XCTAssertNil(BasiraRemoteWebGate.indexDigest(
            for: try manifest(routes: ["/navigation/vision"]),
            expectedRevision: revision
        ))
        XCTAssertNil(BasiraRemoteWebGate.indexDigest(
            for: Data("not-json".utf8), expectedRevision: revision
        ))
    }

    @MainActor
    func testReadinessMustHaveCoreBackendAvailable() throws {
        XCTAssertTrue(BasiraRemoteWebGate.isReady(try ready()))
        XCTAssertFalse(BasiraRemoteWebGate.isReady(try ready(status: "DOWN")))
        XCTAssertFalse(BasiraRemoteWebGate.isReady(try ready(map: "DOWN")))
        XCTAssertFalse(BasiraRemoteWebGate.isReady(Data("{}".utf8)))
    }
}
