import XCTest
@testable import BasiraDepthCalibrationLab

final class BasiraFeatureCatalogueTests: XCTestCase {
    func testAllFeaturesResolveToUniqueKnownLocalRoutes() {
        let paths = BasiraFeature.allCases.map(\.path)
        XCTAssertEqual(Set(paths).count, paths.count, "Duplicated web route")
        for path in paths {
            XCTAssertTrue(path.hasPrefix("/"))
            XCTAssertFalse(path.contains("://"))
            XCTAssertFalse(path.contains(".."))
        }
        XCTAssertEqual(BasiraFeature.vision.path, "/navigation/vision")
        XCTAssertEqual(BasiraFeature.onlineExams.path, "/online-exams")
        XCTAssertEqual(BasiraFeature.guidance.path, "/navigation/guidance")
        XCTAssertEqual(BasiraFeature.teacher.path, "/teacher")
    }

    func testWebOriginNeverUsesUnconfiguredOrInsecureHosts() {
        XCTAssertNil(BasiraWebOrigin.validate(""))
        XCTAssertNil(BasiraWebOrigin.validate("$(BASIRA_IOS_WEB_ORIGIN)"))
        XCTAssertNil(BasiraWebOrigin.validate("https://YOUR-BASIRA-DOMAIN.example"))
        XCTAssertNil(BasiraWebOrigin.validate("http://basira.example.com"))
        XCTAssertNil(BasiraWebOrigin.validate("https://localhost"))
        XCTAssertNil(BasiraWebOrigin.validate("https://example.com/evil"))
        XCTAssertNil(BasiraWebOrigin.validate("https://username:pass@example.com"))
        XCTAssertNil(BasiraWebOrigin.validate("https://example.com?token=secret"))
    }

    func testWebOriginRejectsCrossOriginAndUnapprovedPorts() throws {
        let origin = try XCTUnwrap(BasiraWebOrigin.validate("https://basira.example.org"))
        XCTAssertTrue(BasiraWebOrigin.allows(try XCTUnwrap(URL(string: "https://basira.example.org/navigation/vision")), within: origin))
        XCTAssertFalse(BasiraWebOrigin.allows(try XCTUnwrap(URL(string: "https://phishing.example.org/navigation/vision")), within: origin))
        XCTAssertFalse(BasiraWebOrigin.allows(try XCTUnwrap(URL(string: "http://basira.example.org/navigation/vision")), within: origin))
        XCTAssertFalse(BasiraWebOrigin.allows(try XCTUnwrap(URL(string: "https://basira.example.org:8443/navigation")), within: origin))
    }
}
