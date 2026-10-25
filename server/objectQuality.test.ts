import { afterEach, describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { objectQualityHandler } from "./objectQuality";
const base = resolve(".vision-ai");
let root: string | undefined;
afterEach(async () => {
  if (root) {
    if (dirname(root) !== base) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});
async function fixture() {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(resolve(base, "object-quality-test-"));
  await mkdir(resolve(root, "yolox"));
  const bytes = Buffer.from("unit-test model bytes, not an inference artifact"),
    sha = createHash("sha256").update(bytes).digest("hex");
  const profile = {
    id: "objects-yolox-tiny",
    name: "test only",
    model: "yolox-tiny",
    threshold: 0.5,
    modelSha256: sha,
    navigationEligible: false,
    productionEligible: false,
    humanApproval: false,
    maskForStills: false,
    maskModel: "slimsam-q8",
    maskQualification: "REJECTED_FINAL",
    colorStatus: "UNPROVEN",
    validationSha256: "a".repeat(64),
    assets: { "yolox/yolox_tiny.onnx": { sha256: sha, bytes: bytes.length } },
  };
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(profile));
  await writeFile(resolve(root, "yolox/yolox_tiny.onnx"), bytes);
  return root;
}
async function request(
  handler: ReturnType<typeof objectQualityHandler>,
  url: string,
  changes: Record<string, unknown> = {}
) {
  const result = {
    status: 200,
    body: "",
    headers: {} as Record<string, string>,
  };
  const req = {
    url,
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:4350" },
    ...changes,
  } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      result.headers[k] = v;
    },
    set statusCode(n: number) {
      result.status = n;
    },
    end: (v: unknown) => {
      result.body = String(v ?? "");
    },
  } as unknown as Response;
  await handler(req, res, (() => {}) as NextFunction);
  return result;
}
describe("local research model boundary", () => {
  it("is disabled by default and rejects published asset roots", async () => {
    expect(
      JSON.parse(
        (
          await request(
            objectQualityHandler(),
            "/api/vision/object-quality/manifest"
          )
        ).body
      ).enabled
    ).toBe(false);
    expect(() =>
      objectQualityHandler({ root: resolve("client/public/quality") })
    ).toThrow("cannot be published");
  });
  it("checks origin, local socket, method and model identity", async () => {
    const root = await fixture(),
      handler = objectQualityHandler({ enabled: true, root });
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          socket: { remoteAddress: "192.168.1.10" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          headers: { host: "127.0.0.1:4350", origin: "https://evil.example" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          method: "POST",
        })
      ).status
    ).toBe(405);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/../manifest.json"
        )
      ).status
    ).toBe(404);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(200);
    await writeFile(resolve(root, "yolox/yolox_tiny.onnx"), "tampered");
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(503);
  });
});
