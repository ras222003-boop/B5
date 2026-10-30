import Combine
import Foundation
import StoreKit

/// StoreKit 2 customer purchase UI for digital Basira subscriptions.
///
/// Apple verifies signed StoreKit transactions on-device, but this class does
/// NOT grant cloud/AI/backend privileges. A future authenticated server-side
/// App Store transaction verification and entitlement ledger must authorize
/// those services before charging customers in production.
@MainActor
final class BasiraAppleSubscriptions: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var verifiedProductIDs: Set<String> = []
    @Published private(set) var isBusy = false
    @Published private(set) var message: String?
    @Published private(set) var configurationAvailable = false

    private var updates: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?

    /// Checkout is intentionally off until signed transactions are checked by
    /// our authenticated backend and linked to the customer's account.
    var checkoutEnabled: Bool {
        Bundle.main.object(forInfoDictionaryKey: "BasiraStoreKitCheckoutEnabled") as? Bool == true
    }

    private var ids: [String] {
        guard let data = Bundle.main.object(forInfoDictionaryKey: "BasiraSubscriptionProductIDs") as? [String]
        else { return [] }
        return Array(Set(data.filter {
            $0.hasPrefix("sa.nasjalufuq.basira.") && $0.count <= 128 &&
            $0.range(of: "^[a-zA-Z0-9._-]+$", options: .regularExpression) != nil
        })).sorted()
    }

    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { break }
                switch result {
                case .verified(let transaction):
                    // Do not finish until the authenticated Basira backend
                    // verifies and delivers the paid entitlement. Checkout is
                    // currently hard-disabled, so keep any unexpected verified
                    // transaction pending for future reconciliation.
                    _ = transaction
                    await self?.refreshEntitlements()
                case .unverified:
                    self?.message = "تعذر التحقق من المعاملة عبر Apple. لن تُفعّل أي صلاحيات مدفوعة."
                }
            }
        }
        loadTask = Task { [weak self] in await self?.loadProducts() }
    }

    func stop() {
        updates?.cancel()
        updates = nil
        loadTask?.cancel()
        loadTask = nil
    }

    func loadProducts() async {
        let requested = ids
        guard !requested.isEmpty else {
            configurationAvailable = false
            products = []
            message = "لم تُفعَّل منتجات اشتراك بصيرة بعد في App Store Connect."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let matches = try await Product.products(for: requested)
            products = matches
                .filter { $0.type == .autoRenewable && requested.contains($0.id) }
                .sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
            configurationAvailable = !products.isEmpty
            if products.isEmpty {
                message = "لم تعثر Apple على منتجات اشتراك قابلة للعرض. راجع إعدادات App Store Connect."
            } else {
                message = nil
            }
            await refreshEntitlements()
        } catch {
            configurationAvailable = false
            products = []
            message = "تعذر الاتصال بمنتجات Apple. تحقق من الإنترنت وإعدادات الاشتراك."
        }
    }

    func buy(_ product: Product) async {
        guard checkoutEnabled, ids.contains(product.id), configurationAvailable, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(.verified(let transaction)):
                // Apple-signed but not yet delivered. The backend must persist
                // and authorize the subscription before this can be finished.
                _ = transaction
                await refreshEntitlements()
                message = "وثّقت Apple الشراء، لكن خادم بصيرة لم يؤكد تفعيل الاشتراك. لن نُنهي المعاملة قبل إكمال التفعيل."
            case .success(.unverified):
                message = "تعذر توثيق عملية الشراء. لم نفعّل أي مزايا مدفوعة."
            case .pending:
                message = "الشراء قيد موافقة Apple أو أحد أفراد العائلة. لم يتم التفعيل."
            case .userCancelled:
                message = nil
            @unknown default:
                message = "لم تكتمل عملية الشراء."
            }
        } catch {
            message = "تعذر إتمام عملية الشراء، ولا توجد أي صلاحيات مدفوعة مفعّلة."
        }
    }

    func restore() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await AppStore.sync()
            await refreshEntitlements()
            message = verifiedProductIDs.isEmpty
                ? "لم تظهر اشتراكات فعالة في حساب Apple الحالي."
                : "استعدنا بيانات الاشتراك الموثقة من Apple. مزايا الخادم تتطلب التحقق الخادمي."
        } catch {
            message = "تعذرت استعادة الاشتراكات. حاول لاحقًا."
        }
    }

    func refreshEntitlements() async {
        let allowed = Set(ids)
        var verified = Set<String>()
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  allowed.contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            if let end = transaction.expirationDate, end <= Date() { continue }
            verified.insert(transaction.productID)
        }
        verifiedProductIDs = verified
    }
}
