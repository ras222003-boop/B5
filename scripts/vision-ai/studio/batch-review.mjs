/** Local inspection receipts: opening a batch never constitutes a human decision. */
import {
  readFile,
  writeFile,
  open,
  rename,
  readdir,
  unlink,
  link,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { hash, fileHash, requireValue as check } from "../common.mjs";
import * as prereview from "./prereview.mjs";
import * as assistant from "./assistant.mjs";
import { finalCohort, exposures } from "../test-cohort.mjs";
import { assignSplits, exportCoco, validateDataset } from "../data.mjs";

const base = ".studio/batch-review";
const stamp = i =>
  hash(
    JSON.stringify([
      i.key,
      i.version,
      i.baseHash,
      i.activeSha256 ?? i.sample.sha256,
    ])
  );
const knownConditions = c =>
  ["daylight", "indoor", "low_light", "mixed"].includes(c?.lighting) &&
  ["indoor", "outdoor"].includes(c?.scene) &&
  ["static", "moving"].includes(c?.motion);
const privacyChoice = p =>
  ["faces", "plates", "personalText"].every(k =>
    ["absent", "redacted"].includes(p?.[k])
  );
const uid = id =>
  check(
    typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
    "Invalid operation ID"
  );
export class BatchReview {
  constructor(workspace) {
    this.w = workspace;
    this.receipts = new Map();
    this.running = false;
  }
  async init() {
    for (const d of [base, `${base}/jobs`]) await this.w.ensure(d);
    // This library has been exposed to development. It must never become a fresh final test.
    const p = `${base}/development-observed.json`;
    try {
      await this.w.json(p);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const c = await this.w.catalog();
      await writeFile(
        await this.w.safe(p, true),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            purpose:
              "Exclude existing diagnostic library from an independent final test",
            samples: c.items.map(i => ({
              key: i.key,
              sha256: i.sample.sha256,
              group: i.sample.leakageGroup,
              videoSha256: i.sample.media?.video?.sha256 ?? null,
            })),
          },
          null,
          2
        ),
        { flag: "wx", mode: 0o600 }
      );
    }
    return this;
  }
  async proof(i) {
    const problems = [];
    let evidence = [];
    if (i.conflict) problems.push("manifest_conflict");
    if (assistant.rightsBlocked(i)) problems.push("rights_rejected");
    if (
      !i.sources.length ||
      i.sources.some(
        s => !s.origin || !s.license || s.containsUserData !== false
      )
    )
      problems.push("source_information");
    try {
      evidence = await this.w.sourceEvidence(i);
    } catch {
      problems.push("source_evidence");
    }
    if (
      (await fileHash(await this.w.mediaPath(i))) !==
      (i.activeSha256 ?? i.sample.sha256)
    )
      problems.push("media_changed");
    return { problems, evidence };
  }
  async preparation(i) {
    const revisions = await this.w.revisions(i.key);
    for (const path of revisions.reverse()) {
      const r = await this.w.json(path);
      if (r.action === "review") continue;
      return r.batchAudit?.stage === "prepare" ? r.batchAudit : null;
    }
    return null;
  }
  async board(actor) {
    const cohort = await finalCohort(this.w.root);
    const catalog = await this.w.catalog(),
      scan = await assistant.scan(this.w),
      items = [];
    for (const i of catalog.items) {
      const p = await this.proof(i),
        prepared = await this.preparation(i);
      const related = scan.pairs.filter(
        x =>
          (x.a === i.key || x.b === i.key) && (x.requiresReview || x.crossSplit)
      );
      const exceptions = [...p.problems];
      if (cohort?.samples.some(s => s.key === i.key))
        exceptions.push("protected_final_test");
      if (!knownConditions(i.sample.conditions))
        exceptions.push("scene_evidence");
      if (related.length) exceptions.push("similarity_unresolved");
      if (!prepared) exceptions.push("preparer_inspection");
      if (i.sample.media?.kind !== "image")
        exceptions.push("video_requires_frame_review");
      const independent = !(await this.w.contributors(i)).has(actor.id);
      const high = exceptions.some(x =>
        [
          "rights_rejected",
          "manifest_conflict",
          "media_changed",
          "similarity_unresolved",
        ].includes(x)
      );
      items.push({
        key: i.key,
        id: i.sample.id,
        version: i.version,
        contentKind: i.contentKind,
        status: i.status,
        classes: i.sample.annotation.objects.map(o => o.classId),
        batch: i.batch,
        preparedBy: prepared?.actor ?? null,
        category: high
          ? "high_risk"
          : exceptions.length
            ? "needs_information"
            : "ready",
        exceptions,
        independent,
        queued: [...this.receipts.values()].some(
          r =>
            r.actor === actor.id &&
            r.key === i.key &&
            r.stamp === stamp(i) &&
            r.assessment &&
            !r.used &&
            r.expires > Date.now()
        ),
      });
    }
    return {
      items,
      pairs: scan.pairs.filter(p => p.requiresReview || p.crossSplit),
      trainingStarted: false,
      finalTest: "NEW_INDEPENDENT_CAPTURE_SESSIONS_REQUIRED",
      notice:
        "Ready means ready for human inspection, never automatic approval.",
    };
  }
  async inspect(key, stage, actor, session) {
    check(["prepare", "approve"].includes(stage), "Invalid review stage");
    this.role(stage, actor);
    const i = await this.w.item(key),
      proof = await this.proof(i);
    if (stage === "approve")
      check(
        !(await this.w.contributors(i)).has(actor.id),
        "Independent reviewer must differ from every contributor"
      );
    let report = null;
    // Reports are reused only at their exact input revision. No inference runs here.
    const dir = await this.w.ensure(".studio/prereview");
    void dir;
    try {
      const reports = [];
      for (const file of await readdir(
        await this.w.safe(".studio/prereview/reports")
      )) {
        if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
        const r = await this.w.json(`.studio/prereview/reports/${file}`);
        if (prereview.current(r, i)) reports.push(r);
      }
      report =
        reports.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))[0] ??
        null;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    // Expire unused receipts and bound memory; an expired receipt needs fresh inspection.
    for (const [id, r] of this.receipts)
      if (r.expires < Date.now() || r.used) this.receipts.delete(id);
    check(
      this.receipts.size < 2000,
      "Too many pending inspections; complete or reload your batch"
    );
    const id = randomUUID(),
      prepared = await this.preparation(i);
    const r = {
      id,
      key,
      stage,
      actor: actor.id,
      session,
      stamp: stamp(i),
      expires: Date.now() + 2 * 3600_000,
      evidenceHash: hash(JSON.stringify(proof.evidence)),
      report,
      prepared,
      loaded: new Set(),
      reportSha256: report
        ? await fileHash(
            await this.w.safe(`.studio/prereview/reports/${report.id}.json`)
          )
        : null,
    };
    this.receipts.set(id, r);
    return {
      receipt: id,
      key,
      stage,
      version: i.version,
      id: i.sample.id,
      sample: i.sample,
      sources: i.sources,
      evidence: proof.evidence,
      problems: proof.problems,
      report,
      preparation: prepared,
      original: `/api/batch/media/${id}/original`,
      preview: `/api/batch/media/${id}/preview`,
      humanReviewRequired: true,
    };
  }
  role(stage, actor) {
    check(
      stage === "prepare"
        ? actor.roles.includes("annotator")
        : ["rights", "privacy", "labels"].every(x => actor.roles.includes(x)),
      "Role not authorized for batch stage"
    );
  }
  receipt(id, actor, session) {
    uid(id);
    const r = this.receipts.get(id);
    check(
      r &&
        !r.used &&
        r.actor === actor.id &&
        r.session === session &&
        r.expires > Date.now(),
      "Inspection receipt expired or belongs to another session"
    );
    return r;
  }
  async fresh(r) {
    const i = await this.w.item(r.key);
    if (stamp(i) !== r.stamp)
      throw Object.assign(
        new Error(
          "Revision conflict; inspect the new version. Your pending choices are retained."
        ),
        { code: "REVISION_CONFLICT", currentVersion: i.version }
      );
    const proof = await this.proof(i);
    check(
      !proof.problems.length,
      `Missing evidence or unsafe input: ${proof.problems.join(", ")}`
    );
    check(
      hash(JSON.stringify(proof.evidence)) === r.evidenceHash,
      "Source evidence changed; inspect again"
    );
    if (r.report)
      check(
        (await fileHash(
          await this.w.safe(`.studio/prereview/reports/${r.report.id}.json`)
        )) === r.reportSha256,
        "Analysis evidence changed; inspect again"
      );
    return i;
  }
  async media(id, kind, actor, session) {
    const r = this.receipt(id, actor, session),
      i = await this.w.item(r.key);
    check(stamp(i) === r.stamp, "Revision conflict; inspect again");
    check(["original", "preview"].includes(kind), "Invalid inspection media");
    let path = await this.w.mediaPath(i, kind === "original");
    if (kind === "preview" && r.stage === "prepare" && r.report?.draft)
      path = await prereview.draftPath(this.w, r.report.id);
    const bytes = await readFile(path);
    if (kind === "original")
      check(hash(bytes) === i.sample.sha256, "Original SHA mismatch");
    else if (r.stage !== "prepare" || !r.report?.draft)
      check(
        hash(bytes) === (i.activeSha256 ?? i.sample.sha256),
        "Preview SHA mismatch"
      );
    r.loaded.add(kind);
    return bytes;
  }
  async attest(p, actor, session) {
    const r = this.receipt(p.receipt, actor, session);
    this.role(r.stage, actor);
    check(
      r.loaded.has("original") && r.loaded.has("preview"),
      "Open original and preview before confirming inspection"
    );
    const i = await this.fresh(r);
    check(
      ["labelsInspected", "privacyInspected", "sourcesInspected"].every(
        k => p[k] === true
      ),
      "Inspect labels, privacy and all source evidence for this image"
    );
    check(
      typeof p.reason === "string" &&
        p.reason.trim().length >= 3 &&
        p.reason.length <= 2000,
      "Decision reason required"
    );
    check(
      privacyChoice(p.privacy),
      "Explicit privacy decisions required; unresolved risks cannot join a batch"
    );
    const conditions =
      r.stage === "prepare" ? p.conditions : i.sample.conditions;
    check(
      knownConditions(conditions),
      "Scene conditions need evidence; keep this image in exceptions if uncertain"
    );
    let proposalIds = [],
      rejectedProposalIds = [],
      objects = structuredClone(i.sample.annotation.objects);
    if (r.stage === "prepare") {
      check(
        i.sample.media?.kind === "image",
        "Video frames require the existing track-aware editor"
      );
      const proposals = r.report?.proposals ?? [];
      check(
        Array.isArray(p.proposalIds) && Array.isArray(p.rejectedProposalIds),
        "Explicit proposal decisions required"
      );
      proposalIds = p.proposalIds;
      rejectedProposalIds = p.rejectedProposalIds;
      const all = [...proposalIds, ...rejectedProposalIds];
      check(
        new Set(all).size === all.length &&
          all.length === proposals.length &&
          all.every(id => proposals.some(x => x.id === id)),
        "Resolve every candidate explicitly; deferred candidates remain exceptions"
      );
      const changed = new Set();
      for (const id of proposalIds) {
        const x = proposals.find(x => x.id === id);
        if (x.objectId) {
          check(
            !changed.has(x.objectId),
            "Choose one correction per original object"
          );
          changed.add(x.objectId);
          const o = objects.find(o => o.id === x.objectId);
          check(o, "Original object missing");
          o.classId = x.classId;
          o.box = x.box;
        } else
          objects.push({
            id: randomUUID(),
            classId: x.classId,
            box: x.box,
            trackId: null,
            occluded: false,
            truncated: false,
            groundContact: "unknown",
          });
      }
    } else {
      check(
        r.prepared,
        "Actual preparer confirmation required before batch approval"
      );
      check(
        !(await this.w.contributors(i)).has(actor.id),
        "Independent reviewer must differ from every contributor"
      );
      check(
        p.commercialTrainingRights === true,
        "Independent commercial training rights inspection required"
      );
      await assistant.releaseGroups(this.w, [i]);
    }
    r.assessment = {
      objects,
      conditions,
      privacy: p.privacy,
      proposalIds,
      rejectedProposalIds,
      labelsInspected: true,
      privacyInspected: true,
      sourcesInspected: true,
      commercialTrainingRights: r.stage === "approve",
      reason: p.reason.trim(),
      at: new Date().toISOString(),
    };
    return { queued: true, key: r.key, version: i.version, receipt: r.id };
  }
  async jobWrite(path, job) {
    const temporary = `${path}.${randomUUID()}.tmp`,
      p = await this.w.safe(temporary, true);
    const f = await open(p, "wx", 0o600);
    try {
      await f.writeFile(JSON.stringify(job, null, 2) + "\n");
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(p, await this.w.safe(path));
  }
  async newJob(path, job) {
    const temporary = await this.w.safe(`${path}.${randomUUID()}.tmp`, true);
    const f = await open(temporary, "wx", 0o600);
    try {
      await f.writeFile(JSON.stringify(job, null, 2) + "\n");
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await link(temporary, await this.w.safe(path, true));
    } finally {
      await unlink(temporary);
    }
  }
  async commit(p, actor, session) {
    uid(p.operationId);
    this.role(p.stage, actor);
    check(["prepare", "approve"].includes(p.stage), "Invalid review stage");
    check(
      Array.isArray(p.receipts) &&
        p.receipts.length > 0 &&
        p.receipts.length <= 1000 &&
        new Set(p.receipts).size === p.receipts.length,
      "Explicit unique inspected selection required"
    );
    const path = `${base}/jobs/${p.operationId}.json`,
      payloadHash = hash(
        JSON.stringify({ stage: p.stage, receipts: p.receipts })
      );
    let existing;
    try {
      existing = await this.w.json(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (existing) {
      check(
        existing.actor === actor.id && existing.payloadHash === payloadHash,
        "Operation ID already used by another request"
      );
      if (existing.status === "completed") return existing;
      // A crash may leave committed revisions. Never replay any decision automatically.
      return {
        ...existing,
        status: "in_progress_or_interrupted",
        needsReinspection: true,
      };
    }
    if (this.running) {
      check(
        this.running.operationId === p.operationId &&
          this.running.actor === actor.id &&
          this.running.payloadHash === payloadHash,
        "Another batch operation is active; retry the same operation ID"
      );
      return {
        ...this.running,
        status: "in_progress_or_interrupted",
        needsReinspection: false,
      };
    }
    const job = {
      operationId: p.operationId,
      stage: p.stage,
      actor: actor.id,
      payloadHash,
      status: "running",
      at: new Date().toISOString(),
      results: [],
      trainingStarted: false,
    };
    this.running = job;
    try {
      try {
        await this.newJob(path, job);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const prior = await this.w.json(path);
        check(
          prior.actor === actor.id && prior.payloadHash === payloadHash,
          "Operation ID already used by another request"
        );
        return {
          ...prior,
          status:
            prior.status === "completed"
              ? "completed"
              : "in_progress_or_interrupted",
        };
      }
      const seen = new Set();
      for (const id of p.receipts) {
        let r;
        try {
          r = this.receipt(id, actor, session);
          check(
            r.stage === p.stage && r.assessment,
            "Individual inspection confirmation required"
          );
          check(!seen.has(r.key), "One receipt per image required");
          seen.add(r.key);
          const i = await this.fresh(r),
            a = r.assessment;
          const batchAudit = {
            verified: true,
            stage: r.stage,
            operationId: p.operationId,
            receipt: r.id,
            actor: actor.id,
            inspectedAt: a.at,
            inputVersion: i.version,
            inputSha256: i.activeSha256 ?? i.sample.sha256,
            evidenceHash: r.evidenceHash,
            assessment: a,
            reportId: r.report?.id ?? null,
            reportSha256: r.reportSha256,
          };
          let image;
          if (r.stage === "prepare") {
            const input = r.report?.draft
              ? await prereview.draftPath(this.w, r.report.id)
              : await this.w.mediaPath(i);
            // Original pixels are immutable. Even an unmasked candidate is a separate metadata-free PNG.
            image = (await sharp(input).png().toBuffer()).toString("base64");
          } else {
            check(await this.preparation(i), "Preparer confirmation changed");
            await assistant.releaseGroups(this.w, [i]);
          }
          const result = await this.w.change(
            i.key,
            {
              action:
                r.stage === "prepare" ? "prepare-bundle" : "review-bundle",
              version: i.version,
              baseHash: i.baseHash,
              imageSha256: i.activeSha256 ?? i.sample.sha256,
              reason: a.reason,
              objects: a.objects,
              conditions: a.conditions,
              image,
              ...a.privacy,
              metadataStripped: true,
              exhaustive: true,
            },
            actor,
            { batchAudit }
          );
          r.used = true;
          job.results.push({ key: i.key, ...result, saved: true });
        } catch (e) {
          job.results.push({
            key: r?.key ?? null,
            saved: false,
            error: e.message,
            code: e.code ?? "VALIDATION_FAILED",
          });
        }
        await this.jobWrite(path, job);
      }
      if (p.stage === "approve") {
        const real = [];
        for (const result of job.results.filter(x => x.saved)) {
          const i = await this.w.item(result.key);
          if (i.contentKind === "real" && i.status === "approved")
            real.push(i.key);
        }
        if (real.length) {
          try {
            job.preparation = await this.prepareTraining(real, actor);
          } catch (e) {
            job.preparation = {
              status: "EXPORT_BLOCKED",
              reason: e.message,
              trainingStarted: false,
            };
          }
        } else
          job.preparation = {
            status: "NO_APPROVED_REAL_SELECTION",
            trainingStarted: false,
          };
      }
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      await this.jobWrite(path, job);
      return job;
    } finally {
      this.running = false;
    }
  }
  async prepareTraining(keys, actor) {
    this.role("approve", actor);
    check(
      Array.isArray(keys) &&
        keys.length > 0 &&
        keys.length <= 1000 &&
        new Set(keys).size === keys.length,
      "Explicit approved training selection required"
    );
    let prior;
    try {
      prior = await this.w.json(`${base}/frozen-export.json`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (prior) {
      check(
        prior.status === "completed",
        "Frozen export is incomplete; inspect its recorded files before any new export"
      );
      for (const binding of prior.bindings) {
        const i = await this.w.item(binding.key);
        check(
          stamp(i) === binding.stamp,
          "A frozen pilot input changed; preserve the old release and review a new dataset version explicitly"
        );
      }
      check(
        (await fileHash(await this.w.safe(prior.result.manifest))) ===
          prior.result.manifestSha256,
        "Frozen manifest SHA mismatch"
      );
      const manifest = await this.w.json(prior.result.manifest),
        report = await validateDataset(manifest, this.w.root),
        lock = await this.w.json(`${prior.result.export}/dataset.lock.json`),
        cohort = await finalCohort(this.w.root);
      check(
        cohort &&
          (await fileHash(await this.w.safe(cohort.evidence.path))) ===
            cohort.evidence.sha256,
        "Final-test capture evidence SHA mismatch"
      );
      check(
        (await fileHash(await this.w.safe(`${base}/final-test.json`))) ===
          manifest.splitPolicy.finalTestCohortSha256 &&
          lock.datasetSha256 === report.datasetSha256,
        "Frozen export binding mismatch"
      );
      for (const split of ["train", "validation", "test"])
        check(
          (await fileHash(
            await this.w.safe(`${prior.result.export}/${split}.json`)
          )) === lock.files[`${split}.json`],
          "Frozen export file SHA mismatch"
        );
      return {
        ...prior.result,
        reusedFrozenExport: true,
        newSelectionNotAutomaticallyAdded: true,
      };
    }
    // Reuse the established validator/exporter. Current diagnostics must not be relabeled as final test.
    const cohort = await finalCohort(this.w.root);
    if (cohort) {
      check(
        (await fileHash(await this.w.safe(cohort.evidence.path))) ===
          cohort.evidence.sha256,
        "Final-test capture evidence SHA mismatch"
      );
      for (const s of cohort.samples) {
        const i = await this.w.item(s.key);
        check(
          i.version === s.version &&
            i.baseHash === s.baseHash &&
            (i.activeSha256 ?? i.sample.sha256) === s.imageSha256,
          "Protected final-test revision changed"
        );
      }
    }
    const wanted = [
      ...new Set([...keys, ...(cohort?.samples.map(s => s.key) ?? [])]),
    ];
    const snapshot = await this.w.exportBatch(null, actor, { keys: wanted });
    if (!cohort)
      return {
        status: "WAITING_NEW_INDEPENDENT_TEST_SESSIONS",
        snapshot,
        next: "Register approved new capture sessions before freezing train/validation/test and COCO export. No training approval is implied.",
        trainingStarted: false,
      };
    const data = await this.w.json(snapshot.path);
    check(
      !data.samples.some(s => s.split !== null),
      "Use existing frozen export; never replace a frozen split"
    );
    const isTest = s => cohort.samples.some(x => x.imageSha256 === s.sha256);
    const trainPool = {
      ...data,
      samples: data.samples.filter(s => !isTest(s)),
    };
    check(
      !trainPool.samples.some(s =>
        cohort.samples.some(x => x.group === s.leakageGroup)
      ),
      "Final-test sessions overlap development"
    );
    const grouped = assignSplits(trainPool);
    const assignments = new Map(
      grouped.samples.map(s => [s.id, s.split === "test" ? "train" : s.split])
    );
    const frozen = {
      ...data,
      splitPolicy: {
        ...grouped.splitPolicy,
        targetGroupRatios: null,
        finalTestCohortSha256: await fileHash(
          await this.w.safe(`${base}/final-test.json`)
        ),
        note: "Validation uses the established grouped ordering. Its provisional test reservation is returned to train. Only independently registered new sessions form final test.",
      },
      samples: data.samples.map(s => ({
        ...s,
        split: isTest(s) ? "test" : assignments.get(s.id),
      })),
    };
    check(
      frozen.samples.some(s => s.split === "test"),
      "Independent test cohort missing from snapshot"
    );
    await validateDataset(frozen, this.w.root);
    const id = randomUUID(),
      path = `studio-frozen-${id}.json`,
      output = `exports/pilot-${id}`;
    await writeFile(
      await this.w.safe(path, true),
      JSON.stringify(frozen, null, 2) + "\n",
      { flag: "wx", mode: 0o600 }
    );
    await this.w.ensure("exports");
    const reservation = {
      status: "pending",
      actor: actor.id,
      at: new Date().toISOString(),
      bindings: await Promise.all(
        wanted.map(async key => ({ key, stamp: stamp(await this.w.item(key)) }))
      ),
      result: {
        status: "FROZEN_COCO_READY_REQUIRES_SEPARATE_TRAINING_APPROVAL",
        manifest: path,
        manifestSha256: await fileHash(await this.w.safe(path)),
        export: output,
        trainingStarted: false,
      },
    };
    await this.newJob(`${base}/frozen-export.json`, reservation);
    await exportCoco(frozen, this.w.root, await this.w.safe(output, true));
    reservation.status = "completed";
    await this.jobWrite(`${base}/frozen-export.json`, reservation);
    return reservation.result;
  }
  async registerTest(p, actor) {
    this.role("approve", actor);
    const lockPath = await this.w.safe(".studio/write.lock", true),
      lock = await open(lockPath, "wx", 0o600);
    try {
      check(
        p.newSessionsInspected === true &&
          p.neverUsedForTuning === true &&
          p.reason?.trim().length >= 3,
        "Explicit independent new-session evidence inspection required"
      );
      check(
        Array.isArray(p.keys) &&
          p.keys.length > 0 &&
          new Set(p.keys).size === p.keys.length,
        "Explicit independent final-test selection required"
      );
      check(
        !(await finalCohort(this.w.root)),
        "Final test already registered; preserve this frozen cohort"
      );
      check(
        typeof p.evidence?.path === "string" &&
          /^[a-f0-9]{64}$/.test(p.evidence.sha256 ?? ""),
        "Capture/session evidence and SHA required"
      );
      check(
        (await fileHash(await this.w.safe(p.evidence.path))) ===
          p.evidence.sha256,
        "Capture evidence SHA mismatch"
      );
      const observed = await exposures(this.w),
        samples = [];
      for (const key of p.keys) {
        const i = await this.w.item(key);
        check(
          i.status === "approved" &&
            i.contentKind === "real" &&
            !!i.sample.leakageGroup,
          "Approved real new sessions required"
        );
        check(
          !(await this.w.contributors(i)).has(actor.id),
          "Independent reviewer must differ from every contributor"
        );
        check(
          !observed.some(
            x =>
              x.key === key ||
              x.sha256 === i.sample.sha256 ||
              x.group === i.sample.leakageGroup ||
              (x.videoSha256 && x.videoSha256 === i.sample.media?.video?.sha256)
          ),
          "Previously observed development image/session cannot become an independent final test"
        );
        check(
          !(await assistant.reports(this.w, key)).length,
          "Previously analyzed sample cannot become an independent final test"
        );
        await assistant.releaseGroups(this.w, [i]);
        await this.proof(i).then(x =>
          check(!x.problems.length, "Final test evidence incomplete")
        );
        samples.push({
          key,
          version: i.version,
          baseHash: i.baseHash,
          originalSha256: i.sample.sha256,
          imageSha256: i.activeSha256 ?? i.sample.sha256,
          group: i.sample.leakageGroup,
          videoSha256: i.sample.media?.video?.sha256 ?? null,
        });
      }
      const record = {
        schemaVersion: 1,
        actor: actor.id,
        at: new Date().toISOString(),
        reason: p.reason,
        evidence: p.evidence,
        samples,
        neverUsedForTuning: true,
      };
      const temporary = await this.w.safe(
        `${base}/final-test.${randomUUID()}.tmp`,
        true
      );
      const f = await open(temporary, "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(record, null, 2) + "\n");
        await f.sync();
      } finally {
        await f.close();
      }
      try {
        await link(
          temporary,
          await this.w.safe(`${base}/final-test.json`, true)
        );
      } finally {
        await unlink(temporary);
      }
      return { registered: samples.length, trainingStarted: false };
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
