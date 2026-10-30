import SwiftUI
import StoreKit

/// Digital subscription purchases use Apple's in-app purchase system.
/// This view never promises backend access until the account entitlement
/// has been validated by the Basira server.
struct BasiraSubscriptionScreen: View {
    @EnvironmentObject private var subscriptions: BasiraAppleSubscriptions

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("اشتراكات بصيرة", systemImage: "creditcard")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)

                Text("اشترك في خدمات بصيرة الرقمية باستخدام نظام Apple الآمن. تظهر الأسعار والعملة من App Store حسب بلد حسابك.")
                    .font(.body)
                Text("المزايا الأساسية المجانية لا تتطلب اشتراكًا. شراء Apple لا يفتح خدمات الخادم حتى يتم ربط الاشتراك بحساب بصيرة والتحقق منه على الخادم.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if subscriptions.isBusy {
                    ProgressView("جاري التواصل مع Apple…")
                        .frame(maxWidth: .infinity)
                }

                if let message = subscriptions.message {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                        .accessibilityAddTraits(.updatesFrequently)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }

                if !subscriptions.checkoutEnabled {
                    Label("الشراء معطّل حاليًا لحماية المستخدم حتى اكتمال التحقق الخادمي والتجربة في Apple Sandbox.", systemImage: "lock.shield")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                        .accessibilityElement(children: .combine)
                }

                if subscriptions.products.isEmpty {
                    Label("الاشتراكات ليست متاحة للشراء في هذه النسخة حتى استكمال إعداد منتجات Apple والتحقق الخادمي.", systemImage: "info.circle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .accessibilityElement(children: .combine)
                } else {
                    ForEach(subscriptions.products, id: \.id) { product in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(product.displayName).font(.headline)
                            Text(product.description)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(product.displayPrice).font(.title3.bold())
                            if subscriptions.verifiedProductIDs.contains(product.id) {
                                Label("تم التحقق من اشتراك Apple، ويجري انتظار ربطه بحساب بصيرة.", systemImage: "checkmark.shield")
                                    .font(.footnote)
                                    .foregroundStyle(.orange)
                            }
                            Button("الاشتراك عبر Apple") {
                                Task { await subscriptions.buy(product) }
                            }
                            .disabled(subscriptions.isBusy || !subscriptions.configurationAvailable || !subscriptions.checkoutEnabled)
                            .buttonStyle(.borderedProminent)
                            .tint(.orange)
                            .accessibilityHint("سيعرض Apple سعر الاشتراك وشروطه النهائية قبل التأكيد")
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }
                }

                Button("استعادة المشتريات") {
                    Task { await subscriptions.restore() }
                }
                .disabled(subscriptions.isBusy)
                .buttonStyle(.bordered)

                Button("إدارة الاشتراكات في Apple") {
                    guard let url = URL(string: "https://apps.apple.com/account/subscriptions") else { return }
                    UIApplication.shared.open(url)
                }
                .buttonStyle(.bordered)

                Text("لا يُحصّل تطبيق iPhone أي رسوم باستخدام بوابة Tap. أي مدفوعات ويب منفصلة تُدار على الموقع وفق قواعد المتجر والبلد.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("تحتاج عمليات الدفع الفعلية إلى اختبار Apple Sandbox، والتحقق من التجديد والإلغاء والاسترداد، قبل الإطلاق.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
        }
        .navigationTitle("الاشتراكات")
        .navigationBarTitleDisplayMode(.inline)
    }
}
