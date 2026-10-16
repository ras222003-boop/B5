import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import * as a from "./assistant.mjs";
import * as p from "./prereview.mjs";
import { fileHash } from "../common.mjs";
const editor = {
    id: "editor",
    roles: ["annotator", "rights", "privacy", "labels"],
  },
  reviewer = { id: "reviewer", roles: ["rights", "privacy", "labels"] };
async function setup(t, n = 2) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-prereview-")),
    root = resolve(temp, "data");
  await fixture(root, { images: n });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const w = await new StudioWorkspace(root).init();
  return { w, root, item: (await w.catalog()).items[0] };
}
const noRegions = async () => ({
  status: "completed",
  regions: [],
  limits: ["Zero is not clearance"],
});
const analyze = (w, key) => p.analyze(w, key, { privacyTool: noRegions });
test("machine proposals/drafts leave originals, active version, human decisions and credentials intact", async t => {
  const { w, root, item } = await setup(t),
    sha = await fileHash(await w.mediaPath(item));
  const credentials = await fileHash(resolve(root, ".studio/identities.json"));
  await a.saveModelReport(
    w,
    {
      key: item.key,
      version: 0,
      imageSha256: sha,
      detections: [{ classId: 2, score: 0.7, box: [0.1, 0.1, 0.2, 0.2] }],
      text: [],
    },
    p.producer,
    {}
  );
  const r = await analyze(w, item.key);
  assert.equal(r.producer.kind, "machine");
  assert.equal(r.humanApproval, false);
  assert.equal(r.privacy.humanInspectionRequired, true);
  assert.equal(r.conditions.scene.value, null);
  assert.equal(r.conditions.scene.status, "needs_evidence");
  assert.equal((await w.item(item.key)).version, 0);
  assert.equal(await fileHash(await w.mediaPath(item)), sha);
  assert.equal(
    await fileHash(resolve(root, ".studio/identities.json")),
    credentials
  );
  assert.equal((await p.board(w)).summary.eligible, 0);
  const metadata = await sharp(await p.draftPath(w, r.id)).metadata();
  assert.ok(!metadata.exif && !metadata.xmp && !metadata.iptc);
  assert.ok(r.issues.some(x => x.type === "original_unmatched"));
  assert.equal(r.rights[0].evidenceStatus, "hash_verified");
  assert.ok(
    r.rights[0].gaps.includes("independent_commercial_training_rights_review")
  );
});
test("actual preparer explicitly selects proposals; trusted audit rejects identity spoofing and self approval", async t => {
  const { w, item } = await setup(t);
  await a.saveModelReport(
    w,
    {
      key: item.key,
      version: 0,
      imageSha256: item.sample.sha256,
      detections: [{ classId: 2, score: 0.7, box: [0.1, 0.1, 0.2, 0.2] }],
      text: [],
    },
    p.producer,
    {}
  );
  const r = await analyze(w, item.key),
    request = {
      reportId: r.id,
      version: 0,
      action: "labels",
      confirm: true,
      proposalIds: [r.proposals[0].id],
      reason: "synthetic human checked proposal",
      actor: "reviewer",
    };
  await assert.rejects(
    p.confirm(w, { ...request, confirm: false }, editor),
    /confirmation/
  );
  await assert.rejects(p.confirm(w, request, reviewer), /Role/);
  await p.confirm(w, request, editor);
  const i = await w.item(item.key),
    revision = await w.json((await w.revisions(item.key))[0]);
  assert.equal(i.sample.annotation.annotator, "editor");
  assert.equal(revision.actor, "editor");
  assert.equal(revision.proposalAudit.confirmedBy, "editor");
  assert.deepEqual(revision.proposalAudit.proposalIds, request.proposalIds);
  assert.equal(
    i.sample.annotation.objects.length,
    item.sample.annotation.objects.length + 1
  );
  assert.equal(i.status, "pending");
  assert.equal(
    (await p.board(w)).items.find(x => x.key === item.key).stale,
    true
  );
  await assert.rejects(p.confirm(w, request, editor), /stale/);
  await assert.rejects(p.draftPath(w, r.id), /stale/);
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "labels",
        status: "approved",
        version: 1,
        reason: "self approval forbidden",
        exhaustive: true,
      },
      editor
    ),
    /Independent/
  );
  await w.change(
    item.key,
    {
      action: "review",
      kind: "labels",
      status: "approved",
      version: 1,
      reason: "independent synthetic inspection",
      exhaustive: true,
    },
    reviewer
  );
  assert.equal((await w.item(item.key)).sample.annotation.reviewer, "reviewer");
});
test("uncertain conditions can be prepared but cannot pass final label gate; draft use records actual preparer", async t => {
  const { w, item } = await setup(t),
    r = await analyze(w, item.key);
  await p.confirm(
    w,
    {
      reportId: r.id,
      version: 0,
      action: "labels",
      confirm: true,
      proposalIds: [],
      reason: "conditions unknown needs capture evidence",
      conditions: {
        lighting: "unreviewed",
        scene: "unreviewed",
        motion: "unreviewed",
      },
    },
    editor
  );
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "labels",
        status: "approved",
        version: 1,
        reason: "cannot invent conditions",
        exhaustive: true,
      },
      reviewer
    ),
    /Scene conditions/
  );
  const next = await analyze(w, item.key),
    original = item.sample.sha256;
  await p.confirm(
    w,
    {
      reportId: next.id,
      version: 1,
      action: "draft",
      confirm: true,
      reason: "human checked separate synthetic draft",
    },
    editor
  );
  const i = await w.item(item.key);
  assert.ok(i.activePath);
  assert.equal(i.sample.sha256, original);
  assert.equal(i.sample.privacy.status, "pending");
});
test("rights rejection prevents preparing or activating derivative; missing evidence stays blocked", async t => {
  const { w, item } = await setup(t);
  await w.change(
    item.key,
    {
      action: "review",
      kind: "rights",
      status: "rejected",
      version: 0,
      reason: "synthetic rights rejected",
    },
    reviewer
  );
  const r = await analyze(w, item.key);
  assert.equal(r.draft, null);
  assert.ok(r.issues.some(x => x.type === "rights_rejected"));
  await assert.rejects(
    p.confirm(
      w,
      {
        reportId: r.id,
        version: 1,
        action: "draft",
        confirm: true,
        reason: "cannot bypass rights",
      },
      editor
    ),
    /No proposed/
  );
});
test("pilot selection cannot bypass pending/synthetic/unknown keys, or forge provenance through generic change", async t => {
  const { w, item } = await setup(t);
  await assert.rejects(
    w.exportBatch(null, reviewer, { keys: [item.key] }),
    /Entire batch/
  );
  await assert.rejects(
    w.exportBatch(null, reviewer, { keys: [] }),
    /selection/
  );
  await assert.rejects(
    w.exportBatch(null, reviewer, { keys: ["f".repeat(32)] }),
    /Entire batch/
  );
  await w.change(
    item.key,
    {
      action: "labels",
      version: 0,
      reason: "ordinary synthetic edit",
      objects: item.sample.annotation.objects,
      proposalAudit: { confirmedBy: "reviewer" },
    },
    editor
  );
  const revision = await w.json((await w.revisions(item.key))[0]);
  assert.equal(revision.proposalAudit, null);
});
test("small independently approved selection exports without waiting for pending library; existing whole-batch gate stays intact", async t => {
  const { w, root } = await setup(t, 3);
  const path = resolve(root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await readFile(path));
  // Fictional pixels and decisions exercise the real-data schema only, never a training corpus.
  data.contentKind = "real";
  await writeFile(path, JSON.stringify(data));
  const item = (await w.catalog()).items[0];
  await w.change(
    item.key,
    {
      action: "labels",
      version: 0,
      reason: "fixture preparation",
      objects: item.sample.annotation.objects,
    },
    editor
  );
  for (const [n, kind] of ["rights", "privacy", "labels"].entries())
    await w.change(
      item.key,
      {
        action: "review",
        kind,
        status: "approved",
        version: n + 1,
        reason: "independent fictional decision",
        exhaustive: true,
        metadataStripped: true,
        faces: "absent",
        plates: "absent",
        personalText: "absent",
      },
      reviewer
    );
  await assert.rejects(w.exportBatch(item.batch, reviewer), /Entire batch/);
  const result = await w.exportBatch(null, reviewer, { keys: [item.key] });
  assert.equal(result.samples, 1);
  assert.equal(result.trainingStarted, false);
  const snapshot = await w.json(result.path);
  assert.equal(snapshot.samples.length, 1);
  assert.equal(snapshot.samples[0].split, null);
  assert.equal((await w.catalog()).summary.pending, 2);
});
test("missing/changed license evidence and failed privacy tools remain unresolved, never cleared", async t => {
  const { w, root, item } = await setup(t);
  await writeFile(
    resolve(root, "incoming/demo/rights/team.txt"),
    "Changed synthetic license evidence"
  );
  const r = await p.analyze(w, item.key, {
    privacyTool: async () => {
      throw new Error("fixture tool failure");
    },
  });
  assert.equal(r.rights[0].evidenceStatus, "hash_mismatch");
  assert.ok(r.rights[0].gaps.includes("source_evidence"));
  assert.equal(r.privacy.status, "failed");
  assert.equal(r.privacy.humanInspectionRequired, true);
  assert.equal((await w.item(item.key)).sample.privacy.status, "pending");
  assert.equal((await p.shareable(w)).automaticHumanApprovals, 0);
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "rights",
        status: "approved",
        version: 0,
        reason: "cannot approve tampered evidence",
      },
      reviewer
    ),
    /SHA/
  );
});

