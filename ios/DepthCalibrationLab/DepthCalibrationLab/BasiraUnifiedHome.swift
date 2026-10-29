import SwiftUI
import UIKit
import WebKit

private enum BasiraMainTab: Hashable {
    case home, vision, depth, exams, more
}

/// A single native entry point for the existing Basira web modules and ARKit lab.
/// Menu presence does not mean web services, permissions, or field safety passed
/// device validation. No server address or secret is embedded by default.
struct BasiraUnifiedHome: View {
    @State private var selectedTab: BasiraMainTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            Group {
                if selectedTab == .home {
                    NavigationStack { BasiraFeatureDirectory(selectedTab: $selectedTab) }
                } else {
                    Color.clear
                }
            }
            .tabItem { Label("الرئيسية", systemImage: "house.fill") }
            .tag(BasiraMainTab.home)

            Group {
                // Unmounting the controller stops its native ARSession on tab exit.
                if selectedTab == .vision, BasiraWebOrigin.baseURL != nil {
                    VStack(spacing: 0) {
                        if let notice = BasiraFeature.vision.integrationNotice {
                            BasiraIntegrationNotice(message: notice)
                        }
                        BasiraNativeVisionHost { selectedTab = .home }
                    }
                } else if BasiraWebOrigin.baseURL == nil {
                    BasiraMissingWebOrigin()
                } else {
                    Color.clear
                }
            }
            .tabItem { Label("الرؤية", systemImage: "eye.fill") }
            .tag(BasiraMainTab.vision)

            Group {
                // TabView may preload hidden tabs. A hidden tab must never ask
                // for camera permission or compete with the native vision tab.
                if selectedTab == .depth { BasiraDepthHome() } else { Color.clear }
            }
                .tabItem { Label("LiDAR", systemImage: "viewfinder") }
                .tag(BasiraMainTab.depth)

            Group {
                if selectedTab == .exams {
                    NavigationStack { BasiraWebFeatureScreen(feature: .examDemo) }
                } else {
                    Color.clear
                }
            }
            .tabItem { Label("الاختبارات", systemImage: "doc.text") }
            .tag(BasiraMainTab.exams)

            Group {
                if selectedTab == .more {
                    NavigationStack { BasiraMoreFeatures() }
                } else {
                    Color.clear
                }
            }
            .tabItem { Label("المزيد", systemImage: "square.grid.2x2") }
            .tag(BasiraMainTab.more)
        }
        .tint(.orange)
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private struct BasiraFeatureDirectory: View {
    @Binding var selectedTab: BasiraMainTab

    var body: some View {
        List {
            Section {
                Text("بصيرة تجمع خدمات المنصة الحالية مع قياس LiDAR الأصلي على iPhone. تعمل خدمات الويب فقط بعد ضبط نطاق HTTPS منشور ومعتمد.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("تنبيهات العوائق والدرج والإرشاد المكاني تجريبية، وليست وسيلة مستقلة لضمان سلامة المشي.")
                    .foregroundStyle(.orange)
                    .font(.footnote)
            }
            Section("الخدمات") {
                ForEach(BasiraFeature.everyday) { feature in
                    if feature == .vision {
                        Button { selectedTab = .vision } label: {
                            BasiraFeatureLabel(feature: feature)
                        }
                        .accessibilityHint("افتح الرؤية باستخدام جسر ARKit في النسخة التجريبية")
                    } else if feature == .examDemo {
                        Button { selectedTab = .exams } label: {
                            BasiraFeatureLabel(feature: feature)
                        }
                    } else {
                        NavigationLink(value: feature) {
                            BasiraFeatureLabel(feature: feature)
                        }
                    }
                }
            }
            Section("مستشعر العمق") {
                Button { selectedTab = .depth } label: {
                    Label("قياس المسافة إلى سطح ثابت", systemImage: "viewfinder")
                }
                Text("لا تستخدِم العمق المحوري لتوجيه المشي أو منع الاصطدام. قارن النتائج بمقياس مرجعي قبل اعتماد الدقة.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("بصيرة")
        .navigationDestination(for: BasiraFeature.self) { feature in
            BasiraWebFeatureScreen(feature: feature)
        }
    }
}

private struct BasiraMoreFeatures: View {
    var body: some View {
        List {
            Section("الخرائط") {
                ForEach(BasiraFeature.maps) { feature in
                    NavigationLink(value: feature) { BasiraFeatureLabel(feature: feature) }
                }
            }
            Section("التعليم والمعلمون") {
                ForEach(BasiraFeature.education) { feature in
                    NavigationLink(value: feature) { BasiraFeatureLabel(feature: feature) }
                }
                NavigationLink {
                    BasiraNativeExamsView()
                } label: {
                    Label("دليل المعلمين المحلي على iPhone", systemImage: "person.crop.rectangle.stack")
                }
            }
            Section("الحساب والصوت") {
                ForEach(BasiraFeature.settings) { feature in
                    NavigationLink(value: feature) { BasiraFeatureLabel(feature: feature) }
                }
            }
            Section("أدوات المؤسسات — صلاحيات خاصة") {
                ForEach(BasiraFeature.administration) { feature in
                    NavigationLink(value: feature) { BasiraFeatureLabel(feature: feature) }
                }
            }
            Section("التجارب والتعريف") {
                ForEach(BasiraFeature.research) { feature in
                    NavigationLink(value: feature) { BasiraFeatureLabel(feature: feature) }
                }
            }
        }
        .navigationTitle("خدمات بصيرة")
        .navigationDestination(for: BasiraFeature.self) { feature in
            BasiraWebFeatureScreen(feature: feature)
        }
    }
}

private struct BasiraFeatureLabel: View {
    let feature: BasiraFeature

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(feature.name).foregroundStyle(.primary)
                Text(feature.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: feature.symbol)
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 4)
    }
}

private struct BasiraNativeVisionHost: UIViewControllerRepresentable {
    let onClose: () -> Void

    func makeUIViewController(context: Context) -> NativeMetricVisionController {
        let controller = NativeMetricVisionController()
        controller.onCloseRequested = onClose
        return controller
    }

    func updateUIViewController(_ controller: NativeMetricVisionController, context: Context) {
        controller.onCloseRequested = onClose
    }

    static func dismantleUIViewController(_ controller: NativeMetricVisionController, coordinator: ()) {
        controller.stopForNavigation()
    }
}

private struct BasiraMissingWebOrigin: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text("رابط منصة بصيرة غير مهيأ")
                .font(.title2.bold())
            Text("يجب ربط التطبيق بنطاق HTTPS الحقيقي للمنصة والتحقق من عمله قبل إصدار TestFlight جديد. لا نستخدم عنوان معاينة تخمينيًا.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
    }
}

private struct BasiraIntegrationNotice: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12))
    }
}

