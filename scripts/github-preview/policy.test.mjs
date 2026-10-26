import { test } from "node:test";
import assert from "node:assert/strict";
import { prefixModelPaths, validBase, previewModelLoading } from "./paths.mjs";
import { previewReadUrl } from "./network-policy.mjs";
test("prefixes only absolute model/API literal heads; preserves application routes, relative paths and nonliteral text", () => {
  const code =
    "const a='/vision/onnx/';const b=`/api/vision/${id}`;const c='/navigation/vision';const d='https://example/vision/a'; // /vision/comment\n";
  const out = prefixModelPaths(code, "/basira-preview/");
  assert.ok(out.includes('"/basira-preview/vision/onnx/"'));
  assert.ok(out.includes("`/basira-preview/api/vision/${id}`"));
  assert.ok(out.includes("'/navigation/vision'"));
  assert.ok(out.includes("https://example/vision/a"));
  assert.ok(out.includes("// /vision/comment"));
});
test("rejects wildcard/traversal/multi-level build bases", () => {
  for (const b of ["/", "/a/../", "/a/b/", "//a/", "/a*/"])
    assert.throws(() => validBase(b));
});
test("public preview changes only initialization and pinned weight caching, keeping frame timeouts and manifest freshness", () => {
  const worker =
    "const inference=5000;const timer=setTimeout(failed,withMasks?45_000:profile?30_000:15_000);";
  const changed = previewModelLoading(
    worker,
    "/client/src/lib/vision/workerObjectProvider.ts"
  );
  assert.ok(changed.includes("inference=5000"));
  assert.ok(changed.includes("failed,180_000"));
  const quality =
    'fetch("/api/vision/object-quality/manifest",{cache:"no-store"});fetch(prefix+"/assets/yolox/yolox_tiny.onnx",{cache:"no-store"});';
  const cached = previewModelLoading(
    quality,
    "/client/src/lib/vision/objectQuality.ts"
  );
  assert.ok(cached.includes('manifest",{cache:"no-store"}'));
  assert.ok(cached.includes('onnx",{cache:"force-cache"}'));
  assert.throws(() =>
    previewModelLoading(
      "changed upstream source",
      "/client/src/lib/vision/workerObjectProvider.ts"
    )
  );
});
test("rejects camera POST, cloud GET and private API reads before network dispatch", () => {
  const check = (input, opts) =>
    previewReadUrl(
      input,
      opts,
      "https://example.github.io",
      "/basira-preview/"
    );
  assert.equal(
    check("/api/vision/describe", { method: "POST", body: "private pixels" })
      .allowed,
    false
  );
  assert.equal(check("https://cloud.invalid/a").allowed, false);
  assert.equal(check("/api/auth/get-session").status, 503);
  assert.equal(
    check("/vision/onnx/runtime.wasm").url,
    "https://example.github.io/basira-preview/vision/onnx/runtime.wasm"
  );
  assert.equal(check("/api/vision/object-quality/manifest").allowed, true);
  assert.equal(check("/different-project/data").allowed, false);
});
