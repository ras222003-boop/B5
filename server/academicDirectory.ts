import { randomUUID } from "node:crypto";
import type { Express, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "./auth";
import { sessionFor, validEmail } from "./examDelivery";

const clean = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, max + 1)
    : "";
const id = (value: unknown) =>
  typeof value === "string" && /^[\da-f-]{36}$/i.test(value) ? value : null;
const nullable = (value: string) => value || null;
export type TeacherInput = {
  name: string;
  email: string;
  institution: string;
  notes: string;
};
export type CourseInput = {
  name: string;
  code: string;
  institution: string;
  notes: string;
  teacherIds: string[];
  defaultTeacherId: string | null;
};
export function parseTeacher(value: unknown): TeacherInput | null {
  const data = value as Record<string, unknown> | null;
  const name = clean(data?.name, 120),
    email = clean(data?.email, 254).toLowerCase(),
    institution = clean(data?.institution, 180),
    notes = clean(data?.notes, 1000);
  return name &&
    name.length <= 120 &&
    validEmail(email) &&
    institution.length <= 180 &&
    notes.length <= 1000
    ? { name, email, institution, notes }
    : null;
}
export function parseCourse(value: unknown): CourseInput | null {
  const data = value as Record<string, unknown> | null;
  const name = clean(data?.name, 180),
    code = clean(data?.code, 40),
    institution = clean(data?.institution, 180),
    notes = clean(data?.notes, 1000);
  const teacherIds = data?.teacherIds,
    defaultTeacherId =
      data?.defaultTeacherId == null ? null : id(data.defaultTeacherId);
  if (
    !name ||
    name.length > 180 ||
    code.length > 40 ||
    institution.length > 180 ||
    notes.length > 1000 ||
    !Array.isArray(teacherIds) ||
    teacherIds.length > 30 ||
    !teacherIds.every(item => id(item)) ||
    new Set(teacherIds).size !== teacherIds.length ||
    (data?.defaultTeacherId != null && !defaultTeacherId) ||
    (defaultTeacherId && !teacherIds.includes(defaultTeacherId))
  )
    return null;
  return { name, code, institution, notes, teacherIds, defaultTeacherId };
}
type TeacherRow = RowDataPacket & {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  notes: string | null;
};
type CourseRow = RowDataPacket & {
  id: string;
  name: string;
  code: string | null;
  institution: string | null;
  notes: string | null;
  default_teacher_id: string | null;
};