private struct BasiraWebFeatureScreen: View {
    let feature: BasiraFeature
    @State private var failure: String?
    @State private var visible = false

    var body: some View {
        Group {
            if let url = BasiraWebOrigin.url(for: feature),
               let base = BasiraWebOrigin.baseURL {
                VStack(spacing: 0) {
                    if let notice = feature.integrationNotice {
                        BasiraIntegrationNotice(message: notice)
                    }
                    if let failure {
                        Text(failure)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding(10)
                            .frame(maxWidth: .infinity)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    if visible {
                        BasiraEmbeddedWebPage(url: url, allowedOrigin: base) {
                            failure = $0
                        }
                    }
                }
            } else {
                BasiraMissingWebOrigin()
            }
        }
        .navigationTitle(feature.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

/// Constrains in-app navigation to the approved Basira HTTPS origin.
/// External explicit links open in Safari; OAuth redirects may require a
/// separate authenticated-browser flow and must be verified on device.
private struct BasiraEmbeddedWebPage: UIViewRepresentable {
    let url: URL
    let allowedOrigin: URL
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedOrigin: allowedOrigin, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        BasiraWebMediaLifecycle.install(in: config.userContentController)
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        context.coordinator.attach(view)
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.detach()
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let allowedOrigin: URL
        let onFailure: (String) -> Void
        private weak var webView: WKWebView?

        init(allowedOrigin: URL, onFailure: @escaping (String) -> Void) {
            self.allowedOrigin = allowedOrigin
            self.onFailure = onFailure
        }

        func attach(_ view: WKWebView) {
            webView = view
            NotificationCenter.default.addObserver(self, selector: #selector(suspendMedia),
                name: UIApplication.willResignActiveNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(resumeMedia),
                name: UIApplication.didBecomeActiveNotification, object: nil)
        }

        func detach() {
            BasiraWebMediaLifecycle.suspend(webView)
            webView = nil
            NotificationCenter.default.removeObserver(self)
        }

        @objc private func suspendMedia() { BasiraWebMediaLifecycle.suspend(webView) }

        @objc private func resumeMedia() {
            guard webView?.window != nil else { return }
            BasiraWebMediaLifecycle.resume(webView)
        }

        deinit { NotificationCenter.default.removeObserver(self) }

        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let allowed = BasiraWebMediaLifecycle.mayRequestCapture(
                scheme: origin.protocol, host: origin.host, port: origin.port,
                mainFrame: frame.isMainFrame, page: webView.url, allowedOrigin: allowedOrigin,
                active: UIApplication.shared.applicationState == .active,
                visible: webView.window != nil)
            // The approved origin can ask the user; it is never auto-granted.
            decisionHandler(allowed ? .prompt : .deny)
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else {
                decisionHandler(.cancel)
                return
            }
            if target.scheme == "about" || BasiraWebOrigin.allows(target, within: allowedOrigin) {
                decisionHandler(.allow)
            } else {
                // A server-driven redirect cannot silently authorize another host.
                if action.navigationType == .linkActivated,
                   ["https", "mailto", "tel"].contains(target.scheme?.lowercased() ?? "") {
                    UIApplication.shared.open(target)
                } else {
                    onFailure("تحتاج هذه الصفحة إلى فتح خدمة خارج نطاق بصيرة. راجع تدفق الدخول قبل استخدامها داخل التطبيق.")
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard action.targetFrame == nil, let target = action.request.url else { return nil }
            if BasiraWebOrigin.allows(target, within: allowedOrigin) {
                webView.load(action.request)
            } else if action.navigationType == .linkActivated,
                      ["https", "mailto", "tel"].contains(target.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(target)
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            onFailure("تعذر تحميل الخدمة. تحقق من اتصال الإنترنت ونطاق بصيرة المنشور.")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            BasiraWebMediaLifecycle.suspend(webView)
            onFailure("توقفت صفحة الخدمة. أغلقها ثم افتحها من جديد.")
        }
    }
}
