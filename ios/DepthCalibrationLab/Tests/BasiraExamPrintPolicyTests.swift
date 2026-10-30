import XCTest
@testable import BasiraDepthCalibrationLab

final class BasiraExamPrintPolicyTests: XCTestCase {
    private let origin = URL(string: "https://basira.example.org")!
    private let exam = URL(string: "https://basira.example.org/exam-demo")!
    private let html = "<html><body><h1>اختبار بصيرة</h1></body></html>"

    func testOnlyActiveSameOriginExamMainFrameMayPrint() {
        XCTAssertTrue(BasiraExamPrintPolicy.allows(
            source: exam, activePage: exam, origin: origin, isMainFrame: true, html: html))
        XCTAssertFalse(BasiraExamPrintPolicy.allows(
            source: exam, activePage: exam, origin: origin, isMainFrame: false, html: html))
        XCTAssertFalse(BasiraExamPrintPolicy.allows(
            source: URL(string: "https://evil.example.org/exam-demo"),
            activePage: exam, origin: origin, isMainFrame: true, html: html))
        XCTAssertFalse(BasiraExamPrintPolicy.allows(
            source: exam, activePage: URL(string: "https://basira.example.org/account"),
            origin: origin, isMainFrame: true, html: html))
        XCTAssertFalse(BasiraExamPrintPolicy.allows(
            source: URL(string: "http://basira.example.org/exam-demo"),
            activePage: exam, origin: origin, isMainFrame: true, html: html))
    }

    func testRejectsEmptyMalformedAndOverlargePrintHTML() {
        for invalid in ["", "text only", "<html>unclosed"] {
            XCTAssertFalse(BasiraExamPrintPolicy.allows(
                source: exam, activePage: exam, origin: origin,
                isMainFrame: true, html: invalid))
        }
        let enormous = "<html>" + String(repeating: "a", count: 1_000_000) + "</html>"
        XCTAssertFalse(BasiraExamPrintPolicy.allows(
            source: exam, activePage: exam, origin: origin,
            isMainFrame: true, html: enormous))
    }
}
