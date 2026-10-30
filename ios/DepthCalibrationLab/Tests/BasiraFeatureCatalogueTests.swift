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

    func testNativeDirectoryContainsEveryPlatformFeatureExactlyOnce() {
        let listed = BasiraFeature.completeDirectory.flatMap(\.features)
        XCTAssertEqual(listed.count, BasiraFeature.allCases.count)
        XCTAssertEqual(Set(listed), Set(BasiraFeature.allCases))
        XCTAssertEqual(Set(listed).count, listed.count, "A service appears in multiple sections")
        XCTAssertEqual(
            Set(BasiraFeature.completeDirectory.map(\.title)).count,
            BasiraFeature.completeDirectory.count
        )
    }

    func testNativeFeatureSearchAndVisibleIntegrationLimitations() {
        XCTAssertTrue(BasiraFeature.vision.matchesSearch("الرؤية"))
        XCTAssertTrue(BasiraFeature.vision.matchesSearch("/navigation/vision"))
        XCTAssertTrue(BasiraFeature.examDemo.matchesSearch("الاختبارات"))
        XCTAssertFalse(BasiraFeature.examDemo.matchesSearch("لاوجودلهذاالمسار"))
        XCTAssertTrue(BasiraFeature.robotics.availability.title.contains("غير مكتمل"))
        XCTAssertTrue(BasiraFeature.onlineExams.availability.title.contains("غير مكتمل"))
        XCTAssertTrue(BasiraFeature.guidance.availability.title.contains("تجريبي"))
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

    func testBuildAndRuntimeOriginRulesRejectAmbiguousURLs() {
        for raw in [" https://basira.example.org", "https://basira.example.org\n",
                    "https://basira.example.org:", "https://basira.example.org:443",
                    "https://basira.example.org?", "https://basira.example.org#",
                    "https://127.0.0.1", "https://10.1.2.3", "https://[::1]",
                    "https://sub.localhost", "https://a.invalid", "https://a.test",
                    "https://bad..host.org", "https://-bad.host.org", "https://host.org.",
                    "https://%62asira.example.org", "https://host.org\\path"] {
            XCTAssertNil(BasiraWebOrigin.validate(raw), raw)
        }
        XCTAssertEqual(BasiraWebOrigin.validate("HTTPS://BASIRA.example.org/")?.absoluteString,
                       "https://basira.example.org")
    }
}
