import SwiftUI

@main
struct BasiraNativeApp: App {
    var body: some Scene {
        WindowGroup {
            BasiraUnifiedHome()
                .environment(\.layoutDirection, .rightToLeft)
        }
    }
}

struct BasiraDepthHome: View {
    @StateObject private var depth = NativeDepthSession()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("بصيرة")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.orange)
                    Text("اختبار العمق الأصلي على iPhone")
                        .font(.title3)
                        .foregroundStyle(.white)
                }
                .accessibilityElement(children: .combine)

                GeometryReader { geometry in
                    ZStack {
                        NativeCameraPreview(model: depth)
                            .accessibilityHidden(true)
                        Color.black.opacity(depth.isRunning ? 0 : 0.65)
                        if depth.isRunning {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 34, weight: .light))
                                .foregroundStyle(.orange)
                                .shadow(color: .black, radius: 4)
                                .position(x: geometry.size.width * depth.marker.x,
                                          y: geometry.size.height * depth.marker.y)
                                .accessibilityHidden(true)
                        } else {
                            Text("الكاميرا متوقفة")
                                .foregroundStyle(.white)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .onAppear { depth.viewportSize = geometry.size }
                    .onChange(of: geometry.size) { newSize in depth.viewportSize = newSize }
                }
                .aspectRatio(3 / 4, contentMode: .fit)
                .accessibilityLabel("معاينة الكاميرا؛ علامة القياس تقع عند المركز البصري")

                VStack(alignment: .leading, spacing: 10) {
                    Text("المسافة إلى السطح")
                        .font(.headline)
                    if let metres = depth.metres {
                        Text(String(format: "%.2f متر", metres))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .foregroundStyle(.orange)
                            .accessibilityLabel(String(format: "المسافة المحورية %.2f متر", metres))
                    } else {
                        Text("لا توجد قراءة صالحة")
                            .font(.title2.bold())
                            .foregroundStyle(.yellow)
                        Text(depth.rejection?.arabicDescription ?? "ننتظر قراءة جديدة.")
                            .foregroundStyle(.white)
                    }
                    Text("من سطح الكاميرا، وليست المسافة المستقيمة إلى نقطة خارج المحور.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.85))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 16))
                .accessibilityElement(children: .combine)

                HStack {
                    Label("التتبع: \(depth.trackingText)", systemImage: "viewfinder")
                    Spacer()
                    Text("ثقة المنطقة: \(Int(depth.highConfidenceCoverage * 100))٪")
                }
                .font(.subheadline)
                .foregroundStyle(.white)
                .accessibilityElement(children: .combine)

                Button {
                    if depth.isRunning { depth.stop() } else { depth.start() }
                } label: {
                    Text(depth.isRunning ? "إيقاف الكاميرا" : "بدء القياس")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(depth.isRunning ? .red : .orange)

                Text("اختبار ثابت فقط: وجّه الهاتف إلى سطح واضح دون المشي. لا تستخدم القراءة للملاحة أو تجنب العوائق.")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.88))
                    .accessibilityAddTraits(.isStaticText)
            }
            .padding(20)
        }
        .background(Color(red: 0.05, green: 0.07, blue: 0.10))
        .onAppear { depth.start() }
        .onDisappear { depth.stop() }
        .onChange(of: scenePhase) { phase in
            if phase != .active { depth.stop() }
        }
    }
}
