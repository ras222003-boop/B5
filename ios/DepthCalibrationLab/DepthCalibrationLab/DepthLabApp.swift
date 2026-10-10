import SwiftUI

/// Research-only companion. Does not enable production obstacle or stair guidance.
@main
struct BasiraDepthLabApp: App {
    var body: some Scene {
        WindowGroup {
            DepthLabWebScreen()
                .ignoresSafeArea()
        }
    }
}

private struct DepthLabWebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> DepthLabBrowserController {
        DepthLabBrowserController()
    }

    func updateUIViewController(_ uiViewController: DepthLabBrowserController, context: Context) {}
}
