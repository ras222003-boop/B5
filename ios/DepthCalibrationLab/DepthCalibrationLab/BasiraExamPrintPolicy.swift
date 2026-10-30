import Foundation

/// The exam HTML is only delivered to the native print sheet after an
/// explicit request from Basira's exam page in the approved main frame.
enum BasiraExamPrintPolicy {
    static func allows(source: URL?, activePage: URL?, origin: URL,
                       isMainFrame: Bool, html: String) -> Bool {
        guard isMainFrame, let source, let activePage,
              BasiraWebOrigin.allows(source, within: origin),
              BasiraWebOrigin.allows(activePage, within: origin),
              source.path == BasiraFeature.examDemo.path,
              activePage.path == BasiraFeature.examDemo.path,
              html.utf8.count <= 1_000_000,
              html.utf8.count >= 10,
              html.range(of: "<html", options: .caseInsensitive) != nil,
              html.range(of: "</html>", options: .caseInsensitive) != nil
        else { return false }
        return true
    }
}
