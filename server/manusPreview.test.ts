import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { request } from "node:http";
import { createPreviewApp } from "../scripts/manus-preview/server";
let folder: string | undefined, server: Server | undefined;
const password = "independent-unit-preview-secret-123456";
// Node fetch does not preserve a supplied Host header on this runtime; exercise the actual HTTP boundary.
async function fetch(
  url: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
  } = {}
) {
  return new Promise<{
    status: number;
    headers: { get: (key: string) => string | null };
    json: () => Promise<any>;
  }>((done, reject) => {
    const req = request(
      url,
      { headers: options.headers, method: options.method },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", b => chunks.push(b));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            headers: {
              get: key => String(res.headers[key.toLowerCase()] ?? "") || null,
            },
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
          })
        );
      }
    );
    req.once("error", reject);
    req.end(options.body);
  });
}
async function fixture() {
  folder = await mkdtemp(resolve(tmpdir(), "basira-manus-preview-test-"));
  await mkdir(resolve(folder, "app"));
  await writeFile(
    resolve(folder, "app/index.html"),
    "<h1>Unit fixture, not Basira UI</h1>"
  );
  await writeFile(
    resolve(folder, "build-receipt.json"),
    JSON.stringify({
      sourceCommit: "a".repeat(40),
      databaseConnected: false,
      weightsIncluded: false,
    })
  );
  return {
    origin: "https://preview.example",
    username: "tester",
    password,
    buildRoot: folder,
    registryRoot: resolve(folder, "absent-models"),
  };
}
async function start() {
  const config = await fixture(),
    app = await createPreviewApp(config);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server!.once("listening", r));
  return "http://127.0.0.1:" + (server.address() as { port: number }).port;
}
const auth = () => ({
  host: "preview.example",
  authorization:
    "Basic " + Buffer.from("tester:" + password).toString("base64"),
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(r => server!.close(() => r()));
    server = undefined;
  }
  if (folder) {
    await rm(folder, { recursive: true, force: true });
    folder = undefined;
  }
});
describe("isolated Manus preview boundary", () => {
  it("requires a separate HTTPS origin and independent strong credentials", async () => {
    const c = await fixture();
    for (const origin of [
      "http://preview.example",
      "https://basira-ve3h8rof.manus.space",
      "https://preview.example/",
    ])
      await expect(createPreviewApp({ ...c, origin })).rejects.toThrow();
    await expect(
      createPreviewApp({ ...c, password: "short" })
    ).rejects.toThrow();
  });
  it("authenticates the page, preserves camera/mic self permission and exposes no database", async () => {
    const base = await start();
    expect(
      (
        await fetch(base + "/navigation/vision", {
          headers: { host: "preview.example" },
        })
      ).status
    ).toBe(401);
    const r = await fetch(base + "/navigation/vision", { headers: auth() });
    expect(r.status).toBe(200);
    expect(r.headers.get("permissions-policy")).toContain("microphone=(self)");
    expect(r.headers.get("content-security-policy")).toContain(
      "connect-src 'self'"
    );
    const status = await fetch(base + "/api/preview/status", {
      headers: auth(),
    }).then(r => r.json());
    expect(status.databaseConnected).toBe(false);
    expect(status.iphoneTested).toBe(false);
    expect(status.modelsAvailable).toBe(false);
  });
  it("rejects host spoofing, cross-site requests and writes before parsing a body", async () => {
    const base = await start();
    expect(
      (
        await fetch(base + "/", {
          headers: { ...auth(), host: "original.example" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(base + "/", {
          headers: { ...auth(), origin: "https://another.example" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(base + "/api/vision/describe", {
          method: "POST",
          headers: auth(),
          body: "private media must not be accepted",
        })
      ).status
    ).toBe(405);
  });
  it("blocks private files, restricted models, cloud and account APIs; models stay opt-in", async () => {
    const base = await start();
    for (const path of [
      "/root-ca.pem",
      "/.env.local",
      "/vision/models/Xenova/model.onnx",
      "/api/vision/object-quality/assets/slimsam/config.json",
    ])
      expect((await fetch(base + path, { headers: auth() })).status).toBe(404);
    expect(
      (await fetch(base + "/api/auth/get-session", { headers: auth() })).status
    ).toBe(503);
    const m = await fetch(base + "/api/vision/object-quality/manifest", {
      headers: auth(),
    }).then(r => r.json());
    expect(m.enabled).toBe(false);
    expect(m.profiles).toEqual([]);
  });
  it("refuses enabling models without an actual pinned admission package", async () => {
    await expect(
      createPreviewApp({ ...(await fixture()), modelsEnabled: true })
    ).rejects.toThrow();
  });
});
