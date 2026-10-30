import type { Express } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { RowDataPacket } from "mysql2";
import { auth, pool } from "./auth";
import { activeVerifiedTier, type VerifiedEntitlementRow } from "./billingEntitlements";
import { basiraBillingCapabilities, basiraPlans } from "./billingCatalog";

/**
 * Billing read API: authenticated account status and server-authoritative
 * product availability. No client can mark themselves subscribed.
 *
 * This will remain not_configured until Apple-signed subscription transactions
 * are verified server-side and Tap web callbacks are reconciled. Do not confuse
 * client StoreKit's verified transaction with an active server entitlement.
 */
export function registerBillingRoutes(app: Express) {
  app.get("/api/billing/catalog", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({
      schemaVersion: 1,
      plans: basiraPlans,
      providers: basiraBillingCapabilities,
      currency: null,
      disclaimer: "Prices and availability are determined by Apple or Tap after configuration.",
    });
  });

  app.get("/api/billing/me", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user?.id) return res.status(401).json({ error: "login_required" });
      const [rows] = await pool.execute<(RowDataPacket & VerifiedEntitlementRow)[]>(
        `SELECT plan_id,provider,verification_source,status,valid_until,revoked_at
           FROM basira_billing_entitlements WHERE user_id=?
           ORDER BY verified_at DESC LIMIT 20`,
        [session.user.id],
      );
      const tier = activeVerifiedTier(rows);
      return res.json({
        authenticated: true,
        accountId: session.user.id,
        entitlement: {
          tier,
          activePaidSubscription: tier !== "basic",
          verifiedByServer: tier !== "basic",
        },
        message: tier === "basic" ? "no_provider_verified_paid_subscription" : "verified_entitlement_available",
      });
    } catch {
      return res.status(503).json({ error: "billing_status_unavailable" });
    }
  });

  // Important: no checkout/write endpoint until verified provider callbacks
  // and idempotent paid entitlements are implemented and tested.
}
