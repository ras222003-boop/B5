/** Explicit local batch runner: existing browser models + existing review tools. No human login or approval. */
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { StudioWorkspace } from "./workspace.mjs";
import { modelRuntime, assetMime } from "./model-runtime.mjs";
import { checkLocalRequest } from "./local-http.mjs";
import * as assistant from "./assistant.mjs";
import * as prereview from "./prereview.mjs";
import { fileHash, requireValue as check } from "../common.mjs";

export function selectItems(
  items,
  { syntheticOnly = false, keys = null } = {}
) {
  const kind = syntheticOnly ? "synthetic" : "real";
  if (keys !== null)
    check(
      Array.isArray(keys) &&
        keys.length > 0 &&
        keys.length <= 1000 &&
        new Set(keys).size === keys.length &&
        keys.every(k => typeof k === "string" && /^[a-f0-9]{32}$/.test(k)),
      "Explicit unique sample keys required"
    );
  const selected = items.filter(
    i =>
      i.contentKind === kind &&
      i.status !== "approved" &&
      i.sample?.intendedUse !== "independent_test_candidate" &&
      (keys === null || keys.includes(i.key))
  );
  check(
    keys === null || selected.length === keys.length,
    "Unknown, approved, reserved test or wrong-kind sample in selection"
  );
  check(selected.length > 0, "No unapproved development samples selected");
  return selected;
}

export async function run(
  root,
  { syntheticOnly = false, keys = null, onProgress = () => {} } = {}
) {
  const w = await new StudioWorkspace(root).init(),
    c = await w.catalog();
  check(!c.issues.length, "Catalog issues block complete run");
  const items = selectItems(c.items, { syntheticOnly, keys });
  const runtime = await modelRuntime(),
    token = randomBytes(32).toString("hex");
  let server, browser, context;
  const results = [];
  try {
    server = http.createServer(async (req, res) => {
      try {
        const origin = `http://127.0.0.1:${server.address().port}`,
          url = checkLocalRequest(req, origin);
        check(
          req.method === "GET" && req.headers["x-basira-machine"] === token,
          "Private machine read-only request required"
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        );
        if (url.pathname === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            "<!doctype html><title>Basira local machine preparation</title>"
          );
          return;
        }
        if (url.pathname === "/local-models.mjs") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(runtime.script);
          return;
        }
        if (runtime.assets.has(url.pathname)) {
          const asset = runtime.assets.get(url.pathname);
          check(
            (await fileHash(asset.path)) === asset.sha256,
            "Model asset SHA mismatch"
          );
          res.setHeader("Content-Type", assetMime(url.pathname));
          res.end(await readFile(asset.path));
          return;
        }
        const key = /^\/media\/([a-f0-9]{32})$/.exec(url.pathname)?.[1],
          item = items.find(i => i.key === key);
        check(item, "Unknown media");
        const path = await w.mediaPath(item);
        check(
          (await fileHash(path)) === (item.activeSha256 ?? item.sample.sha256),
          "Media SHA mismatch"
        );
        res.setHeader(
          "Content-Type",
          path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
        );
        res.end(await readFile(path));
      } catch {
        res.writeHead(403);
        res.end("Local machine asset unavailable");
      }
    });
    await new Promise((ok, no) => {
      server.once("error", no);
      server.listen(0, "127.0.0.1", ok);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    context = await browser.newContext({
      extraHTTPHeaders: { "X-Basira-Machine": token },
    });
    await context.route("**/*", route =>
      route
        .request()
        .url()
        .startsWith(origin + "/")
        ? route.continue()
        : route.abort()
    );
    const page = await context.newPage();
    await page.goto(origin);
    for (const item of items) {
      try {
        await (await import("../test-cohort.mjs")).markDevelopment(w, item);
        const outputs = await page.evaluate(
          async ({ key, taxonomy }) => {
            const model = await import("/local-models.mjs");
            return model.analyzeLocalImage("/media/" + key, taxonomy, {
              withOCR: true,
            });
          },
          { key: item.key, taxonomy: w.taxonomy }
        );
        await assistant.saveModelReport(
          w,
          {
            ...outputs,
            key: item.key,
            version: item.version,
            imageSha256: item.activeSha256 ?? item.sample.sha256,
          },
          prereview.producer,
          runtime.manifest
        );
        const report = await prereview.analyze(w, item.key);
        results.push({
          key: item.key,
          reportId: report.id,
          status: "completed",
          failures: report.modelFailures,
          proposals: report.proposals.length,
          regions: report.privacy.regions.length,
        });
      } catch {
        results.push({
          key: item.key,
          status: "failed",
          reason: "Local analysis failed; inspect privately in Studio.",
        });
      }
      onProgress({
        completed: results.length,
        total: items.length,
        failed: results.filter(x => x.status === "failed").length,
      });
    }
    const similarity = await assistant.scan(w);
    const report = {
      schemaVersion: 1,
      producer: prereview.producer,
      scope: syntheticOnly
        ? "synthetic-test-only"
        : "real-development-preparation-not-benchmark",
      at: new Date().toISOString(),
      results,
      similarity,
      approvalsRecorded: 0,
      trainingStarted: false,
      cloudUpload: false,
    };
    await w.ensure(".studio/prereview");
    const path = `.studio/prereview/batch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(
      await w.safe(path, true),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 }
    );
    return {
      path,
      completed: results.filter(x => x.status === "completed").length,
      failed: results.filter(x => x.status === "failed").length,
    };
  } finally {
    await context?.close();
    await browser?.close();
    if (server)
      await new Promise(ok => {
        server.closeAllConnections();
        server.close(ok);
      });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    root = args[args.indexOf("--data-root") + 1];
  check(args.includes("--data-root") && root, "--data-root required");
  console.log(
    JSON.stringify(
      await run(root, {
        syntheticOnly: args.includes("--synthetic-only"),
        keys: args.includes("--keys-json")
          ? JSON.parse(
              await readFile(args[args.indexOf("--keys-json") + 1], "utf8")
            )
          : null,
        onProgress: p => console.log(JSON.stringify(p)),
      })
    )
  );
}
