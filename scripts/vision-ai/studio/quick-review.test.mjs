/** Fictional pixels/accounts/evidence only. Never a real data approval or training run. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { BatchReview } from "./batch-review.mjs";
import { fileHash, readJson } from "../common.mjs";
import {
  stairsSplits,
  coverage,
  prepareApprovedStairs,
} from "./stairs-readiness.mjs";
import * as assistant from "./assistant.mjs";
const editor = { id: "editor", roles: ["annotator"] },
  reviewer = { id: "reviewer", roles: ["rights", "privacy", "labels"] };
async function setup(t, n = 1) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-quick-unit-")),
    root = resolve(temp, "data");
  await fixture(root, { images: n });
  t.after(() => {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
    return rm(temp, { recursive: true, force: true });
  });
  const path = resolve(root, "incoming/demo/dataset.review.pending.json"),
    d = JSON.parse(await readFile(path));
  for (const s of d.samples) {
    s.annotation.objects[0].classId = 23;
    s.annotation.objects[0].stairsDirection = {
      label: "stairs_up",
      evidence: "Fictional risers visible",
    };
  }
  await writeFile(path, JSON.stringify(d));
  const w = await new StudioWorkspace(root).init(),
    b = await new BatchReview(w).init();
  return { w, b, root, item: (await w.catalog()).items[0] };
}
async function inspect(b, key, stage, actor, session = "session") {
  const d = await b.inspect(key, stage, actor, session);
  await b.media(d.receipt, "original", actor, session);
  await b.media(d.receipt, "preview", actor, session);
  return d;
}
const assessment = d => ({
  receipt: d.receipt,
  task: "basira-stairs-v1",
  conditions: d.sample.conditions,
  privacy: { faces: "absent", plates: "absent", personalText: "absent" },
  labelsInspected: true,
  privacyInspected: true,
  sourcesInspected: true,
  commercialTrainingRights: true,
  reason: "Fictional explicit independent inspection",
  proposalIds: [],
  rejectedProposalIds: (d.report?.proposals ?? []).map(p => p.id),
});
test("drafts persist without decisions, are actor scoped, and reject a stale tab or session", async t => {
  const { w, b, item } = await setup(t),
    d = await inspect(b, item.key, "prepare", editor);
  const first = await b.saveDraft(
    {
      receipt: d.receipt,
      expectedRevision: 0,
      draft: {
        reason: "unfinished fictional draft",
        privacy: { faces: "unreviewed" },
      },
    },
    editor,
    "session"
  );
  assert.equal(first.revision, 1);
  await assert.rejects(
    b.saveDraft(
      {
        receipt: d.receipt,
        expectedRevision: 0,
        draft: { reason: "stale tab" },
      },
      editor,
      "session"
    ),
    /Revision conflict/
  );
  await assert.rejects(
    b.saveDraft({ receipt: d.receipt, draft: {} }, editor, "session"),
    /revision required/
  );
  await assert.rejects(
    b.saveDraft(
      { receipt: d.receipt, expectedRevision: 1, draft: {} },
      reviewer,
      "another"
    ),
    /another session/
  );
  const next = await new BatchReview(w).init(),
    p = await next.progress(editor, "new-session");
  assert.equal(
    p.drafts[`prepare:${item.key}`].values.reason,
    "unfinished fictional draft"
  );
  assert.equal(p.queued.length, 0);
  assert.equal(
    Object.keys((await next.progress(reviewer, "other")).drafts).length,
    0
  );
  assert.equal((await w.item(item.key)).version, 0);
});
test("actual pending inspections survive restart/relogin and require a final click; idempotence and independence persist", async t => {
  const { w, b, item } = await setup(t),
    original = await fileHash(await w.mediaPath(item, true)),
    d = await inspect(b, item.key, "prepare", editor);
  await b.attest(assessment(d), editor, "session");
  assert.equal((await w.item(item.key)).version, 0);
  const next = await new BatchReview(w).init(),
    restored = await next.progress(editor, "new-session");
  assert.equal(restored.queued.length, 1);
  const request = {
      operationId: randomUUID(),
      stage: "prepare",
      task: "basira-stairs-v1",
      receipts: [restored.queued[0].receipt],
    },
    saved = await next.commit(request, editor, "new-session");
  assert.ok(saved.results[0].saved);
  assert.equal(
    (await next.commit(request, editor, "new-session")).results.length,
    1
  );
  assert.equal((await w.item(item.key)).version, 1);
  assert.equal((await next.progress(editor, "again")).queued.length, 0);
  await assert.rejects(
    next.inspect(
      item.key,
      "approve",
      { id: "editor", roles: reviewer.roles },
      "self"
    ),
    /Independent/
  );
  const r = await inspect(next, item.key, "approve", reviewer);
  await next.attest(assessment(r), reviewer, "session");
  const afterRestart = await new BatchReview(w).init(),
    q = await afterRestart.progress(reviewer, "new-reviewer");
  assert.equal(
    (await afterRestart.progress(editor, "new-editor")).queued.length,
    0
  );
  const result = await afterRestart.commit(
    {
      operationId: randomUUID(),
      stage: "approve",
      task: "basira-stairs-v1",
      receipts: q.queued.map(x => x.receipt),
    },
    reviewer,
    "new-reviewer"
  );
  assert.ok(result.results[0].saved);
  const i = await w.item(item.key);
  for (const k of ["rights", "privacy", "labels"])
    assert.equal(i.decisions[k].reviewer, "reviewer");
  assert.equal(i.version, 2);
  assert.equal(await fileHash(await w.mediaPath(i, true)), original);
});
test("changed evidence and changed sample revisions invalidate resumed inspections without auto replay", async t => {
  const { w, b, item, root } = await setup(t),
    d = await inspect(b, item.key, "prepare", editor);
  await b.attest(assessment(d), editor, "session");
  await writeFile(
    resolve(root, "incoming/demo/rights/team.txt"),
    "Changed fictional evidence"
  );
  const next = await new BatchReview(w).init(),
    p = await next.progress(editor, "new-session");
  assert.equal(p.queued.length, 0);
  assert.equal(p.stale.length, 1);
  assert.equal((await w.item(item.key)).version, 0);
});
test("a newer draft in another session invalidates an older in-memory final commit", async t => {
  const { w, b, item } = await setup(t),
    d = await inspect(b, item.key, "prepare", editor);
  await b.attest(assessment(d), editor, "session");
  const other = await new BatchReview(w).init(),
    p = await other.progress(editor, "other");
  await other.saveDraft(
    {
      receipt: p.queued[0].receipt,
      expectedRevision: p.revision,
      draft: { reason: "newer unfinished edit" },
    },
    editor,
    "other"
  );
  const result = await b.commit(
    {
      operationId: randomUUID(),
      stage: "prepare",
      task: "basira-stairs-v1",
      receipts: [d.receipt],
    },
    editor,
    "session"
  );
  assert.equal(result.results[0].saved, false);
  assert.match(result.results[0].error, /Saved inspection/);
  assert.equal((await w.item(item.key)).version, 0);
});
test("quick acceptance never infers privacy or stairs direction and never accepts unresolved source exceptions", async t => {
  const { w, b, item } = await setup(t),
    d = await inspect(b, item.key, "prepare", editor);
  await assert.rejects(
    b.attest(
      {
        ...assessment(d),
        privacy: {
          faces: "unreviewed",
          plates: "absent",
          personalText: "absent",
        },
      },
      editor,
      "session"
    ),
    /Explicit privacy/
  );
  const objects = structuredClone(d.sample.annotation.objects);
  delete objects[0].stairsDirection;
  await assert.rejects(
    b.attest({ ...assessment(d), objects }, editor, "session"),
    /Review every stairs direction/
  );
  await writeFile(
    await w.safe(".studio/human-review-plan.json", true),
    JSON.stringify({
      schemaVersion: 1,
      items: [
        {
          key: item.key,
          version: item.version,
          imageSha256: item.sample.sha256,
          priority: 1,
          tasks: [
            {
              kind: "photographic_origin",
              label: "Fictional source provenance missing",
            },
          ],
        },
      ],
    })
  );
  await assert.rejects(
    b.attest(assessment(d), editor, "session"),
    /Unresolved source/
  );
  assert.equal((await w.item(item.key)).version, 0);
});
function metadata() {
  const samples = [];
  for (const [split, n] of [
    ["train", 4],
    ["validation", 2],
    ["test", 2],
  ])
    for (const label of [
      "stairs_up",
      "stairs_down",
      "stairs_present_uncertain_direction",
      null,
    ])
      for (let i = 0; i < (label ? n : 2); i++) {
        const id = `${split}-${label}-${i}`;
        samples.push({
          id,
          sha256: id,
          leakageGroup: id,
          split: null,
          media: { kind: "image" },
          hardNegatives: label ? [] : ["shadow"],
          annotation: {
            objects: label
              ? [
                  {
                    classId: 23,
                    stairsDirection: {
                      label,
                      evidence: "Fictional direction evidence",
                    },
                  },
                ]
              : [],
          },
        });
      }
  return { samples };
}
test("coverage-only selection reuses grouped splits, preserves the test, and blocks missing directions", async () => {
  const policy = await readJson(
      new URL("../../../ml/vision/stairs-task.v1.json", import.meta.url)
    ),
    data = metadata(),
    before = structuredClone(data),
    cohort = {
      samples: data.samples
        .filter(s => s.id.startsWith("test-"))
        .map(s => ({ imageSha256: s.sha256, group: s.leakageGroup })),
    };
  const split = stairsSplits(data, cohort, policy);
  assert.ok(coverage(split.samples, policy).passed);
  assert.deepEqual(data, before);
  assert.equal(split.splitPolicy.algorithm, "sha256-group-order-v1");
  assert.equal(
    split.splitPolicy.coverageOnlySelection.inferenceMetricsUsed,
    false
  );
  assert.deepEqual(
    split.samples
      .filter(s => s.split === "test")
      .map(s => s.id)
      .sort(),
    cohort.samples.map(s => s.imageSha256).sort()
  );
  delete data.samples.find(s => s.id.startsWith("test-")).annotation.objects[0]
    .stairsDirection;
  assert.throws(() => stairsSplits(data, cohort, policy), /Generic stairs/);
});
test("automatic readiness freezes a covered fictional approved cohort once and stops at missing preflight configuration", async t => {
  const { w, root } = await setup(t, 30),
    path = resolve(root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await readFile(path)),
    meta = metadata().samples;
  data.contentKind = "real";
  data.sources[0].trainingAllowed = true;
  data.sources[0].rightsReview = {
    ...data.sources[0].rightsReview,
    status: "approved",
    reviewer: "fictional-rights-reviewer",
    at: "2020-01-01T00:00:00Z",
  };
  for (let n = 0; n < data.samples.length; n++) {
    const s = data.samples[n],
      m = meta[n];
    const rgb = randomBytes(192),
      rects = Array.from(
        { length: 64 },
        (_, i) =>
          `<rect x="${(i % 8) * 80}" y="${Math.floor(i / 8) * 60}" width="80" height="60" fill="rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})"/>`
      ).join("");
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">${rects}</svg>`
      )
    )
      .png()
      .toFile(resolve(root, "incoming/demo", s.path));
    s.sha256 = await fileHash(resolve(root, "incoming/demo", s.path));
    s.leakageGroup = m.id;
    s.hardNegatives = m.hardNegatives;
    s.taskCandidate = { task: "basira-stairs-v1" };
    s.privacy = {
      ...s.privacy,
      status: "approved",
      reviewer: "fictional-independent-reviewer",
      at: "2020-01-01T00:00:00Z",
      faces: "absent",
      plates: "absent",
      personalText: "absent",
      metadataStripped: true,
    };
    s.annotation = {
      ...s.annotation,
      status: "reviewed",
      annotator: "fictional-author",
      reviewer: "fictional-independent-reviewer",
      exhaustive: true,
      objects: m.annotation.objects.length
        ? [
            {
              ...s.annotation.objects[0],
              stairsDirection: m.annotation.objects[0].stairsDirection,
            },
          ]
        : [],
    };
    if (m.id.startsWith("test-")) s.intendedUse = "independent_test_candidate";
  }
  await writeFile(path, JSON.stringify(data));
  // Re-establish a fictional development ledger before this test's new test intake.
  const c = await w.catalog();
  await writeFile(
    await w.safe(".studio/batch-review/development-observed.json"),
    JSON.stringify({
      samples: c.items
        .filter(i => !i.sample.intendedUse)
        .map(i => ({
          key: i.key,
          sha256: i.sample.sha256,
          group: i.sample.leakageGroup,
        })),
    })
  );
  for (const p of (await assistant.scan(w)).pairs)
    if (p.requiresReview)
      await assistant.reviewPair(
        w,
        {
          id: p.id,
          relation: "different",
          reason: "Independent fictional drawing comparison",
        },
        reviewer
      );
  await writeFile(
    await w.safe("capture-test-only.txt", true),
    "Fictional independent sessions; no actual data attestation"
  );
  const b = await new BatchReview(w).init();
  await b.registerTest(
    {
      keys: c.items.filter(i => i.sample.intendedUse).map(i => i.key),
      newSessionsInspected: true,
      neverUsedForTuning: true,
      reason: "Fictional new-session inspection",
      evidence: {
        path: "capture-test-only.txt",
        sha256: await fileHash(await w.safe("capture-test-only.txt")),
      },
    },
    reviewer
  );
  const r = await prepareApprovedStairs(b, reviewer);
  assert.equal(
    r.status,
    "FROZEN_COCO_READY_REQUIRES_SEPARATE_TRAINING_APPROVAL"
  );
  assert.equal(r.preflight.status, "WAITING_LOCAL_PREFLIGHT_CONFIGURATION");
  assert.equal(r.trainingStarted, false);
  const frozen = await w.json(r.manifest),
    policy = await readJson(
      new URL("../../../ml/vision/stairs-task.v1.json", import.meta.url)
    );
  assert.ok(coverage(frozen.samples, policy).passed);
  assert.ok(await w.json(r.export + "/dataset.lock.json"));
  const again = await prepareApprovedStairs(b, reviewer);
  assert.equal(again.manifest, r.manifest);
  assert.equal(again.reusedFrozenExport, true);
});
