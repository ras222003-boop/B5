CREATE TABLE IF NOT EXISTS basira_exam_delivery_settings (
  user_id VARCHAR(36) NOT NULL,
  teacher_email VARCHAR(254) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT exam_delivery_settings_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_exam_delivery_log (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  teacher_email VARCHAR(254) NOT NULL,
  exam_title VARCHAR(180) NOT NULL,
  request_key CHAR(64) NOT NULL,
  delivery_status ENUM('pending','sent','failed','uncertain','not_configured') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY exam_delivery_request_key_idx (request_key),
  KEY exam_delivery_user_created_idx (user_id, created_at),
  CONSTRAINT exam_delivery_log_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);
