CREATE TABLE IF NOT EXISTS basira_organizations (
  id varchar(36) NOT NULL PRIMARY KEY,
  name varchar(255) NOT NULL,
  type enum('UNIVERSITY','SCHOOL','HOSPITAL','AIRPORT','MALL','GOVERNMENT','COMPANY','DISABILITY_CENTER','OTHER') NOT NULL,
  description varchar(2000) NULL,
  country varchar(100) NULL,
  city varchar(100) NULL,
  website varchar(500) NULL,
  verification_status enum('UNVERIFIED','VERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
  created_by varchar(36) NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (created_by) REFERENCES `user`(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS basira_organization_memberships (
  organization_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  role enum('organization_admin','mapper','reviewer','viewer') NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id) REFERENCES basira_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  INDEX organization_membership_user_idx (user_id)
);

CREATE TABLE IF NOT EXISTS basira_official_map_imports (
  id varchar(36) NOT NULL PRIMARY KEY,
  organization_id varchar(36) NOT NULL,
  building_id varchar(36) NOT NULL,
  format varchar(30) NOT NULL,
  payload json NOT NULL,
  payload_sha256 char(64) NOT NULL,
  preview json NOT NULL,
  status enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  created_by varchar(36) NOT NULL,
  reviewed_by varchar(36) NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at timestamp(3) NULL,
  FOREIGN KEY (organization_id) REFERENCES basira_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES `user`(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  INDEX official_import_review_idx (organization_id,status,created_at)
);

CREATE TABLE IF NOT EXISTS basira_organization_map_audit_log (
  id varchar(36) NOT NULL PRIMARY KEY,
  organization_id varchar(36) NOT NULL,
  building_id varchar(36) NULL,
  actor_id varchar(36) NULL,
  action varchar(40) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id varchar(36) NOT NULL,
  metadata json NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (organization_id) REFERENCES basira_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_id) REFERENCES `user`(id) ON DELETE SET NULL,
  INDEX organization_audit_idx (organization_id,created_at)
);
