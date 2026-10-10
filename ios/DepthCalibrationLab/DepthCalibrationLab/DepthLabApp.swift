import SwiftUI

/// A completely offline native test laboratory. No website or cloud is required to measure
/// after the app has been installed through TestFlight.
@main
struct BasiraDepthLabApp: App {
    var body: some Scene {
        WindowGroup {
            NativeCalibrationScreen()
                .ignoresSafeArea()
        }
    }
}

private struct NativeCalibrationScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> NativeCalibrationHomeController {
        NativeCalibrationHomeController()
    }

    func updateUIViewController(_ uiViewController: NativeCalibrationHomeController, context: Context) {}
}
