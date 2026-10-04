CREATE TABLE IF NOT EXISTS basira_shared_map_contributions (
  id varchar(36) NOT NULL PRIMARY KEY,
  root_id varchar(36) NOT NULL,
  building_id varchar(36) NOT NULL,
  floor_id varchar(36) NOT NULL,
  contribution_type varchar(40) NOT NULL,
  `source` varchar(30) NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'PENDING',
  visibility varchar(30) NOT NULL DEFAULT 'PUBLIC_CANDIDATE',
  proposal json NOT NULL,
  evidence json NOT NULL,
  fingerprint char(64) NOT NULL,
  actor_key char(64) NOT NULL,
  session_key_hash char(64) NULL,
  device_key_hash char(64) NULL,
  contributed_by varchar(36) NULL,
  external_suggestion_id varchar(36) NULL,
  idempotency_key varchar(80) NOT NULL,
  confidence decimal(5,4) NOT NULL DEFAULT 0,
  trust_weight decimal(4,3) NOT NULL DEFAULT 1,
  independent_confirmations smallint unsigned NOT NULL DEFAULT 1,
  conflict_count smallint unsigned NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  reviewed_at timestamp(3) NULL,
  reviewed_by varchar(36) NULL,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE CASCADE,
  FOREIGN KEY (contributed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  UNIQUE KEY shared_contribution_retry_idx (contributed_by,idempotency_key),
  UNIQUE KEY shared_contribution_actor_idx (root_id,actor_key),
  UNIQUE KEY shared_suggestion_import_idx (external_suggestion_id),
  INDEX shared_contribution_review_idx (building_id,`status`,created_at),
  INDEX shared_contribution_root_idx (root_id,created_at),
  INDEX shared_contribution_fingerprint_idx (building_id,fingerprint)
);

CREATE TABLE IF NOT EXISTS basira_shared_map_confirmations (
  id varchar(36) NOT NULL PRIMARY KEY,
  root_id varchar(36) NOT NULL,
  contribution_id varchar(36) NOT NULL,
  actor_key char(64) NOT NULL,
  session_key_hash char(64) NULL,
  device_key_hash char(64) NULL,
  confirmed_by varchar(36) NULL,
  `source` varchar(30) NOT NULL,
  trust_weight decimal(4,3) NOT NULL DEFAULT 1,
  evidence json NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (contribution_id) REFERENCES basira_shared_map_contributions(id) ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  UNIQUE KEY shared_confirmation_actor_idx (root_id,actor_key),
  INDEX shared_confirmation_root_idx (root_id,created_at)
);

CREATE TABLE IF NOT EXISTS basira_shared_map_conflicts (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  root_id varchar(36) NOT NULL,
  opposing_contribution_id varchar(36) NOT NULL,
  kind varchar(40) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'OPEN',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at timestamp(3) NULL,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (opposing_contribution_id) REFERENCES basira_shared_map_contributions(id) ON DELETE CASCADE,
  UNIQUE KEY shared_conflict_pair_idx (root_id,opposing_contribution_id,kind),
  INDEX shared_conflict_review_idx (building_id,`status`)
);

CREATE TABLE IF NOT EXISTS basira_place_change_candidates (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  target_place_id varchar(36) NOT NULL,
  contribution_id varchar(36) NOT NULL,
  previous_place json NOT NULL,
  proposed_place json NOT NULL,
  evidence json NOT NULL,
  confidence decimal(5,4) NOT NULL DEFAULT 0,
  independent_confirmations smallint unsigned NOT NULL DEFAULT 1,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',
  observed_at timestamp(3) NOT NULL,
  reviewed_at timestamp(3) NULL,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (target_place_id) REFERENCES basira_places(id) ON DELETE CASCADE,
  FOREIGN KEY (contribution_id) REFERENCES basira_shared_map_contributions(id) ON DELETE CASCADE,
  INDEX place_change_review_idx (building_id,`status`),
  INDEX place_change_target_idx (target_place_id,observed_at)
);

CREATE TABLE IF NOT EXISTS basira_map_issue_reports (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  floor_id varchar(36) NULL,
  issue_type varchar(40) NOT NULL,
  duration varchar(20) NOT NULL,
  description varchar(500) NOT NULL,
  target_place_id varchar(36) NULL,
  target_edge_id varchar(36) NULL,
  reporter_user_id varchar(36) NULL,
  idempotency_key varchar(80) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at timestamp(3) NULL,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE SET NULL,
  FOREIGN KEY (target_place_id) REFERENCES basira_places(id) ON DELETE SET NULL,
  FOREIGN KEY (target_edge_id) REFERENCES basira_map_edges(id) ON DELETE SET NULL,
  FOREIGN KEY (reporter_user_id) REFERENCES `user`(id) ON DELETE SET NULL,
  UNIQUE KEY map_issue_retry_idx (reporter_user_id,idempotency_key),
  INDEX map_issue_review_idx (building_id,`status`,created_at)
);

CREATE TABLE IF NOT EXISTS basira_map_versions (
  building_id varchar(36) NOT NULL PRIMARY KEY,
  current_version bigint unsigned NOT NULL DEFAULT 1,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_map_change_log (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  version bigint unsigned NOT NULL,
  change_index smallint unsigned NOT NULL,
  `action` varchar(30) NOT NULL,
  entity_type varchar(20) NOT NULL,
  entity_id varchar(36) NOT NULL,
  before_json json NULL,
  after_json json NULL,
  source_type varchar(30) NOT NULL,
  reviewed_by varchar(36) NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  UNIQUE KEY map_change_version_index_idx (building_id,version,change_index),
  INDEX map_change_history_idx (building_id,created_at)
);
