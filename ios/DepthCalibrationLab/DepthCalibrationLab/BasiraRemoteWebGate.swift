import Combine
import CryptoKit
import Foundation

/// An on-device compatibility check for the *deployed* Basira web application.
///
/// It is deliberately independent of login cookies. A stale or authentication-
/// redirected hosting layer must not silently serve an older vision model to the
/// native ARKit bridge. Verification proves matching web/API artifacts only;
/// it does not certify physical safety, model accuracy or feature availability.
@MainActor
final class BasiraRemoteWebGate: ObservableObject {
    enum Phase: Equatable {
        case notChecked
        case checking
        case verified
        case blocked(String)
    }

    @Published private(set) var phase: Phase = .notChecked

    var isVerified: Bool { phase == .verified }

    private static let requiredRoutes = [
        "/navigation", "/navigation/vision", "/navigation/guidance",
        "/exam-demo", "/assistant", "/account", "/settings/voice", "/teacher"
    ]

    private struct ReleaseManifest: Decodable {
        let schemaVersion: Int
        let product: String
        let status: String
        let sourceVerified: Bool
        let sourceRevision: String?
        let webBundle: WebBundle
        let declaredRoutes: [String]

        struct WebBundle: Decodable {
            let indexSha256: String
        }
    }

    private struct APIReadiness: Decodable {
        let status: String
        let capabilities: Capabilities

        struct Capabilities: Decodable {
            let api: String
            let database: String
            let authentication: String
            let mapCore: String
        }
    }

    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    static func indexDigest(for manifestData: Data, expectedRevision: String) -> String? {
        guard expectedRevision.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
              let manifest = try? JSONDecoder().decode(ReleaseManifest.self, from: manifestData),
              manifest.schemaVersion == 1,
              manifest.product == "basira", manifest.status == "BUILT",
              manifest.sourceVerified,
              manifest.sourceRevision == expectedRevision,
              manifest.webBundle.indexSha256.range(
                of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              Self.requiredRoutes.allSatisfy(manifest.declaredRoutes.contains)
        else { return nil }
        return manifest.webBundle.indexSha256
    }

    static func isReady(_ readinessData: Data) -> Bool {
        guard let status = try? JSONDecoder().decode(APIReadiness.self, from: readinessData)
        else { return false }
        return status.status == "READY" &&
            status.capabilities.api == "READY" &&
            status.capabilities.database == "READY" &&
            status.capabilities.authentication == "READY" &&
            status.capabilities.mapCore == "READY"
    }

    private func load(_ url: URL, session: URLSession, mime: String) async throws -> Data {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 12
        request.setValue(mime, forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let type = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
              type.contains(mime),
              data.count <= 2_000_000
        else { throw GateFailure.incompatible }
        return data
    }

    private enum GateFailure: Error { case incompatible }

    func ensureChecked() async {
        guard phase == .notChecked else { return }
        await verify()
    }

    func verify() async {
        guard phase != .checking else { return }
        phase = .checking

        guard let base = BasiraWebOrigin.baseURL,
              let expected = Bundle.main.object(forInfoDictionaryKey: "BasiraWebReleaseSHA") as? String,
              expected.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil
        else {
            phase = .blocked("إعداد إصدار منصة بصيرة غير مكتمل. يبقى قياس LiDAR الأصلي متاحًا.")
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 25
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        do {
            let info = try await load(base.appendingPathComponent("api/mobile-release-info"),
                                      session: session, mime: "application/json")
            guard let digest = Self.indexDigest(for: info, expectedRevision: expected) else {
                throw GateFailure.incompatible
            }

            let readiness = try await load(base.appendingPathComponent("api/readiness"),
                                           session: session, mime: "application/json")
            guard Self.isReady(readiness) else { throw GateFailure.incompatible }

            for route in ["/"] + Self.requiredRoutes {
                let target = route == "/" ? base : base.appendingPathComponent(String(route.dropFirst()))
                let document = try await load(target, session: session, mime: "text/html")
                let observedDigest = SHA256.hash(data: document)
                    .map { String(format: "%02x", $0) }.joined()
                guard observedDigest == digest else { throw GateFailure.incompatible }
            }

            // An old session's cancelled result must not turn an expired build
            // into a verified one. The web view gets mounted only after this.
            guard !Task.isCancelled else { throw CancellationError() }
            phase = .verified
        } catch {
            phase = .blocked(
                "تعذر مطابقة إصدار المنصة مع التطبيق أو فُرض تحويل من الاستضافة. " +
                "لا يمكن تشغيل ميزات الويب حاليًا؛ استخدم LiDAR الأصلي أو أعد الفحص بعد تصحيح الاستضافة."
            )
        }
    }
}
