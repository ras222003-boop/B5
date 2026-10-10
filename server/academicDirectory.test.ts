import type { Express, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./auth", () => ({
  pool: {
    execute: mocks.execute,
    getConnection: async () => ({
      execute: mocks.execute,
      query: mocks.query,
      beginTransaction: mocks.beginTransaction,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }),
  },
}));
vi.mock("./examDelivery", () => ({
  sessionFor: async (req: Request, res: Response) =>
    (req as any).user
      ? { user: (req as any).user }
      : (res.status(401).json({ error: "authentication_required" }), null),
  validEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
}));
import {
  parseCourse,
  parseTeacher,
  registerAcademicDirectoryRoutes,
} from "./academicDirectory";
const teacherId = "11111111-1111-4111-8111-111111111111",
  courseId = "22222222-2222-4222-8222-222222222222";
type Handler = (req: Request, res: Response) => Promise<unknown>;
const routes = new Map<string, Handler>();
const app = Object.fromEntries(
  ["get", "post", "put", "delete"].map(method => [
    method,
    (path: string, handler: Handler) =>
      routes.set(`${method.toUpperCase()} ${path}`, handler),
  ])
) as unknown as Express;
const request = (body: unknown = {}, user = { id: "student" }) =>
  ({ body, user, params: { id: teacherId } }) as unknown as Request;
const response = () => {
  const state = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
    set() {
      return this;
    },
    end() {
      return this;
    },
  };
  return state as unknown as Response & { statusCode: number; body: any };
};
describe("academic directory", () => {
  beforeEach(() => {
    routes.clear();
    vi.clearAllMocks();
    registerAcademicDirectoryRoutes(app);
    mocks.execute.mockResolvedValue([
      [
        {
          id: teacherId,
          name: "Teacher",
          email: "teacher@example.com",
          institution: null,
          notes: null,
        },
      ],
    ]);
    mocks.query.mockResolvedValue([[{ id: teacherId }]]);
  });
  it("validates links, default teacher and email before writing", () => {
    expect(parseTeacher({ name: "Teacher", email: "bad" })).toBeNull();
    expect(
      parseCourse({
        name: "Physics",
        teacherIds: [teacherId],
        defaultTeacherId: courseId,
      })
    ).toBeNull();
    expect(
      parseCourse({
        name: "Physics",
        teacherIds: [teacherId],
        defaultTeacherId: teacherId,
      })?.teacherIds
    ).toEqual([teacherId]);
  });
  it("loads only rows belonging to the signed-in user", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        [
          {
            id: teacherId,
            name: "Teacher",
            email: "teacher@example.com",
            institution: null,
            notes: null,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: courseId,
            name: "Physics",
            code: null,
            institution: null,
            notes: null,
            default_teacher_id: teacherId,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [{ course_id: courseId, teacher_id: teacherId }],
      ]);
    const res = response();
    await routes.get("GET /api/academics")!(request(), res);
    expect(res.body.courses[0].teacherIds).toEqual([teacherId]);
    expect(
      mocks.execute.mock.calls.every((call: any) => call[1]?.[0] === "student")
    ).toBe(true);
  });
  it("rejects a course linked to a teacher outside the student account and rolls back", async () => {
    mocks.query.mockResolvedValueOnce([[]]);
    const res = response();
    await routes.get("POST /api/academics/courses")!(
      request({
        name: "Physics",
        teacherIds: [teacherId],
        defaultTeacherId: teacherId,
      }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("saves a linked course atomically and rejects anonymous access", async () => {
    const res = response();
    await routes.get("POST /api/academics/courses")!(
      request({
        name: "Physics",
        teacherIds: [teacherId],
        defaultTeacherId: teacherId,
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    expect(mocks.commit).toHaveBeenCalled();
    const anonymous = response();
    await routes.get("GET /api/academics")!(
      { ...request(), user: null } as any,
      anonymous
    );
    expect(anonymous.statusCode).toBe(401);
  });
});
