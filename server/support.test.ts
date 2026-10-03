import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./auth", () => ({
  pool: { execute: mocks.execute },
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("better-auth/node", () => ({ fromNodeHeaders: vi.fn(() => ({})) }));
vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

const supportEmail = "aurum.nexus.r1@gmail.com";
const createdAt = new Date("2026-10-03T08:00:00.000Z");

async function ticketRoute() {
  const { registerSupportRoutes } = await import("./support");
  const post = vi.fn();
  const app = { get: vi.fn(), post } as unknown as Express;
  registerSupportRoutes(app);
  const route = post.mock.calls.find(([path]) => path === "/api/support/tickets");
  if (!route) throw new Error("Support ticket route was not registered");
  return route[1] as (req: Request, res: Response) => Promise<Response>;
}

function request(body: Record<string, unknown>): Request {
  return {
    body,
    query: {},
    headers: {},
    ip: "127.0.0.1",
    is: vi.fn(() => true),
    header: vi.fn(() => randomUUID()),
  } as unknown as Request;
}

function response() {
  const res = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

function validTicket() {
  return {
    name: "Basira User",
    email: "user@example.com",
    subject: "Cannot open an exam",
    description: "The exam page does not open after login.",
    language: "en",
  };
}

describe("support ticket SMTP notification", () => {
  let savedTicket: Record<string, unknown> | undefined;
  let events: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SUPPORT_SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SUPPORT_SMTP_PORT", "587");
    vi.stubEnv("SUPPORT_SMTP_SECURE", "false");
    vi.stubEnv("SUPPORT_SMTP_USER", supportEmail);
    vi.stubEnv("SUPPORT_SMTP_PASSWORD", "placeholder-for-mocked-transport");
    vi.stubEnv("SUPPORT_EMAIL_FROM", supportEmail);
    vi.stubEnv("SUPPORT_EMAIL_TO", supportEmail);
    savedTicket = undefined;
    events = [];
    mocks.execute.mockReset();
    mocks.getSession.mockReset().mockResolvedValue(null);
    mocks.createTransport.mockReset().mockImplementation(() => ({ sendMail: mocks.sendMail, close: mocks.close }));
    mocks.sendMail.mockReset().mockImplementation(async () => {
      events.push("send");
      return { accepted: [supportEmail] };
    });
    mocks.close.mockReset();
    mocks.execute.mockImplementation(async (sql: string, args: unknown[] = []) => {
      if (sql.includes("SELECT id,delivery_status") && sql.includes("request_key")) return [[]];
      if (sql.startsWith("INSERT INTO basira_support_tickets")) {
        events.push("insert");
        savedTicket = {
          id: args[0], contact_name: args[2], email: args[3], subject: args[4],
          description: args[5], transcript: args[6], created_at: createdAt,
          delivery_status: "pending",
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET delivery_status='sending'")) {
        if (savedTicket) savedTicket.delivery_status = "sending";
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT * FROM basira_support_tickets")) return [[savedTicket]];
      if (sql.includes("SET delivery_status='sent'")) {
        if (savedTicket) savedTicket.delivery_status = "sent";
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET delivery_status=?")) {
        if (savedTicket) savedTicket.delivery_status = args[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it("validates input before saving or sending", async () => {
    const route = await ticketRoute();
    const res = response();
    await route(request({ ...validTicket(), description: "short" }), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("saves first and sends ticket details to support over Gmail STARTTLS", async () => {
    const route = await ticketRoute();
    const res = response();
    await route(request(validTicket()), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(savedTicket?.delivery_status).toBe("sent");
    expect(events).toEqual(["insert", "send"]);
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true,
    }));
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: supportEmail,
      replyTo: "user@example.com",
      subject: expect.stringContaining("[Basira Support] New Ticket #"),
      text: expect.stringContaining("2026-10-03T08:00:00.000Z"),
    }));
    const message = mocks.sendMail.mock.calls[0][0];
    expect(message.text).toContain("Cannot open an exam");
    expect(message.text).toContain("The exam page does not open after login.");
  });

  it("keeps the saved ticket when SMTP rejects the notification and does not log the error text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("password=do-not-log"), { responseCode: 535 }));
    const route = await ticketRoute();
    const res = response();
    await route(request(validTicket()), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(savedTicket?.id).toEqual(expect.any(String));
    expect(savedTicket?.delivery_status).toBe("failed");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "failed" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("password=do-not-log");
    log.mockRestore();
  });

  it("keeps the ticket and marks a network outcome uncertain without claiming delivery", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendMail.mockRejectedValueOnce(new Error("socket closed after possible acceptance"));
    const route = await ticketRoute();
    const res = response();
    await route(request(validTicket()), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(savedTicket?.delivery_status).toBe("uncertain");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "uncertain" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("socket closed after possible acceptance");
    log.mockRestore();
  });

  it("returns the saved ticket even when the mail claim fails before SMTP starts", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.includes("SET delivery_status='sending'")) throw new Error("mail queue unavailable");
      return execute(sql, args);
    });
    const route = await ticketRoute();
    const res = response();
    await route(request(validTicket()), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(savedTicket?.delivery_status).toBe("pending");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "uncertain" }));
    expect(mocks.sendMail).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("saves without sending when SMTP credentials are absent", async () => {
    vi.stubEnv("SUPPORT_SMTP_PASSWORD", "");
    const route = await ticketRoute();
    const res = response();
    await route(request(validTicket()), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(savedTicket?.delivery_status).toBe("pending");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "pending" }));
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
