CREATE TABLE IF NOT EXISTS basira_teachers (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  institution VARCHAR(180) NULL,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY teachers_owner_idx (user_id, name),
  CONSTRAINT teachers_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS basira_courses (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  code VARCHAR(40) NULL,
  institution VARCHAR(180) NULL,
  notes VARCHAR(1000) NULL,
  default_teacher_id VARCHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY courses_owner_idx (user_id, name),
  CONSTRAINT courses_user_fk FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  CONSTRAINT courses_default_teacher_fk FOREIGN KEY (default_teacher_id) REFERENCES basira_teachers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS basira_course_teachers (
  course_id VARCHAR(36) NOT NULL,
  teacher_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (course_id, teacher_id),
  CONSTRAINT course_teacher_course_fk FOREIGN KEY (course_id) REFERENCES basira_courses(id) ON DELETE CASCADE,
  CONSTRAINT course_teacher_teacher_fk FOREIGN KEY (teacher_id) REFERENCES basira_teachers(id) ON DELETE CASCADE
);
