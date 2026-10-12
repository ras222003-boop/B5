import SwiftUI

/// The signed app opens Basira's existing vision page. The offline depth lab is
/// retained as a fallback for local builds without a configured HTTPS host.
@main
struct BasiraDepthLabApp: App {
    var body: some Scene {
        WindowGroup {
            BasiraHomeScreen()
                .ignoresSafeArea()
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
