CREATE TABLE IF NOT EXISTS basira_exam_submissions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  course_name VARCHAR(180) NOT NULL,
  exam_title VARCHAR(180) NOT NULL,
  pdf_data LONGBLOB NOT NULL,
  status ENUM('READY_TO_SEND','SENDING','SENT','FAILED') NOT NULL DEFAULT 'READY_TO_SEND',
  approved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY exam_submission_owner_idx (user_id, created_at),
  CONSTRAINT exam_submissions_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_exam_recipient_contacts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  recipient_name VARCHAR(120) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  course_name VARCHAR(180) NOT NULL,
  organization VARCHAR(180) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY exam_contacts_owner_idx (user_id, created_at),
  CONSTRAINT exam_contacts_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_exam_delivery_operations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  request_key CHAR(64) NOT NULL,
  status ENUM('SENDING','SENT','FAILED') NOT NULL DEFAULT 'SENDING',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY exam_operation_request_key_idx (request_key),
  KEY exam_operation_owner_idx (user_id, created_at),
  CONSTRAINT exam_operations_submission_fk FOREIGN KEY (submission_id) REFERENCES basira_exam_submissions(id) ON DELETE CASCADE,
  CONSTRAINT exam_operations_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_exam_delivery_targets (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  recipient_name VARCHAR(120) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  course_name VARCHAR(180) NOT NULL,
  organization VARCHAR(180) NULL,
  delivery_status ENUM('SENDING','SENT','FAILED','UNCERTAIN') NOT NULL DEFAULT 'SENDING',
  sent_at TIMESTAMP(3) NULL,
  failure_reason_code VARCHAR(40) NULL,
  KEY exam_targets_operation_idx (operation_id),
  CONSTRAINT exam_targets_operation_fk FOREIGN KEY (operation_id) REFERENCES basira_exam_delivery_operations(id) ON DELETE CASCADE
);
