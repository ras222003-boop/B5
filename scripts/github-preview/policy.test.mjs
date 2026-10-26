import { test } from "node:test";
import assert from "node:assert/strict";
import { prefixModelPaths, validBase, previewModelLoading } from "./paths.mjs";
import { previewReadUrl } from "./network-policy.mjs";
import { rangedAssetFetch } from "./ranged-fetch.mjs";

test("range transport reconstructs exact bytes with bounded concurrency, preserving WASM MIME and bypassing unrelated APIs", async () => {
  const source = new Uint8Array(4602795);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  let active = 0,
    peak = 0,
    calls = 0;
  const native = async (url, opts) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 1));
    active--;
    const range = new Headers(opts.headers).get("range");
    if (!range) return new Response("ordinary");
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range),
      start = Number(a),
      end = Number(b);
    return new Response(source.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${source.length}` },
    });
  };
  const read = rangedAssetFetch(
    native,
    "https://example.github.io",
    "/preview/"
  );
  assert.deepEqual(
    new Uint8Array(
      await (
        await read("/preview/vision/efficientdet_lite0_int8.tflite")
      ).arrayBuffer()
    ),
    source
  );
  assert.equal(calls, 5);
  assert.equal(peak, 2);
  assert.equal(
    await (await read("/preview/api/preview/status")).text(),
    "ordinary"
  );
  const invalid = rangedAssetFetch(
    async () =>
      new Response("partial", {
        status: 206,
        headers: { "Content-Range": "bytes 0-3/4" },
      }),
    "https://example.github.io",
    "/preview/"
  );
  await assert.rejects(
    invalid("/preview/vision/efficientdet_lite0_int8.tflite"),
    /preview_range_contract/
  );
});
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
