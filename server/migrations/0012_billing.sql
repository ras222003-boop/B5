-- Read-only in the current release. ONLY a future audited Apple transaction
-- verifier or Tap webhook+charge reconciliation worker may INSERT/UPDATE here.
-- Client JWTs, web redirects, StoreKit screens and email must never write it.
CREATE TABLE IF NOT EXISTS basira_billing_entitlements (
  id char(36) NOT NULL PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  provider enum('APPLE_STOREKIT','TAP_WEB') NOT NULL,
  plan_id enum('basic','plus','premium') NOT NULL,
  product_id varchar(128) NOT NULL,
  provider_transaction_id varchar(191) NOT NULL,
  provider_original_transaction_id varchar(191) DEFAULT NULL,
  verification_source enum('APPLE_SERVER_VERIFIED','TAP_SERVER_RECONCILED') NOT NULL,
  status enum('ACTIVE','GRACE','EXPIRED','REVOKED') NOT NULL,
  verified_at timestamp(3) NOT NULL,
  valid_until timestamp(3) DEFAULT NULL,
  revoked_at timestamp(3) DEFAULT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY unique_provider_transaction (provider, provider_transaction_id),
  KEY billing_user_status (user_id, status, valid_until),
  KEY billing_original_transaction (provider, provider_original_transaction_id),
  CONSTRAINT billing_entitlement_user_fk FOREIGN KEY (user_id)
    REFERENCES `user` (id) ON DELETE CASCADE
);
