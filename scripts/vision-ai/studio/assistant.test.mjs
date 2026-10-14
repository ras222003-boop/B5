import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { validateDataset } from "../data.mjs";
import { fileHash } from "../common.mjs";
import * as ai from "./assistant.mjs";
const editor = { id: "editor", roles: ["annotator"] },
  reviewer = { id: "reviewer", roles: ["labels", "privacy", "rights"] };
async function setup(t, images = 1) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-assistant-")),
    root = resolve(temp, "data");
  await fixture(root, { images });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const w = await new StudioWorkspace(root).init();
  return { root, w, item: (await w.catalog()).items[0] };
}
async function edit(w, i) {
  return w.change(
    i.key,
    {
      version: i.version,
      action: "labels",
      reason: "synthetic editor contribution",
      objects: i.sample.annotation.objects,
    },
    editor
  );
}
async function mirror(root, filename = "copy.png") {
  const dir = resolve(root, "incoming/copy");
  await mkdir(dir);
  await mkdir(resolve(dir, "images"));
  await mkdir(resolve(dir, "rights"));
  await copyFile(
    resolve(root, "incoming/demo/rights/team.txt"),
    resolve(dir, "rights/team.txt")
  );
  const d = JSON.parse(
    await readFile(resolve(root, "incoming/demo/dataset.review.pending.json"))
  );
  d.id = "synthetic-copy";
  d.samples = [
    {
      ...d.samples[0],
      id: "synthetic-copy",
      path: "images/" + filename,
      leakageGroup: "distinct-but-duplicate",
    },
  ];
  await copyFile(
    resolve(root, "incoming/demo/images/demo-001.png"),
    resolve(dir, "images", filename)
  );
  await writeFile(
    resolve(dir, "dataset.review.pending.json"),
    JSON.stringify(d)
  );
  return dir;
}

