/** Shared catalog for Apple digital subscriptions and independent web checkout.
 *  Prices must come from the corresponding provider, never from client claims.
 *  No plans below are chargeable until their live products and entitlements are verified.
 */
export type BasiraPlanID = "basic" | "plus" | "premium";

export interface BasiraPlan {
  id: BasiraPlanID;
  titleAr: string;
  titleEn: string;
  benefitsAr: string[];
  price: null;
  availability: "not_configured";
}

export const basiraPlans: readonly BasiraPlan[] = Object.freeze([
  {
    id: "basic",
    titleAr: "الأساسية",
    titleEn: "Basic",
    benefitsAr: ["الوصول إلى الخدمات المجانية المتاحة", "واجهة بصيرة الميسرة"],
    price: null,
    availability: "not_configured",
  },
  {
    id: "plus",
    titleAr: "بلس",
    titleEn: "Plus",
    benefitsAr: ["مزايا إضافية بعد اجتياز اختبارات الجودة", "خدمات الحساب والبيانات وفق الاشتراك"],
    price: null,
    availability: "not_configured",
  },
  {
    id: "premium",
    titleAr: "المتقدمة",
    titleEn: "Premium",
    benefitsAr: ["قدرات إضافية وفق المواصفات التي ستُعتمد", "أولوية وصول للميزات المؤهلة فقط"],
    price: null,
    availability: "not_configured",
  },
]);

export const basiraBillingCapabilities = Object.freeze({
  appleStoreKit: {
    discoverableInApp: true,
    checkoutEnabled: false,
    serverVerificationEnabled: false,
    note: "Product metadata and server entitlement verification are pending",
  },
  tapWeb: {
    checkoutEnabled: false,
    webOnly: true,
    note: "Merchant configuration, plan prices, webhook and reconciliation are pending",
  },
});