test("explicit preparer rejection is logged separately from deferred proposals and independent approvals", async t => {
  const { w, item } = await setup(t);
  await a.saveModelReport(
    w,
    {
      key: item.key,
      version: 0,
      imageSha256: item.sample.sha256,
      detections: [{ classId: 2, score: 0.7, box: [0.1, 0.1, 0.2, 0.2] }],
      text: [],
    },
    p.producer,
    {}
  );
  const r = await analyze(w, item.key),
    id = r.proposals[0].id;
  const request = {
    reportId: r.id,
    version: 0,
    action: "labels",
    confirm: true,
    proposalIds: [],
    rejectedProposalIds: [id],
    reason: "checked fixture false positive",
  };
  await assert.rejects(
    p.confirm(w, { ...request, proposalIds: [id] }, editor),
    /rejected proposal/
  );
  await p.confirm(w, request, editor);
  const revision = await w.json((await w.revisions(item.key))[0]);
  assert.deepEqual(revision.proposalAudit.rejectedProposalIds, [id]);
  assert.deepEqual(revision.proposalAudit.deferredProposalIds, []);
  assert.deepEqual(
    revision.sample.annotation.objects,
    item.sample.annotation.objects
  );
  assert.equal(revision.sample.annotation.status, "pending");
  assert.equal(revision.actor, "editor");
  assert.equal(revision.sample.annotation.reviewer, "");
});
