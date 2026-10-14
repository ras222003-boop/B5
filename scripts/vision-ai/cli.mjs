#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { repo, readJson, writeJson, fileHash, taxonomyPath, requireValue as check } from './common.mjs';
import { validateDataset, assignSplits, exportCoco, prepareDraft, importCoco } from './data.mjs';
import { evaluateRun, compareReports, phoneGate } from './evaluation.mjs';
import { registerRelease, verifyRelease, selectRelease } from './registry.mjs';
import { extractFrames } from './extract-frames.mjs';

const help = `Basira Vision AI — offline phase-1 tools (no upload or production activation)
  init <new-data-directory>
  draft <inventory.json> <data-root> <new-manifest.json>
  extract-frames <approved-video-record.json> <data-root> <new-relative-frame-directory> <new-inventory.json>
  annotation-pack <draft-manifest.json> <new-empty-coco.json>
  validate <manifest.json>
  split <reviewed-unsplit-manifest.json> <new-manifest.json> [integer-seed]
  import-coco <manifest.json> <annotations.coco.json> <new-manifest.json>
  export <manifest.json> <new-export-directory>
  evaluate <manifest.json> <predictions.json> <new-report.json>
  compare <baseline-report.json> <candidate-report.json> <new-comparison.json>
  phone-gate <physical-phone-trace.json> <new-report.json>
  audit <new-baseline-inventory.json>
  register <registry-directory> <release-descriptor.json>
  verify <registry-directory> <version>
  select <registry-directory> <version> <reason>
  rollback <registry-directory> <reason>
See ml/vision/README.md for annotation contracts and training commands.`;
const [command, ...args] = process.argv.slice(2);
const required = (n, max = n) => check(args.length >= n && args.length <= max && args.every(Boolean), help);
const load = async path => ({ data: await readJson(path), root: dirname(resolve(path)) });
const sameRoot = (input, output) => check(dirname(resolve(input)) === dirname(resolve(output)), 'manifest outputs must stay beside input so relative media paths remain valid');
try {
  let result;
  switch (command) {
    case undefined: case 'help': console.log(help); break;
    case 'init': {
      required(1); const root = resolve(args[0]); await mkdir(root);
      for (const folder of ['media', 'videos', 'rights']) await mkdir(resolve(root, folder));
      await writeJson(resolve(root, 'inventory.json'), { schemaVersion: 1, id: 'basira-pilot-001', sources: [{ id: 'team-001',
        kind: 'basira_team', origin: '', license: '', trainingAllowed: false, containsUserData: false,
        rightsReview: { status: 'pending', reviewer: '', at: '', evidence: { path: 'rights/team-permission.txt', sha256: '' } } }],
      samples: [] });
      result = { directory: root, status: 'EMPTY_REQUIRES_TEAM_OR_LICENSED_DATA' }; break;
    }
    case 'draft': {
      required(3); check(dirname(resolve(args[2])) === resolve(args[1]), 'draft must be written in data root');
      result = await prepareDraft(await readJson(args[0]), resolve(args[1])); await writeJson(args[2], result); break;
    }
    case 'extract-frames': {
      required(4); result = await extractFrames(await readJson(args[0]), resolve(args[1]), args[2]);
      await writeJson(args[3], result); result = { status: 'EXTRACTED_REQUIRES_PRIVACY_AND_LABEL_REVIEW', samples: result.samples.length }; break;
    }
    case 'annotation-pack': {
      required(2); const data = await readJson(args[0]), taxonomy = await readJson(taxonomyPath);
      check(Array.isArray(data.samples) && data.samples.length > 0, 'draft samples required');
      result = { info: { description: 'UNLABELED annotation template; empty boxes are not reviewed negatives' },
        images: data.samples.map((s, i) => ({ id: i + 1, file_name: s.path, width: s.width, height: s.height })),
        categories: taxonomy.classes.filter(c => c.kind !== 'surface').map(c => ({ id: c.id, name: c.key, supercategory: c.kind })), annotations: [] };
      await writeJson(args[1], result); result = { status: 'UNLABELED_TEMPLATE' }; break;
    }
    case 'validate': {
      required(1); const { data, root } = await load(args[0]); result = await validateDataset(data, root); break;
    }
    case 'split': {
      required(2, 3); sameRoot(args[0], args[1]); const { data, root } = await load(args[0]);
      await validateDataset(data, root, { requireSplit: false });
      const output = assignSplits(data, args[2] === undefined ? 20261014 : Number(args[2]));
      result = await validateDataset(output, root); await writeJson(args[1], output); break;
    }
    case 'import-coco': {
      required(3); sameRoot(args[0], args[2]); const output = importCoco(await readJson(args[0]), await readJson(args[1]), await readJson(taxonomyPath));
      await writeJson(args[2], output); result = { status: 'IMPORTED_REQUIRES_HUMAN_REVIEW', samples: output.samples.length }; break;
    }
    case 'export': {
      required(2); const { data, root } = await load(args[0]); result = await exportCoco(data, root, resolve(args[1])); break;
    }
    case 'evaluate': {
      required(3); const { data, root } = await load(args[0]); result = await evaluateRun(data, root, await readJson(args[1])); await writeJson(args[2], result); break;
    }
    case 'compare': {
      required(3); result = compareReports(await readJson(args[0]), await readJson(args[1])); await writeJson(args[2], result); break;
    }
    case 'phone-gate': {
      required(2); result = phoneGate(await readJson(args[0])); await writeJson(args[1], result); break;
    }
    case 'audit': {
      required(1);
      const artifacts = ['client/public/vision/efficientdet_lite0_int8.tflite',
        'client/public/vision/models/Xenova/segformer-b0-finetuned-ade-512-512/onnx/model_quantized.onnx',
        'client/public/vision/models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx'];
      const models = [];
      for (const path of artifacts) {
        try { const absolute = resolve(repo, path); models.push({ path, sha256: await fileHash(absolute), bytes: (await stat(absolute)).size }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; models.push({ path, status: 'MISSING' }); }
      }
      result = { schemaVersion: 1, scope: 'static-artifact-audit', referenceCommit: 'f4ca09149898704f71d4dc5d76223521b9768540',
        inspectedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
        models, taxonomySha256: await fileHash(taxonomyPath), trainingPerformed: false, phoneMeasured: false, accuracy: null };
      await writeJson(args[0], result); break;
    }
    case 'register': required(2); result = await registerRelease(resolve(args[0]), await readJson(args[1]), dirname(resolve(args[1]))); break;
    case 'verify': required(2); result = await verifyRelease(resolve(args[0]), args[1]); break;
    case 'select': required(3); result = await selectRelease(resolve(args[0]), args[1], args[2]); break;
    case 'rollback': required(2); result = await selectRelease(resolve(args[0]), null, args[1], true); break;
    default: throw new Error(help);
  }
  if (result) console.log(JSON.stringify(command === 'draft' ? { status: 'DRAFT_ONLY', samples: result.samples.length } : result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
