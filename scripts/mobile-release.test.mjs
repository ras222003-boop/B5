import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildMobileManifest, writeMobileManifest } from "./write-mobile-release-manifest.mjs";
import { validateMobileOrigin, checkMobileRelease } from "./check-mobile-release.mjs";

const FULL_SHA = "a".repeat(40);
const webHTML = Buffer.from("<!doctype html><html><script type=module src='/assets/main.js'></script></html>");
const htmlSha = createHash("sha256").update(webHTML).digest("hex");
const routes = [
  "/navigation", "/navigation/vision", "/navigation/guidance", "/exam-demo",
  "/assistant", "/account", "/settings/voice", "/teacher",
];

const mockInfo = {
  schemaVersion: 1, product: "basira", status: "BUILT",
  sourceVerified: true, sourceRevision: FULL_SHA,
  webBundle: { assetCount: 2, totalBytes: 1000, sha256: "b".repeat(64), indexSha256: htmlSha },
  declaredRoutes: routes,
};
const readyInfo = {
  status: "READY", capabilities: {
    api: "READY", database: "READY", authentication: "READY",
    mapCore: "READY", optionalModels: "AVAILABLE",
  },
};

function serverResponse(pathname, changes = {}) {
  if (pathname === "/api/mobile-release-info") return { json: changes.info ?? mockInfo };
  if (pathname === "/api/readiness") return { json: changes.readiness ?? readyInfo };
  if (pathname === "/api/vision/object-quality/manifest")
    return { json: changes.model ?? { enabled: true, profiles: [{ id: "objects-basira-v3", commercialTrainingAllowed: true }] } };
  if (pathname === "/" || routes.includes(pathname)) return { html: changes.html ?? webHTML };
  return { status: 404 };
}

function fakeRequest(changes = {}) {
  return async url => {
    const pathname = new URL(url).pathname;
    if (changes.redirect === pathname) return new Response("", {
      status: 302, headers: { Location: "https://manus.im/app-auth", "content-type": "text/html" },
    });
    const result = serverResponse(pathname, changes);
    return new Response(result.html ?? (result.json ? JSON.stringify(result.json) : ""), {
      status: result.status ?? 200,
      headers: { "content-type": result.json ? "application/json" : "text/html" },
    });
  };
}

test("mobile origin rejects insecure, test, local and credential-bearing hosts", () => {
  for (const bad of [
    "", "http://basira.test", "https://example.local", "https://localhost",
    "https://127.0.0.1", "https://basira.invalid", "https://basira.example",
    "https://a:pass@basira.com", "https://basira.com/vision", "https://basira.com?pass=x",
    "https://basira.com#fragment", " https://basira.com ", "https://basira.com\\@evil.test",
  ]) assert.throws(() => validateMobileOrigin(bad), undefined, bad);
  assert.equal(validateMobileOrigin("https://basira.example.org"), "https://basira.example.org");
});

test("internal release gate checks a deployed build, not locally passing unit tests", async () => {
  const result = await checkMobileRelease({
    origin: "https://basira.example.org", expectedRevision: FULL_SHA,
    request: fakeRequest(),
  });
  assert.equal(result.status, "WEB_BACKEND_VERIFIED");
  assert.equal(result.routeCount, routes.length);
});

test("release gate blocks Manus auth redirects, old code, stale HTML and broken API", async () => {
  for (const changes of [
    { redirect: "/navigation/vision" },
    { info: { ...mockInfo, sourceRevision: "b".repeat(40) } },
    { html: Buffer.from("<html>Outdated app</html>") },
    { readiness: { ...readyInfo, status: "DOWN" } },
  ]) {
    await assert.rejects(() => checkMobileRelease({
      origin: "https://basira.example.org", expectedRevision: FULL_SHA,
      request: fakeRequest(changes),
    }));
  }
});

test("full release refuses unavailable / noncommercial V3 models or degraded backend", async () => {
  for (const changes of [
    { model: { enabled: false, profiles: [] } },
    { model: { enabled: true, profiles: [{ id: "objects-basira-v3", commercialTrainingAllowed: false }] } },
    { readiness: { ...readyInfo, capabilities: { ...readyInfo.capabilities, optionalModels: "DEGRADED" } } },
  ]) {
    await assert.rejects(() => checkMobileRelease({
      origin: "https://basira.example.org", expectedRevision: FULL_SHA,
      request: fakeRequest(changes), tier: "release",
    }));
  }
  const result = await checkMobileRelease({
    origin: "https://basira.example.org", expectedRevision: FULL_SHA,
    request: fakeRequest(), tier: "release",
  });
  assert.equal(result.tier, "release");
});

test("web bundle receipt hashes real index and assets and ignores its own receipt", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "basira-mobile-release-"));
  try {
    const src = path.join(cwd, "client", "src");
    const dist = path.join(cwd, "dist", "public");
    await mkdir(src, { recursive: true });
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await writeFile(path.join(src, "App.tsx"), routes.map(route => '<Route path="' + route + '" />').join("\n"));
    await writeFile(path.join(dist, "index.html"), webHTML);
    await writeFile(path.join(dist, "assets", "main.js"), "console.log('basira')");
    const first = await writeMobileManifest({ cwd, providedRevision: FULL_SHA });
    assert.equal(first.sourceRevision, FULL_SHA);
    assert.equal(first.webBundle.assetCount, 2);
    assert.equal(first.webBundle.indexSha256, htmlSha);
    const receipt = JSON.parse(await readFile(path.join(dist, "basira-mobile-release.json"), "utf8"));
    assert.deepEqual(receipt, first);
    const second = await buildMobileManifest({ cwd, providedRevision: FULL_SHA });
    assert.equal(first.webBundle.sha256, second.webBundle.sha256);
    await symlink(path.join(dist, "index.html"), path.join(dist, "symlink.html"));
    await assert.rejects(() => buildMobileManifest({ cwd, providedRevision: FULL_SHA }), /Symlink/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
