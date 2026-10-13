CREATE TABLE IF NOT EXISTS basira_vision_quota_mutex (
  id TINYINT NOT NULL PRIMARY KEY
);
INSERT IGNORE INTO basira_vision_quota_mutex (id) VALUES (1);
CREATE TABLE IF NOT EXISTS basira_vision_entitlements (
  user_id VARCHAR(36) NOT NULL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  minute_limit INT NULL,
  daily_limit INT NULL,
  CONSTRAINT vision_entitlement_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS basira_vision_quota (
  scope VARCHAR(24) NOT NULL,
  subject_key CHAR(64) NOT NULL,
  window_start BIGINT NOT NULL,
  requests INT NOT NULL,
  PRIMARY KEY (scope,subject_key,window_start),
  KEY vision_quota_retention_idx (window_start)
);
CREATE TABLE IF NOT EXISTS basira_vision_leases (
  id CHAR(36) NOT NULL PRIMARY KEY,
  expires_at TIMESTAMP(3) NOT NULL,
  KEY vision_lease_expiry_idx (expires_at)
);