test("quality report is version/SHA bound, keeps originals and grants no approvals", async t => {
  const { w, item } = await setup(t);
  const sha = await fileHash(await w.mediaPath(item));
  const r = await ai.analyze(w, item.key, editor);
  assert.equal(r.imageSha256, sha);
  assert.equal(r.humanApproval, false);
  assert.ok(r.issues.some(i => i.type === "incomplete_labels"));
  assert.equal((await w.item(item.key)).version, 0);
  assert.equal(await fileHash(await w.mediaPath(item)), sha);
  assert.equal(r.capabilities.faceDetector, "not-configured");
});
test("model comparison proposes missing objects, classes and geometry without overwriting labels", () => {
  const original = [{ id: "a", classId: 1, box: [0.1, 0.1, 0.2, 0.2] }];
  const r = ai.compareLabels(original, [
    { classId: 5, box: [0.1, 0.1, 0.2, 0.2], score: 0.9 },
    { classId: 2, box: [0.6, 0.6, 0.2, 0.2], score: 0.8 },
  ]);
  assert.deepEqual(
    r.proposals.map(p => p.type),
    ["class_disagreement", "unlabeled_candidate"]
  );
  assert.equal(original[0].classId, 1);
  assert.ok(r.proposals.every(p => p.status === "proposed"));
});
test("OCR proposals keep sensitive text out of reports and ChatGPT packet", async t => {
  const { w, item } = await setup(t);
  const r = await ai.saveModelReport(
    w,
    {
      key: item.key,
      version: 0,
      imageSha256: item.sample.sha256,
      detections: [],
      text: [
        {
          text: "reviewer@example.invalid",
          score: 0.9,
          box: [0.1, 0.1, 0.3, 0.1],
        },
      ],
    },
    editor,
    { ocr: { status: "available" } }
  );
  assert.equal(r.redactionRegions.length, 1);
  assert.ok(!JSON.stringify(r).includes("reviewer@example.invalid"));
  const packet = await ai.needsPacket(w, editor);
  assert.ok(
    !JSON.stringify(packet.packet).includes("reviewer@example.invalid")
  );
  assert.ok(!JSON.stringify(packet.packet).includes(item.sample.path));
  assert.equal(packet.packet.cloudUploadPerformed, false);
  assert.equal(packet.packet.planning.classes.length, 35);
});
test("stale or invalid model outputs cannot be saved", async t => {
  const { w, item } = await setup(t);
  await edit(w, item);
  await assert.rejects(
    ai.saveModelReport(
      w,
      {
        key: item.key,
        version: 0,
        imageSha256: item.sample.sha256,
        detections: [],
        text: [],
      },
      editor,
      {}
    ),
    /stale/
  );
  await assert.rejects(
    ai.saveModelReport(
      w,
      {
        key: item.key,
        version: 1,
        imageSha256: item.sample.sha256,
        detections: [{ classId: 999, box: [0, 0, 1, 1], score: 0.9 }],
        text: [],
      },
      editor,
      {}
    ),
    /Invalid detector/
  );
});
test("pixel-equivalent files with different metadata are exact duplicates", async t => {
  const { w, root, item } = await setup(t);
  const dir = await mirror(root);
  const image = resolve(dir, "images/copy.png");
  const bytes = await sharp(image).withMetadata().png().toBuffer();
  await writeFile(image, bytes);
  const p = resolve(dir, "dataset.review.pending.json");
  const d = JSON.parse(await readFile(p));
  d.samples[0].sha256 = await fileHash(image);
  await writeFile(p, JSON.stringify(d));
  const s = await ai.scan(w);
  assert.equal(s.pairs[0].kind, "exact");
  assert.notEqual(s.pairs[0].aSha256, s.pairs[0].bSha256);
});
test("near matching is not an approval; fixed cross-split copies and held-out mirrors block release", async t => {
  const { w, root, item } = await setup(t);
  const dir = await mirror(root);
  const original = resolve(root, "incoming/demo/dataset.review.pending.json"),
    copy = resolve(dir, "dataset.review.pending.json");
  const a = JSON.parse(await readFile(original)),
    b = JSON.parse(await readFile(copy));
  a.samples[0].split = "test";
  b.samples[0].split = "train";
  await writeFile(original, JSON.stringify(a));
  await writeFile(copy, JSON.stringify(b));
  assert.equal((await ai.scan(w)).pairs[0].crossSplit, true);
  await assert.rejects(
    ai.releaseGroups(w, [
      (await w.catalog()).items.find(i => i.batch === b.id),
    ]),
    /frozen splits/
  );
  b.samples[0].split = null;
  await writeFile(copy, JSON.stringify(b));
  await assert.rejects(
    ai.releaseGroups(w, [
      (await w.catalog()).items.find(i => i.batch === b.id),
    ]),
    /held-out/
  );
});
test("independent reviewer decision is recorded and exact duplicates cannot be dismissed", async t => {
  const { w, root } = await setup(t);
  await mirror(root);
  const pair = (await ai.scan(w)).pairs[0];
  await assert.rejects(
    ai.reviewPair(
      w,
      {
        id: pair.id,
        relation: "different",
        reason: "synthetic negative claim",
      },
      reviewer
    ),
    /Exact copies/
  );
  await assert.rejects(
    ai.reviewPair(
      w,
      { id: pair.id, relation: "same", reason: "synthetic same pixels" },
      editor
    ),
    /reviewer role/
  );
  const decision = await ai.reviewPair(
    w,
    { id: pair.id, relation: "same", reason: "same synthetic pixels" },
    reviewer
  );
  assert.equal(decision.actor, "reviewer");
  assert.equal(decision.automaticApproval, false);
  assert.equal((await w.catalog()).summary.approved, 0);
});
test("solid-mask derivative preserves original and records regions while resetting approvals", async t => {
  const { w, item } = await setup(t);
  const original = await w.mediaPath(item),
    sha = await fileHash(original);
  await ai.redact(
    w,
    item.key,
    {
      version: 0,
      regions: [[0.1, 0.1, 0.3, 0.3]],
      confirm: true,
      reason: "mask a synthetic test region",
      reportIds: [],
    },
    editor
  );
  const next = await w.item(item.key);
  assert.ok(next.activePath);
  assert.equal(await fileHash(original), sha);
  const pixel = await sharp(await w.mediaPath(next))
    .extract({ left: 100, top: 100, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok([...pixel].every(v => v === 0));
  assert.equal(next.sample.privacy.status, "pending");
  const history = await w.revisions(item.key);
  assert.equal((await w.json(history[0])).assistantAudit.method, "solid-mask");
});
test("rights rejection survives label edits and blocks redaction, upload and synthetic relabeling", async t => {
  const { w, item } = await setup(t);
  await edit(w, item);
  await w.change(
    item.key,
    {
      version: 1,
      action: "review",
      kind: "rights",
      status: "rejected",
      reason: "fictional no commercial rights",
    },
    reviewer
  );
  await edit(w, await w.item(item.key));
  assert.equal((await w.item(item.key)).status, "rejected");
  await assert.rejects(
    ai.redact(
      w,
      item.key,
      {
        version: 3,
        regions: [[0, 0, 0.1, 0.1]],
        confirm: true,
        reason: "try to bypass",
      },
      editor
    ),
    /Rights rejected/
  );
  const image = (await readFile(await w.mediaPath(item))).toString("base64");
  await assert.rejects(
    ai.importSynthetic(w, synthetic(image), editor),
    /relabeled/
  );
});
function synthetic(image) {
  return {
    image,
    generator: "synthetic unit-test generator",
    model: "explicit vector fixture",
    prompt: "original generic car scene",
    settings: { steps: 1 },
    seed: 1,
    generatedAt: new Date().toISOString(),
    origin: "independent synthetic fixture",
    license: "fictional permission",
    rightsText: "Fictional test evidence; not real rights.",
    independentCreation: true,
    noUserData: true,
  };
}
test("synthetic import records provenance and remains excluded even if relabeled real", async t => {
  const { w, item, root } = await setup(t);
  const input = synthetic(
    (await readFile(await w.mediaPath(item))).toString("base64")
  );
  const r = await ai.importSynthetic(w, input, editor);
  assert.equal(r.contentKind, "synthetic");
  const i = (await w.catalog()).items.find(i => i.batch === r.id);
  assert.equal(i.sample.generation.model, input.model);
  assert.equal(i.sample.privacy.status, "pending");
  assert.ok(i.sources.every(s => !s.trainingAllowed));
  const data = JSON.parse(await readFile(resolve(root, i.manifest)));
  data.contentKind = "real";
  await assert.rejects(
    validateDataset(data, resolve(root, i.prefix)),
    /synthetic provenance/
  );
  await assert.rejects(w.exportBatch(i.batchKey, reviewer), /Entire batch/);
});
test("generation imports reject unconfirmed origins and secret settings", async t => {
  const { w, item } = await setup(t);
  const p = synthetic(
    (await readFile(await w.mediaPath(item))).toString("base64")
  );
  await assert.rejects(
    ai.importSynthetic(w, { ...p, independentCreation: false }, editor),
    /declaration/
  );
  await assert.rejects(
    ai.importSynthetic(
      w,
      { ...p, settings: { apiKey: "not-a-real-key" } },
      editor
    ),
    /Non-secret/
  );
});

test("redaction cannot hide original duplicates from held-out split verification", async t => {
  const { w, root, item } = await setup(t);
  const dir = await mirror(root);
  const copy = resolve(dir, "dataset.review.pending.json");
  const d = JSON.parse(await readFile(copy));
  d.samples[0].split = "test";
  await writeFile(copy, JSON.stringify(d));
  await ai.redact(
    w,
    item.key,
    {
      version: 0,
      regions: [[0, 0, 1, 1]],
      confirm: true,
      reason: "synthetic full mask",
    },
    editor
  );
  assert.equal((await ai.scan(w)).pairs[0].kind, "exact");
  await assert.rejects(
    ai.releaseGroups(w, [await w.item(item.key)]),
    /held-out/
  );
});
test("near candidates require independent decisions, merge declared cohorts transitively, and never grant approvals", async t => {
  const { w, root } = await setup(t, 2);
  const dir = await mirror(root),
    image = resolve(dir, "images/copy.png"),
    path = resolve(dir, "dataset.review.pending.json");
  const bytes = await sharp(image).jpeg({ quality: 90 }).toBuffer();
  await writeFile(image, bytes);
  const d = JSON.parse(await readFile(path));
  d.samples[0].sha256 = await fileHash(image);
  await writeFile(path, JSON.stringify(d));
  let pair = (await ai.scan(w)).pairs.find(p => p.kind === "similar_candidate");
  assert.ok(pair);
  const items = (await w.catalog()).items;
  await assert.rejects(ai.releaseGroups(w, items), /Unresolved/);
  await ai.reviewPair(
    w,
    {
      id: pair.id,
      relation: "different",
      reason: "Independent fictional comparison says different",
    },
    reviewer
  );
  assert.equal(
    (await ai.scan(w)).pairs.find(p => p.id === pair.id).requiresReview,
    false
  );
  await ai.reviewPair(
    w,
    { id: pair.id, relation: "same", reason: "Same scene in another encoding" },
    reviewer
  );
  const originalPath = resolve(
      root,
      "incoming/demo/dataset.review.pending.json"
    ),
    base = JSON.parse(await readFile(originalPath));
  base.samples[1].leakageGroup = base.samples[0].leakageGroup;
  await writeFile(originalPath, JSON.stringify(base));
  const groups = await ai.releaseGroups(w, (await w.catalog()).items);
  assert.equal(new Set(groups.values()).size, 1);
  assert.equal(groups.size, 3);
  assert.equal((await w.catalog()).summary.approved, 0);
});
test("catalog failures fail closed rather than claiming a complete similarity scan", async t => {
  const { w, root } = await setup(t);
  await mkdir(resolve(root, "incoming/broken"));
  await writeFile(
    resolve(root, "incoming/broken/dataset.review.pending.json"),
    "bad json"
  );
  await assert.rejects(ai.scan(w), /Catalog errors/);
});
test("all previous contributors and synthetic uploader remain ineligible to approve their own data", async t => {
  const { w, item } = await setup(t);
  await edit(w, item);
  await w.change(
    item.key,
    {
      version: 1,
      action: "labels",
      reason: "a second contributor",
      objects: item.sample.annotation.objects,
    },
    { id: "other", roles: ["annotator"] }
  );
  await assert.rejects(
    w.change(
      item.key,
      {
        version: 2,
        action: "review",
        kind: "labels",
        status: "approved",
        reason: "previous contributor trying self approval",
        exhaustive: true,
      },
      { id: "editor", roles: ["labels"] }
    ),
    /Independent/
  );
  const r = await ai.importSynthetic(
    w,
    synthetic((await readFile(await w.mediaPath(item))).toString("base64")),
    editor
  );
  const syntheticItem = (await w.catalog()).items.find(i => i.batch === r.id);
  await w.change(
    syntheticItem.key,
    {
      version: 0,
      action: "labels",
      reason: "separate labeling contributor",
      objects: item.sample.annotation.objects.map(({ spatial, ...o }) => o),
    },
    { id: "other", roles: ["annotator"] }
  );
  await assert.rejects(
    w.change(
      syntheticItem.key,
      {
        version: 1,
        action: "review",
        kind: "rights",
        status: "approved",
        reason: "uploader cannot approve rights",
      },
      { id: "editor", roles: ["rights"] }
    ),
    /Independent/
  );
});
