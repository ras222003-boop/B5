#!/usr/bin/env node
/** Starts and closes its own loopback-only Vite fixture server. No app page, env, camera or API. */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hostname, cpus, totalmem, release } from 'node:os';
import { vitePluginOnnxRuntimeRawAssets } from '../../server/onnxRuntimeAssetPlugin.ts';
import { readJson, writeJson, repo, taxonomyPath, fileHash, hash, checkedFile, requireValue as check } from './common.mjs';
import { validateDataset } from './data.mjs';
import { evaluateRun } from './evaluation.mjs';

const positional = process.argv.slice(2).filter(v => v !== '--synthetic-smoke');
const syntheticSmoke = process.argv.includes('--synthetic-smoke');
const [manifestPath, split, variant, output, modelDirectory] = positional;
check(manifestPath && ['validation', 'test'].includes(split) && ['baseline', 'baseline-worker', 'candidate'].includes(variant) && output,
  'Usage: node scripts/vision-ai/benchmark.mjs manifest.json validation|test baseline|baseline-worker|candidate new-run.json [candidate-export-directory]');
check(variant === 'candidate' ? !!modelDirectory : !modelDirectory, 'candidate requires its exported model directory only');
const root = dirname(resolve(manifestPath)), data = await readJson(manifestPath);
if (syntheticSmoke) check(data.contentKind === 'synthetic', '--synthetic-smoke accepts only explicitly synthetic fixtures');
const quality = await validateDataset(data, root, { allowSynthetic: syntheticSmoke }), taxonomy = await readJson(taxonomyPath);
const selected = data.samples.filter(s => s.split === split).sort((a, b) => a.id.localeCompare(b.id));
const contract = modelDirectory ? await readJson(resolve(modelDirectory, 'browser-contract.json')) : null;
check(contract?.syntheticOnly !== true || syntheticSmoke, 'synthetic model fixtures cannot evaluate real datasets');
if (contract) check(contract.schemaVersion === 1 && contract.taxonomySha256 === quality.taxonomySha256 && contract.scoreThreshold === .45 &&
  contract.nmsIoU === .6 && contract.maxDetections === 12 && JSON.stringify(contract.categories.map(c => c.id)) ===
  JSON.stringify(taxonomy.classes.filter(c => c.kind !== 'surface').map(c => c.id)), 'candidate contract mismatch');
const modelPath = contract ? await checkedFile(resolve(modelDirectory), 'model.onnx', contract.modelSha256) : resolve(repo, 'client/public/vision/efficientdet_lite0_int8.tflite');
const images = [];
for (const sample of selected) images.push(await readFile(await checkedFile(root, sample.path, sample.sha256)));
const hardware = { cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, memoryBytes: totalmem(), osRelease: release(), node: process.version };
const sourceFiles = {};
for (const path of ['scripts/vision-ai/benchmark.mjs', 'scripts/vision-ai/browser-runner.mjs', 'scripts/vision-ai/evaluation.mjs',
  'scripts/perception-evaluation.mjs', 'client/src/lib/vision/providers.ts', 'client/src/lib/vision/workerObjectProvider.ts', 'pnpm-lock.yaml'])
  sourceFiles[path] = await fileHash(resolve(repo, path));
let browser;
const server = await createServer({ configFile: false, envFile: false, envDir: false, root: resolve(repo, 'client'), publicDir: resolve(repo, 'client/public'),
  resolve: { alias: { '@': resolve(repo, 'client/src'), '@shared': resolve(repo, 'shared') } },
  plugins: [vitePluginOnnxRuntimeRawAssets(), { name: 'offline-vision-ai-lab', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/__lab/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Basira offline model benchmark</title>'); return; }
        if (pathname.startsWith('/api')) { res.statusCode = 403; res.end('API disabled'); return; }
        if (pathname === '/__lab/model.onnx' && contract) { res.end(await readFile(modelPath)); return; }
        const frame = pathname.match(/^\/__lab\/frame\/(\d+)$/);
        if (frame) { const bytes = images[Number(frame[1])]; if (!bytes) { res.statusCode = 404; res.end(); } else res.end(bytes); return; }
        const runtime = pathname.match(/^\/__lab\/ort\/(ort-wasm-simd-threaded(?:\.jsep)?\.(?:mjs|wasm))$/);
        if (runtime) {
          res.setHeader('Content-Type', runtime[1].endsWith('wasm') ? 'application/wasm' : 'text/javascript');
          res.end(await readFile(resolve(repo, 'node_modules/onnxruntime-web/dist', runtime[1]))); return;
        }
        next();
      } catch { res.statusCode = 500; res.end('lab asset error'); }
    });
  } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [repo] } } });
try {
  await server.listen(); const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: process.env.BASIRA_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  const page = await context.newPage(); await page.goto(`${origin}/__lab/`);
  const runner = `/@fs/${resolve(repo, 'scripts/vision-ai/browser-runner.mjs').replaceAll('\\', '/')}`;
  const result = await page.evaluate(async params => (await import(params.runner)).benchmark(params),
    { runner, variant, samples: selected.map(({ id, sha256 }) => ({ id, sha256 })), taxonomy, contract });
  const run = { schemaVersion: 1, datasetSha256: quality.datasetSha256, taxonomySha256: quality.taxonomySha256,
    modelVersion: contract ? `${contract.syntheticOnly ? 'constant-fixture' : 'ssdlite'}-${contract.modelSha256.slice(0, 12)}` : 'efficientdet-lite0-f4ca091', modelSha256: await fileHash(modelPath),
    modelKind: contract?.syntheticOnly ? 'constant-test-fixture-not-trained' : contract ? 'experimental-candidate' : 'existing-baseline',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), split,
    device: `${process.platform}-${process.arch}-${hash(`${hostname()}|${hardware.cpu}|${hardware.memoryBytes}`).slice(0, 16)}`,
    hardware, sourceFiles, modelBytes: (await readFile(modelPath)).length,
    contractSha256: modelDirectory ? await fileHash(resolve(modelDirectory, 'browser-contract.json')) : null,
    protocol: 'basira-heldout-replay-640x480-v1',
    scoreThreshold: .45, maxDetections: 12, nmsIoU: .6, ...result };
  const report = await evaluateRun(data, root, run, { allowSynthetic: syntheticSmoke });
  await writeJson(output, run); await writeJson(`${output}.report.json`, report);
  console.log(JSON.stringify({ output, frames: result.samples.length, scope: report.scope, mobile: null }));
} finally { if (browser) await browser.close(); await server.close(); }
