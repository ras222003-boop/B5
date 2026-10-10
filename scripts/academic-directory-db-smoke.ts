/** Local MySQL smoke with a temporary user: migrations, persistence, and cascades. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

const configured = process.env.DATABASE_URL;
assert(configured, "DATABASE_URL is required");
const base = new URL(configured);
assert(
  ["localhost", "127.0.0.1"].includes(base.hostname),
  "Only local MySQL is allowed"
);
assert(
  base.pathname === "/basira",
  "Smoke script only runs against the configured local Basira database"
);
let pool: typeof import("../server/auth").pool | undefined;
const userId = randomUUID();
let insertedUser = false;
try {
  const auth = await import("../server/auth");
  pool = auth.pool;
  const { ensureSchema } = await import("../server/migrations");
  await ensureSchema();
  const teacherId = randomUUID(),
    courseId = randomUUID();
  await pool.execute(
    "INSERT INTO `user`(id,name,email,emailVerified) VALUES (?,?,?,0)",
    [userId, "Student", `student-${userId}@example.test`]
  );
  insertedUser = true;
  await pool.execute(
    "INSERT INTO basira_teachers(id,user_id,name,email) VALUES (?,?,?,?)",
    [teacherId, userId, "Professor", "professor@example.test"]
  );
  await pool.execute(
    "INSERT INTO basira_courses(id,user_id,name,default_teacher_id) VALUES (?,?,?,?)",
    [courseId, userId, "Calculus", teacherId]
  );
  await pool.execute(
    "INSERT INTO basira_course_teachers(course_id,teacher_id) VALUES (?,?)",
    [courseId, teacherId]
  );
  await ensureSchema();
  const [saved] = await pool.execute<RowDataPacket[]>(
    "SELECT c.name,t.email FROM basira_courses c JOIN basira_course_teachers ct ON ct.course_id=c.id JOIN basira_teachers t ON t.id=ct.teacher_id WHERE c.id=? AND c.user_id=?",
    [courseId, userId]
  );
  assert.equal(saved[0]?.email, "professor@example.test");
  await pool.execute("DELETE FROM basira_teachers WHERE id=? AND user_id=?", [
    teacherId,
    userId,
  ]);
  const [course] = await pool.execute<RowDataPacket[]>(
    "SELECT default_teacher_id FROM basira_courses WHERE id=?",
    [courseId]
  );
  const [links] = await pool.execute<RowDataPacket[]>(
    "SELECT teacher_id FROM basira_course_teachers WHERE course_id=?",
    [courseId]
  );
  assert.equal(course[0]?.default_teacher_id, null);
  assert.equal(links.length, 0);
  console.log(
    "Academic directory MySQL smoke: PASS (migration, saved rows, rerun, teacher cascade)"
  );
} finally {
  if (pool) {
    if (insertedUser)
      await pool.execute("DELETE FROM `user` WHERE id=? AND email=?", [
        userId,
        `student-${userId}@example.test`,
      ]);
    await pool.end();
  }
}