export function registerAcademicDirectoryRoutes(app: Express) {
  app.get("/api/academics", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const [teachers] = await pool.execute<TeacherRow[]>(
        "SELECT id,name,email,institution,notes FROM basira_teachers WHERE user_id=? ORDER BY name,id",
        [session.user.id]
      );
      const [courses] = await pool.execute<CourseRow[]>(
        "SELECT id,name,code,institution,notes,default_teacher_id FROM basira_courses WHERE user_id=? ORDER BY name,id",
        [session.user.id]
      );
      const [links] = await pool.execute<
        (RowDataPacket & { course_id: string; teacher_id: string })[]
      >(
        "SELECT ct.course_id,ct.teacher_id FROM basira_course_teachers ct JOIN basira_courses c ON c.id=ct.course_id WHERE c.user_id=?",
        [session.user.id]
      );
      return res.json({
        teachers: teachers.map(t => ({
          id: t.id,
          name: t.name,
          email: t.email,
          institution: t.institution ?? "",
          notes: t.notes ?? "",
        })),
        courses: courses.map(c => ({
          id: c.id,
          name: c.name,
          code: c.code ?? "",
          institution: c.institution ?? "",
          notes: c.notes ?? "",
          defaultTeacherId: c.default_teacher_id,
          teacherIds: links
            .filter(link => link.course_id === c.id)
            .map(link => link.teacher_id),
        })),
      });
    } catch {
      return res.status(503).json({ error: "academics_unavailable" });
    }
  });
  const teacherWrite = async (
    req: any,
    res: Response,
    existingId: string | null
  ) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const data = parseTeacher(req.body);
      if (!data) return res.status(400).json({ error: "invalid_teacher" });
      const teacherId = existingId ?? randomUUID();
      if (existingId) {
        const [result] = await pool.execute<ResultSetHeader>(
          "UPDATE basira_teachers SET name=?,email=?,institution=?,notes=? WHERE id=? AND user_id=?",
          [
            data.name,
            data.email,
            nullable(data.institution),
            nullable(data.notes),
            teacherId,
            session.user.id,
          ]
        );
        if (!result.affectedRows) return res.status(404).end();
      } else
        await pool.execute(
          "INSERT INTO basira_teachers(id,user_id,name,email,institution,notes) VALUES (?,?,?,?,?,?)",
          [
            teacherId,
            session.user.id,
            data.name,
            data.email,
            nullable(data.institution),
            nullable(data.notes),
          ]
        );
      return res
        .status(existingId ? 200 : 201)
        .json({ id: teacherId, ...data });
    } catch {
      return res.status(503).json({ error: "teacher_save_failed" });
    }
  };
  app.post("/api/academics/teachers", (req, res) =>
    teacherWrite(req, res, null)
  );
  app.put("/api/academics/teachers/:id", (req, res) => {
    const teacherId = id(req.params.id);
    return teacherId
      ? teacherWrite(req, res, teacherId)
      : res.status(404).end();
  });
  app.delete("/api/academics/teachers/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const teacherId = id(req.params.id);
      if (!teacherId) return res.status(404).end();
      const [result] = await pool.execute<ResultSetHeader>(
        "DELETE FROM basira_teachers WHERE id=? AND user_id=?",
        [teacherId, session.user.id]
      );
      return result.affectedRows
        ? res.status(204).end()
        : res.status(404).end();
    } catch {
      return res.status(503).json({ error: "teacher_delete_failed" });
    }
  });
  const courseWrite = async (
    req: any,
    res: Response,
    existingId: string | null
  ) => {
    res.set("Cache-Control", "no-store");
    const data = parseCourse(req.body);
    if (!data) return res.status(400).json({ error: "invalid_course" });
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (data.teacherIds.length) {
          const [owned] = await connection.query<RowDataPacket[]>(
            `SELECT id FROM basira_teachers WHERE user_id=? AND id IN (${data.teacherIds.map(() => "?").join(",")})`,
            [session.user.id, ...data.teacherIds]
          );
          if (owned.length !== data.teacherIds.length) {
            await connection.rollback();
            return res.status(400).json({ error: "teacher_not_owned" });
          }
        }
        const courseId = existingId ?? randomUUID();
        if (existingId) {
          const [result] = await connection.execute<ResultSetHeader>(
            "UPDATE basira_courses SET name=?,code=?,institution=?,notes=?,default_teacher_id=? WHERE id=? AND user_id=?",
            [
              data.name,
              nullable(data.code),
              nullable(data.institution),
              nullable(data.notes),
              data.defaultTeacherId,
              courseId,
              session.user.id,
            ]
          );
          if (!result.affectedRows) {
            await connection.rollback();
            return res.status(404).end();
          }
          await connection.execute(
            "DELETE FROM basira_course_teachers WHERE course_id=?",
            [courseId]
          );
        } else
          await connection.execute(
            "INSERT INTO basira_courses(id,user_id,name,code,institution,notes,default_teacher_id) VALUES (?,?,?,?,?,?,?)",
            [
              courseId,
              session.user.id,
              data.name,
              nullable(data.code),
              nullable(data.institution),
              nullable(data.notes),
              data.defaultTeacherId,
            ]
          );
        for (const teacherId of data.teacherIds)
          await connection.execute(
            "INSERT INTO basira_course_teachers(course_id,teacher_id) VALUES (?,?)",
            [courseId, teacherId]
          );
        await connection.commit();
        return res
          .status(existingId ? 200 : 201)
          .json({ id: courseId, ...data });
      } catch {
        await connection.rollback();
        return res.status(503).json({ error: "course_save_failed" });
      } finally {
        connection.release();
      }
    } catch {
      return res.status(503).json({ error: "course_save_failed" });
    }
  };
  app.post("/api/academics/courses", (req, res) => courseWrite(req, res, null));
  app.put("/api/academics/courses/:id", (req, res) => {
    const courseId = id(req.params.id);
    return courseId ? courseWrite(req, res, courseId) : res.status(404).end();
  });
  app.delete("/api/academics/courses/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const courseId = id(req.params.id);
      if (!courseId) return res.status(404).end();
      const [result] = await pool.execute<ResultSetHeader>(
        "DELETE FROM basira_courses WHERE id=? AND user_id=?",
        [courseId, session.user.id]
      );
      return result.affectedRows
        ? res.status(204).end()
        : res.status(404).end();
    } catch {
      return res.status(503).json({ error: "course_delete_failed" });
    }
  });
}
