CREATE TABLE IF NOT EXISTS basira_mapping_sessions (
  id varchar(36) PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  started_by varchar(36) NOT NULL,
  started_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at timestamp(3) NULL,
  status enum('ACTIVE','COMPLETED','CANCELLED','REVIEW_REQUIRED') NOT NULL DEFAULT 'ACTIVE',
  start_anchor json NULL,
  confidence decimal(4,3) NOT NULL DEFAULT 0,
  device_capabilities json NOT NULL,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (started_by) REFERENCES `user`(id) ON DELETE CASCADE,
  INDEX mapping_session_building_idx (building_id,status)
);

CREATE TABLE IF NOT EXISTS basira_mapping_track (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id varchar(36) NOT NULL,
  recorded_at timestamp(3) NOT NULL,
  floor_id varchar(36) NULL,
  x decimal(12,3) NOT NULL,
  y decimal(12,3) NOT NULL,
  heading_degrees decimal(6,2) NULL,
  confidence decimal(4,3) NOT NULL,
  source_summary json NOT NULL,
  FOREIGN KEY (session_id) REFERENCES basira_mapping_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE SET NULL,
  UNIQUE KEY mapping_track_point_idx (session_id,recorded_at),
  INDEX mapping_track_session_idx (session_id,recorded_at)
);

CREATE TABLE IF NOT EXISTS basira_mapping_anchors (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id varchar(36) NOT NULL,
  observed_at timestamp(3) NOT NULL,
  floor_id varchar(36) NOT NULL,
  node_id varchar(36) NULL,
  place_id varchar(36) NULL,
  x decimal(12,3) NOT NULL,
  y decimal(12,3) NOT NULL,
  confidence decimal(4,3) NOT NULL,
  `source` varchar(32) NOT NULL,
  FOREIGN KEY (session_id) REFERENCES basira_mapping_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE CASCADE,
  UNIQUE KEY mapping_anchor_time_idx (session_id,observed_at)
);

CREATE TABLE IF NOT EXISTS basira_mapping_floor_events (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id varchar(36) NOT NULL,
  occurred_at timestamp(3) NOT NULL,
  `type` enum('ENTER_ELEVATOR','EXIT_ELEVATOR','STAIRS_TRANSITION','FLOOR_CONFIRMED') NOT NULL,
  floor_id varchar(36) NULL,
  `source` varchar(32) NOT NULL,
  FOREIGN KEY (session_id) REFERENCES basira_mapping_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE SET NULL,
  UNIQUE KEY mapping_floor_event_time_idx (session_id,occurred_at,`type`)
);

CREATE TABLE IF NOT EXISTS basira_map_suggestions (
  id varchar(36) PRIMARY KEY,
  session_id varchar(36) NOT NULL,
  building_id varchar(36) NOT NULL,
  floor_id varchar(36) NULL,
  `type` enum('NEW_NODE','NEW_EDGE','PLACE_ANCHOR','CORRIDOR','INTERSECTION','DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT','FLOOR_TRANSITION') NOT NULL,
  status enum('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  confidence decimal(4,3) NOT NULL,
  x decimal(12,3) NULL,
  y decimal(12,3) NULL,
  name varchar(255) NULL,
  place_id varchar(36) NULL,
  suggested_place_type varchar(32) NULL,
  from_node_id varchar(36) NULL,
  to_node_id varchar(36) NULL,
  `source` json NOT NULL,
  `geometry` json NULL,
  dedup_key varchar(255) NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at timestamp(3) NULL,
  reviewed_by varchar(36) NULL,
  FOREIGN KEY (session_id) REFERENCES basira_mapping_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE SET NULL,
  FOREIGN KEY (place_id) REFERENCES basira_places(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES `user`(id) ON DELETE SET NULL,
  UNIQUE KEY suggestion_session_dedup_idx (session_id,dedup_key),
  INDEX suggestion_review_idx (building_id,status)
);
