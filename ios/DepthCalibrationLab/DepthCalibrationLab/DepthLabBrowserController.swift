import UIKit
import WebKit

/// A dedicated host for the research page. Never attaches depth to an unrelated web camera stream.
final class DepthLabBrowserController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView?
    private var allowedHost = ""
    private var pendingCapture = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemBackground

        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BasiraLabURL") as? String,
              let url = URL(string: raw),
              url.scheme == "https",
              let host = url.host,
              !host.contains(".example"),
              url.path == "/navigation/depth-lab" else {
            showError("اضبط BasiraLabURL في Info.plist على رابط مختبر بصيرة المنشور عبر HTTPS قبل تشغيل التطبيق.")
            return
        }
        allowedHost = host.lowercased()

        let controller = WKUserContentController()
        let handler = WeakDepthScriptHandler(owner: self)
        controller.addScriptMessageHandler(handler, contentWorld: .page, name: "basiraDepthLab")
        let script = """
        (() => {
          if (window.BasiraDepthLab) return;
          const bridge = window.webkit && window.webkit.messageHandlers &&
                         window.webkit.messageHandlers.basiraDepthLab;
          if (!bridge) return;
          Object.defineProperty(window, 'BasiraDepthLab', {
            value: Object.freeze({
              captureSample: async () => {
                try { return (await bridge.postMessage({ action: 'capture' })) ?? null; }
                catch { return null; }
              }
            }), enumerable: false, configurable: false
          });
        })();
        """
        controller.addUserScript(WKUserScript(source: script,
                                            injectionTime: .atDocumentStart,
                                            forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.navigationDelegate = self
        browser.translatesAutoresizingMaskIntoConstraints = false
        browser.isOpaque = true
        view.addSubview(browser)
        NSLayoutConstraint.activate([
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            browser.topAnchor.constraint(equalTo: view.topAnchor),
            browser.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        webView = browser
        browser.load(URLRequest(url: url))
    }

    private func showError(_ message: String) {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .label
        label.text = message
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        // Block all off-origin pages, preventing script access on attacker pages.
        let isTrusted = url.scheme == "https" && url.host?.lowercased() == allowedHost
        decisionHandler(isTrusted ? .allow : .cancel)
    }

    fileprivate func onDepthMessage(_ message: WKScriptMessage,
                                    reply: @escaping (Any?, String?) -> Void) {
        guard !pendingCapture,
              message.name == "basiraDepthLab",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == allowedHost,
              let currentURL = webView?.url,
              currentURL.scheme == "https",
              currentURL.host?.lowercased() == allowedHost,
              currentURL.path == "/navigation/depth-lab",
              let body = message.body as? [String: Any],
              body["action"] as? String == "capture" else {
            reply(NSNull(), nil)
            return
        }

        pendingCapture = true
        let scanner = NativeLiDARCaptureController { [weak self] result in
            self?.pendingCapture = false
            reply(result ?? NSNull(), nil)
        }
        scanner.modalPresentationStyle = .fullScreen
        present(scanner, animated: true)
    }
}

/// Avoid the WKWebView -> content controller -> handler -> view controller retention cycle.
private final class WeakDepthScriptHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: DepthLabBrowserController?

    init(owner: DepthLabBrowserController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else {
            replyHandler(NSNull(), nil)
            return
        }
        owner.onDepthMessage(message, reply: replyHandler)
    }
}
