import SwiftUI

/// Native iPhone shell. Vision continues to use the existing native ARKit/WKWebView
/// bridge. Teacher preparation is a separate SwiftUI screen with local-only data.
@main
struct BasiraDepthLabApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                BasiraHomeScreen()
                    .tabItem {
                        Label("الرؤية", systemImage: "eye")
                    }

                BasiraNativeExamsView()
                    .tabItem {
                        Label("الاختبارات", systemImage: "doc.text")
                    }
            }
            .tint(.orange)
            .environment(\.layoutDirection, .rightToLeft)
        }
    }
}

private struct BasiraHomeScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "BasiraVisionURL") as? String,
           let url = URL(string: raw), url.scheme == "https",
           let host = url.host, !host.contains(".example"),
           url.path == "/navigation/vision" {
            return NativeMetricVisionController()
        }
        return NativeCalibrationHomeController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
