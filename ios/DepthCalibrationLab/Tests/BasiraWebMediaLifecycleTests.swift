import XCTest
@testable import BasiraDepthCalibrationLab

final class BasiraWebMediaLifecycleTests: XCTestCase {
    func testOnlyVisibleActiveSameOriginMainFrameMayPromptForCapture() throws {
        let origin = try XCTUnwrap(URL(string: "https://basira.example.org"))
        let page = try XCTUnwrap(URL(string: "https://basira.example.org/online-exams"))
        func allows(scheme: String = "https", host: String = "basira.example.org",
                    port: Int = 443, main: Bool = true, target: URL? = nil,
                    active: Bool = true, visible: Bool = true) -> Bool {
            BasiraWebMediaLifecycle.mayRequestCapture(scheme: scheme, host: host, port: port,
                                                      mainFrame: main, page: target ?? page,
                                                      allowedOrigin: origin, active: active, visible: visible)
        }
        XCTAssertTrue(allows())
        XCTAssertTrue(allows(port: 0))
        XCTAssertFalse(allows(scheme: "http"))
        XCTAssertFalse(allows(host: "other.example.org"))
        XCTAssertFalse(allows(port: 8443))
        XCTAssertFalse(allows(main: false))
        XCTAssertFalse(allows(target: URL(string: "https://other.example.org/online-exams")))
        XCTAssertFalse(allows(active: false))
        XCTAssertFalse(allows(visible: false))
        XCTAssertFalse(BasiraWebMediaLifecycle.mayRequestCapture(scheme: "https",
                            host: "basira.example.org", port: 443, mainFrame: true, page: nil,
                            allowedOrigin: origin, active: true, visible: true))
    }
}
