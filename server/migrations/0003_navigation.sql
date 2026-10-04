CREATE TABLE IF NOT EXISTS basira_navigation_roles (
  user_id varchar(36) NOT NULL PRIMARY KEY,
  role enum('mapper','admin') NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_buildings (
  id varchar(36) NOT NULL PRIMARY KEY,
  name varchar(255) NOT NULL,
  alternative_names json,
  organization_name varchar(255),
  building_type enum('University','School','Hospital','Airport','Mall','Government','Office','PublicBuilding','Other') NOT NULL,
  description text,
  address varchar(500),
  latitude decimal(10,7),
  longitude decimal(10,7),
  number_of_floors smallint unsigned,
  status enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  map_status enum('UNMAPPED','IN_PROGRESS','MAPPED') NOT NULL DEFAULT 'UNMAPPED',
  verification_status enum('DISCOVERED','COMMUNITY_VERIFIED','OFFICIAL') NOT NULL DEFAULT 'DISCOVERED',
  created_by varchar(36),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (created_by) REFERENCES `user`(id) ON DELETE SET NULL,
  INDEX building_name_idx (name),
  INDEX building_coordinates_idx (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS basira_floors (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  floor_number smallint NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  floor_plan_reference varchar(500),
  local_origin json,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  UNIQUE INDEX floor_building_number_idx (building_id, floor_number)
);

CREATE TABLE IF NOT EXISTS basira_places (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  floor_id varchar(36) NOT NULL,
  name varchar(255) NOT NULL,
  room_number varchar(80),
  aliases json,
  department_name varchar(255),
  description text,
  place_type enum('ROOM','CLASSROOM','OFFICE','LAB','RECEPTION','ELEVATOR','STAIRS','RESTROOM','ENTRANCE','EXIT','EMERGENCY_EXIT','CORRIDOR','INTERSECTION','WAITING_AREA','PHARMACY','CLINIC','SERVICE_POINT','PARKING','OTHER') NOT NULL,
  local_x decimal(12,3),
  local_y decimal(12,3),
  latitude decimal(10,7),
  longitude decimal(10,7),
  entrance_direction varchar(80),
  accessibility_information text,
  verification_status enum('DISCOVERED','COMMUNITY_VERIFIED','OFFICIAL') NOT NULL DEFAULT 'DISCOVERED',
  confidence_score decimal(4,3),
  is_public boolean NOT NULL DEFAULT true,
  created_by varchar(36),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES `user`(id) ON DELETE SET NULL,
  INDEX place_name_idx (name),
  INDEX place_room_idx (room_number),
  INDEX place_building_idx (building_id),
  INDEX place_floor_idx (floor_id)
);

CREATE TABLE IF NOT EXISTS basira_map_nodes (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  floor_id varchar(36) NOT NULL,
  place_id varchar(36),
  x decimal(12,3) NOT NULL,
  y decimal(12,3) NOT NULL,
  node_type enum('POINT','ROOM','CORRIDOR','INTERSECTION','DOOR','STAIRS','ELEVATOR','ENTRANCE','EXIT') NOT NULL,
  accessibility_level enum('UNKNOWN','STANDARD','ACCESSIBLE') NOT NULL DEFAULT 'UNKNOWN',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE CASCADE,
  FOREIGN KEY (place_id) REFERENCES basira_places(id) ON DELETE SET NULL,
  INDEX node_building_idx (building_id, floor_id)
);

CREATE TABLE IF NOT EXISTS basira_map_edges (
  id varchar(36) NOT NULL PRIMARY KEY,
  building_id varchar(36) NOT NULL,
  from_node_id varchar(36) NOT NULL,
  to_node_id varchar(36) NOT NULL,
  distance_meters decimal(10,2) NOT NULL,
  direction varchar(80),
  path_type enum('CORRIDOR','DOOR','STAIRS','RAMP','ELEVATOR','OTHER') NOT NULL,
  accessibility_level enum('UNKNOWN','STANDARD','ACCESSIBLE') NOT NULL DEFAULT 'UNKNOWN',
  has_stairs boolean NOT NULL DEFAULT false,
  has_ramp boolean NOT NULL DEFAULT false,
  wheelchair_accessible boolean NOT NULL DEFAULT false,
  visually_impaired_friendly boolean NOT NULL DEFAULT false,
  temporarily_closed boolean NOT NULL DEFAULT false,
  risk_level enum('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'LOW',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (from_node_id) REFERENCES basira_map_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES basira_map_nodes(id) ON DELETE CASCADE,
  INDEX edge_building_idx (building_id),
  INDEX edge_from_idx (from_node_id),
  INDEX edge_to_idx (to_node_id)
);

CREATE TABLE IF NOT EXISTS basira_saved_places (
  id varchar(36) NOT NULL PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  name varchar(255) NOT NULL,
  category enum('STUDY','WORK','CAR','HOME','HEALTH','FAVORITE','OTHER') NOT NULL DEFAULT 'OTHER',
  notes text,
  latitude decimal(10,7),
  longitude decimal(10,7),
  building_id varchar(36),
  floor_id varchar(36),
  place_id varchar(36),
  is_favorite boolean NOT NULL DEFAULT false,
  last_used_at timestamp(3) NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES basira_buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (floor_id) REFERENCES basira_floors(id) ON DELETE SET NULL,
  FOREIGN KEY (place_id) REFERENCES basira_places(id) ON DELETE SET NULL,
  INDEX saved_owner_idx (user_id, updated_at),
  INDEX saved_favorite_idx (user_id, is_favorite)
);
