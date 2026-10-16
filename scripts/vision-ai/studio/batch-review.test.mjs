import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { BatchReview } from "./batch-review.mjs";
import * as assistant from "./assistant.mjs";
import * as prereview from "./prereview.mjs";
import { fileHash } from "../common.mjs";
const editor = {
    id: "editor",
    roles: ["annotator", "rights", "privacy", "labels"],
  },
  reviewer = { id: "reviewer", roles: ["rights", "privacy", "labels"] };
async function setup(t, n = 2) {
  const dir = await mkdtemp(resolve(tmpdir(), "basira-batch-")),
    root = resolve(dir, "data");
  await fixture(root, { images: n });
  t.after(() => rm(dir, { force: true, recursive: true }));
  const w = await new StudioWorkspace(root).init(),
    b = await new BatchReview(w).init();
  return { w, b, root, items: (await w.catalog()).items };
}
async function inspected(
  b,
  key,
  stage,
  actor,
  session = "test-session",
  patch = {}
) {
  const d = await b.inspect(key, stage, actor, session);
  await b.media(d.receipt, "original", actor, session);
  await b.media(d.receipt, "preview", actor, session);
  await b.attest(
    {
      receipt: d.receipt,
      reason: "Synthetic independent image inspection only",
      labelsInspected: true,
      privacyInspected: true,
      sourcesInspected: true,
      commercialTrainingRights: true,
      conditions: d.sample.conditions,
      privacy: { faces: "absent", plates: "absent", personalText: "absent" },
      proposalIds: [],
      rejectedProposalIds: (d.report?.proposals ?? []).map(x => x.id),
      ...patch,
    },
    actor,
    session
  );
  return d.receipt;
}
const commit = (
  b,
  stage,
  receipts,
  actor,
  operationId = randomUUID(),
  session = "test-session"
) => b.commit({ stage, receipts, operationId }, actor, session);
test("concurrent duplicate operation IDs never create duplicate revisions or partial journals", async t => {
  const { w, b, items } = await setup(t, 1),
    receipt = await inspected(b, items[0].key, "prepare", editor),
    op = randomUUID();
  const results = await Promise.all([
    commit(b, "prepare", [receipt], editor, op),
    commit(b, "prepare", [receipt], editor, op),
  ]);
  assert.ok(results.some(r => r.status === "completed"));
  assert.equal((await w.item(items[0].key)).version, 1);
  assert.equal((await w.revisions(items[0].key)).length, 1);
  assert.equal(
    (await commit(b, "prepare", [receipt], editor, op)).status,
    "completed"
  );
});
test("approved new sessions freeze once with existing exporter; final test is blocked from tuning, edits and train splits", async t => {
  const { w, root } = await setup(t, 4);
  const path = resolve(root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await readFile(path));
  // Fictional test pixels exercise real-data schema only. Never a training dataset.
  data.contentKind = "real";
  const held = data.samples.pop();
  await writeFile(path, JSON.stringify(data));
  // Model a new intake after the development ledger was established.
  const ledger = ".studio/batch-review/development-observed.json";
  const observed = (await w.catalog()).items.map(i => ({
    key: i.key,
    sha256: i.sample.sha256,
    group: i.sample.leakageGroup,
  }));
  await writeFile(await w.safe(ledger), JSON.stringify({ samples: observed }));
  data.samples.push(held);
  await writeFile(path, JSON.stringify(data));
  const b = await new BatchReview(w).init(),
    items = (await w.catalog()).items;
  for (const i of items)
    await commit(
      b,
      "prepare",
      [await inspected(b, i.key, "prepare", editor)],
      editor
    );
  for (const p of (await assistant.scan(w)).pairs)
    if (p.requiresReview)
      await assistant.reviewPair(
        w,
        {
          id: p.id,
          relation: "different",
          reason: "Independent fictional scene inspection",
        },
        reviewer
      );
  for (const i of items) {
    const r = await commit(
      b,
      "approve",
      [await inspected(b, i.key, "approve", reviewer)],
      reviewer
    );
    assert.equal(r.results[0].saved, true);
    assert.equal(r.preparation.status, "WAITING_NEW_INDEPENDENT_TEST_SESSIONS");
  }
  const testItem = (await w.catalog()).items.find(i => i.sample.id === held.id),
    dev = items.find(i => i.key !== testItem.key);
  const evidence = "incoming/demo/rights/team.txt",
    evidenceHash = await fileHash(await w.safe(evidence));
  const req = {
    keys: [testItem.key],
    evidence: { path: evidence, sha256: evidenceHash },
    newSessionsInspected: true,
    neverUsedForTuning: true,
    reason: "Fictional independent capture-session inspection",
  };
  await assert.rejects(
    b.registerTest({ ...req, keys: [dev.key] }, reviewer),
    /Previously observed/
  );
  await b.registerTest(req, reviewer);
  await assert.rejects(
    assistant.analyze(w, testItem.key, editor),
    /final-test/
  );
  await assert.rejects(
    w.change(
      testItem.key,
      {
        action: "labels",
        version: 2,
        reason: "Forbidden development edit",
        objects: testItem.sample.annotation.objects,
      },
      editor
    ),
    /final-test/
  );
  const frozen = await b.prepareTraining(
    items.filter(i => i.key !== testItem.key).map(i => i.key),
    reviewer
  );
  assert.equal(
    frozen.status,
    "FROZEN_COCO_READY_REQUIRES_SEPARATE_TRAINING_APPROVAL"
  );
  const manifest = await w.json(frozen.manifest);
  assert.equal(manifest.samples.filter(s => s.split === "test").length, 1);
  assert.equal(
    manifest.samples.find(s => s.sha256 === testItem.activeSha256).split,
    "test"
  );
  const { validateDataset } = await import("../data.mjs");
  const corrupt = structuredClone(manifest);
  corrupt.samples.find(s => s.split === "test").split = "train";
  await assert.rejects(validateDataset(corrupt, root), /Protected final-test/);
  assert.ok(await w.json(`${frozen.export}/dataset.lock.json`));
  const reused = await b.prepareTraining([dev.key], reviewer);
  assert.equal(reused.manifest, frozen.manifest);
  assert.equal(reused.reusedFrozenExport, true);
  await writeFile(
    await w.safe(`${frozen.export}/train.json`),
    "changed fixture export"
  );
  await assert.rejects(
    b.prepareTraining([dev.key], reviewer),
    /export file SHA/
  );
});
test("final-test video identity blocks development frames even under a different session name", async t => {
  const { w, items } = await setup(t, 1),
    videoSha = "a".repeat(64);
  await writeFile(
    await w.safe(".studio/batch-review/final-test.json", true),
    JSON.stringify({
      samples: [
        {
          key: "b".repeat(32),
          group: "independent-video-session",
          videoSha256: videoSha,
        },
      ],
    }),
    { flag: "wx" }
  );
  const { assertNotFinalTest, guardFinalSplits } = await import(
    "../test-cohort.mjs"
  );
  await assert.rejects(
    assertNotFinalTest(w.root, {
      ...items[0],
      sample: {
        ...items[0].sample,
        media: { kind: "video_frame", video: { sha256: videoSha } },
      },
    }),
    /final-test/
  );
  await assert.rejects(
    guardFinalSplits(
      {
        samples: [
          {
            sha256: "c".repeat(64),
            split: "train",
            leakageGroup: "renamed-session",
            media: { kind: "video_frame", video: { sha256: videoSha } },
          },
        ],
      },
      w.root
    ),
    /Protected final-test/
  );
});
test("one atomic preparation revision, three independent decisions, idempotent replay, immutable originals and accounts", async t => {
  const { w, b, items, root } = await setup(t, 1),
    i = items[0],
    original = await fileHash(await w.mediaPath(i, true)),
    users = await fileHash(resolve(root, ".studio/identities.json"));
  const receipt = await inspected(b, i.key, "prepare", editor);
  const op = randomUUID(),
    result = await commit(b, "prepare", [receipt], editor, op);
  assert.equal(result.results[0].saved, true);
  assert.equal(result.results[0].version, 1);
  assert.deepEqual(await commit(b, "prepare", [receipt], editor, op), result);
  assert.equal((await w.revisions(i.key)).length, 1);
  await assert.rejects(
    b.inspect(i.key, "approve", editor, "test-session"),
    /Independent/
  );
  const review = await inspected(b, i.key, "approve", reviewer);
  const approved = await commit(b, "approve", [review], reviewer);
  assert.equal(approved.results[0].status, "approved");
  const after = await w.item(i.key),
    revision = await w.json((await w.revisions(i.key)).at(-1));
  assert.equal(after.version, 2);
  assert.equal(revision.action, "review");
  assert.equal(revision.batchAudit.actor, "reviewer");
  for (const kind of ["rights", "privacy", "labels"]) {
    assert.equal(after.decisions[kind].reviewer, "reviewer");
    assert.equal(after.decisions[kind].itemKey, i.key);
    assert.equal(after.decisions[kind].imageSha256, after.activeSha256);
    assert.equal(
      after.decisions[kind].evidence[0].sha256,
      after.sources[0].rightsReview.evidence.sha256
    );
    assert.ok(after.decisions[kind].at && after.decisions[kind].reason);
  }
  assert.equal(approved.preparation.status, "NO_APPROVED_REAL_SELECTION");
  assert.equal((await w.contributors(after)).has("reviewer"), false);
  assert.equal(await fileHash(await w.mediaPath(after, true)), original);
  assert.equal(await fileHash(resolve(root, ".studio/identities.json")), users);
});
test("no unviewed samples, session spoofing, missing checks or client-forged bundles", async t => {
  const { w, b, items } = await setup(t, 1),
    i = items[0],
    d = await b.inspect(i.key, "prepare", editor, "one");
  await assert.rejects(
    b.media(d.receipt, "original", editor, "two"),
    /another session/
  );
  await assert.rejects(
    b.attest({ receipt: d.receipt }, editor, "one"),
    /Open original/
  );
  await b.media(d.receipt, "original", editor, "one");
  await b.media(d.receipt, "preview", editor, "one");
  await assert.rejects(
    b.attest({ receipt: d.receipt }, editor, "one"),
    /Inspect labels/
  );
  await assert.rejects(
    w.change(
      i.key,
      {
        action: "prepare-bundle",
        version: 0,
        reason: "forged batch audit",
        batchAudit: { verified: true },
      },
      editor
    ),
    /receipt required/
  );
  const result = await commit(
    b,
    "prepare",
    [d.receipt],
    editor,
    randomUUID(),
    "one"
  );
  assert.equal(result.results[0].saved, false);
  assert.equal((await w.item(i.key)).version, 0);
});
test("stale receipt retains other eligible saves without overwriting another contributor", async t => {
  const { w, b, items } = await setup(t, 2);
  const receipts = await Promise.all(
    items.map(i => inspected(b, i.key, "prepare", editor))
  );
  const i = await w.item(items[0].key),
    objects = structuredClone(i.sample.annotation.objects);
  objects[0].occluded = true;
  await w.change(
    i.key,
    {
      action: "labels",
      version: 0,
      objects,
      reason: "Concurrent synthetic contributor change",
    },
    { id: "other-preparer", roles: ["annotator"] }
  );
  const result = await commit(b, "prepare", receipts, editor);
  assert.equal(result.results.filter(x => x.saved).length, 1);
  assert.equal(result.results.find(x => !x.saved).code, "REVISION_CONFLICT");
  assert.equal(
    (await w.item(i.key)).sample.annotation.annotator,
    "other-preparer"
  );
  assert.equal(
    (await w.item(i.key)).sample.annotation.objects[0].occluded,
    true
  );
});
test("failed third approval decision cannot leave partial rights or privacy approval", async t => {
  const { w, b, items } = await setup(t, 1),
    i = items[0];
  await commit(
    b,
    "prepare",
    [await inspected(b, i.key, "prepare", editor)],
    editor
  );
  const receipt = await inspected(b, i.key, "approve", reviewer);
  // A forged internal assessment simulates a validation failure after rights validation.
  b.receipts.get(receipt).assessment.privacy.faces = "unreviewed";
  const result = await commit(b, "approve", [receipt], reviewer);
  assert.equal(result.results[0].saved, false);
  const after = await w.item(i.key);
  assert.equal(after.version, 1);
  assert.deepEqual(after.decisions, {});
  assert.equal(after.sources[0].rightsReview.status, "pending");
});
test("source evidence changed, unresolved candidates and uncertain conditions remain exceptions", async t => {
  const { w, b, items, root } = await setup(t, 1),
    i = items[0];
  await assistant.saveModelReport(
    w,
    {
      key: i.key,
      version: 0,
      imageSha256: i.sample.sha256,
      detections: [{ classId: 2, score: 0.8, box: [0.1, 0.1, 0.2, 0.2] }],
      text: [],
    },
    prereview.producer,
    {}
  );
  await prereview.analyze(w, i.key, {
    privacyTool: async () => ({
      status: "completed",
      regions: [],
      limits: ["not clearance"],
    }),
  });
  await assert.rejects(
    inspected(b, i.key, "prepare", editor, "test-session", {
      rejectedProposalIds: [],
    }),
    /Resolve every/
  );
  await assert.rejects(
    inspected(b, i.key, "prepare", editor, "test-session", {
      conditions: {
        lighting: "unreviewed",
        scene: "outdoor",
        motion: "static",
      },
    }),
    /need evidence/
  );
  const receipt = await inspected(b, i.key, "prepare", editor);
  await writeFile(
    resolve(root, "incoming/demo/rights/team.txt"),
    "CHANGED SYNTHETIC PROOF"
  );
  const result = await commit(b, "prepare", [receipt], editor);
  assert.equal(result.results[0].saved, false);
  assert.equal((await w.item(i.key)).version, 0);
});
test("similarity gate is independent and cannot be bypassed by image preparation", async t => {
  const { w, b, items } = await setup(t, 2);
  // Fixtures may or may not be visually similar; construct a controlled related file.
  const { default: sharp } = await import("sharp");
  const p = await w.mediaPath(items[1], true);
  await sharp(await w.mediaPath(items[0], true))
    .modulate({ brightness: 1.01 })
    .png()
    .toFile(p);
  const manifest = resolve(w.root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await readFile(manifest));
  data.samples.find(s => s.id === items[1].sample.id).sha256 =
    await fileHash(p);
  await writeFile(manifest, JSON.stringify(data));
  const key = (await w.catalog()).items[0].key;
  await commit(
    b,
    "prepare",
    [await inspected(b, key, "prepare", editor)],
    editor
  );
  await assert.rejects(
    inspected(b, key, "approve", reviewer),
    /Unresolved similar/
  );
  assert.equal((await w.item(key)).status, "pending");
});
