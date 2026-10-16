/** Machine-authored preparation. All human decisions remain in the existing workspace pipeline. */
import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import * as assistant from "./assistant.mjs";
import { fileHash, hash, validBox, requireValue as check } from "../common.mjs";

export const producer = Object.freeze({
  kind: "machine",
  id: "basira-local-prereview",
  version: 1,
});
const base = ".studio/prereview";
const uuid = id =>
  check(
    typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
    "Invalid report ID"
  );
async function folders(w) {
  for (const dir of [base, `${base}/reports`, `${base}/drafts`])
    await w.ensure(dir);
}
export async function getReport(w, id) {
  uuid(id);
  return w.json(`${base}/reports/${id}.json`);
}
export function current(r, i) {
  return (
    r.itemKey === i.key &&
    r.itemVersion === i.version &&
    r.baseHash === i.baseHash &&
    r.imageSha256 === (i.activeSha256 ?? i.sample.sha256)
  );
}
export async function localPrivacy(w, item) {
  let config;
  try {
    config = await w.json(".studio/prereview-cv.json");
  } catch (e) {
    if (e.code === "ENOENT")
      return {
        status: "not_configured",
        regions: [],
        limits: [
          "No local face/plate tool configured. Human inspection required.",
        ],
      };
    throw e;
  }
  check(
    isAbsolute(config.python) &&
      isAbsolute(config.sitePackages) &&
      isAbsolute(config.cascades),
    "Absolute administrator CV paths required"
  );
  const path = await w.mediaPath(item);
  const script = fileURLToPath(new URL("./privacy-cv.py", import.meta.url));
  return new Promise((ok, no) => {
    const child = spawn(config.python, [script], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONPATH: config.sitePackages },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      size = 0,
      settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Local privacy tool timeout"));
    }, 60_000);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? no(error) : ok(value);
    }
    child.on("error", () =>
      finish(new Error("Local privacy tool unavailable"))
    );
    child.stdout.on("data", data => {
      size += data.length;
      if (size > 1_000_000) {
        child.kill();
        finish(new Error("Local tool output limit"));
      } else out += data;
    });
    child.stderr.resume(); // Do not persist paths, pixels or sensitive text in logs.
    child.on("close", code => {
      try {
        check(code === 0, "Local privacy tool failed");
        finish(null, JSON.parse(out));
      } catch (e) {
        finish(e);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        path,
        cascades: config.cascades,
        modelHashes: config.modelHashes,
      })
    );
  });
}
export async function analyze(w, key, { privacyTool = localPrivacy } = {}) {
  await folders(w);
  const item = await w.item(key),
    before = item.activeSha256 ?? item.sample.sha256;
  check(!item.conflict, "Manifest changed; reconcile first");
  const quality = await assistant.analyze(w, key, producer);
  const f = await assistant.fingerprint(w, item);
  const model = (await assistant.reports(w, key)).find(
    r =>
      r.scope === "local-model-proposals" &&
      r.imageSha256 === before &&
      r.itemVersion === item.version &&
      r.baseHash === item.baseHash
  );
  let privacy;
  if (f.orientation !== 1)
    privacy = {
      status: "blocked_orientation",
      regions: [],
      limits: ["Normalize orientation through existing reviewed workflow."],
    };
  else
    try {
      privacy = await privacyTool(w, item);
    } catch {
      privacy = {
        status: "failed",
        regions: [],
        limits: [
          "Local face/plate analysis failed; human inspection required.",
        ],
      };
    }
  check(
    Array.isArray(privacy.regions) &&
      privacy.regions.length <= 100 &&
      privacy.regions.every(r => validBox(r.box)),
    "Invalid local regions"
  );
  const rights = [];
  for (const source of item.sources) {
    const evidence = source.rightsReview?.evidence;
    let evidenceStatus = "missing";
    if (evidence?.path && evidence?.sha256) {
      try {
        evidenceStatus =
          (await fileHash(
            await w.safe(
              `${item.prefix ? item.prefix + "/" : ""}${evidence.path}`
            )
          )) === evidence.sha256
            ? "hash_verified"
            : "hash_mismatch";
      } catch {
        evidenceStatus = "unreadable";
      }
    }
    rights.push({
      sourceId: source.id,
      origin: source.origin ?? null,
      license: source.license ?? null,
      evidence: evidence ?? null,
      evidenceStatus,
      status: source.rightsReview?.status ?? "pending",
      gaps: [
        ...(!source.origin ? ["source_origin"] : []),
        ...(!source.license ? ["license_terms"] : []),
        ...(evidenceStatus !== "hash_verified" ? ["source_evidence"] : []),
        ...(source.rightsReview?.status !== "approved"
          ? ["independent_commercial_training_rights_review"]
          : []),
      ],
      note: "Hash verifies the saved evidence file, not legal entitlement or privacy.",
    });
  }
  const regions = [
    ...privacy.regions,
    ...(model?.redactionRegions ?? []),
  ].slice(0, 100);
  let draft = null;
  const id = randomUUID();
  if (f.orientation === 1 && !assistant.rightsBlocked(item)) {
    const source = await w.mediaPath(item);
    const rectangles = regions
      .map(
        ({ box: [x, y, width, height] }) =>
          `<rect x="${x * f.width}" y="${y * f.height}" width="${width * f.width}" height="${height * f.height}" fill="black"/>`
      )
      .join("");
    const image = sharp(source);
    if (regions.length)
      image.composite([
        {
          input: Buffer.from(
            `<svg width="${f.width}" height="${f.height}">${rectangles}</svg>`
          ),
        },
      ]);
    const bytes = await image.png().toBuffer();
    const path = `${base}/drafts/${id}.png`;
    await writeFile(await w.safe(path, true), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    draft = {
      path,
      sha256: hash(bytes),
      metadataStripped: true,
      maskedRegions: regions.length,
      status: "proposal_not_activated_not_privacy_approved",
    };
  }
  check(
    (await fileHash(await w.mediaPath(item))) === before,
    "Media SHA mismatch"
  );
  const latest = await w.item(key);
  check(
    latest.version === item.version && latest.baseHash === item.baseHash,
    "Analysis became stale"
  );
  const report = {
    schemaVersion: 1,
    id,
    itemKey: key,
    itemVersion: item.version,
    baseHash: item.baseHash,
    imageSha256: before,
    contentKind: item.contentKind,
    producer,
    at: new Date().toISOString(),
    qualityReportId: quality.id,
    modelReportId: model?.id ?? null,
    modelInputActor: model?.actor ?? null,
    modelInputAttestation: model?.attestation ?? null,
    modelStatus: model
      ? model.modelFailures?.some(f => f.capability === "objectDetector")
        ? "failed"
        : "available_unverified_candidates"
      : "missing",
    modelFailures: model?.modelFailures ?? [],
    issues: [
      ...quality.issues,
      ...(model?.issues ?? []),
      ...(item.sample.annotation?.objects ?? [])
        .filter(
          o =>
            !w.taxonomy.classes.find(c => c.id === o.classId)?.baselineLabels
              ?.length
        )
        .map(o => ({
          type: "unsupported_baseline_class",
          objectId: o.id,
          classId: o.classId,
          confidence: null,
          action:
            "هذه الفئة غير مدعومة في محرك COCO الحالي. غياب الكشف ليس دليلًا ضد الوسم؛ تحقق بصريًا.",
        })),
    ],
    proposals: model?.proposals ?? [],
    conditions: {
      brightness: f.brightness,
      lighting: {
        value: f.brightness < 35 ? "low_light" : null,
        status:
          f.brightness < 35 ? "heuristic_needs_confirmation" : "needs_evidence",
        confidence: null,
      },
      scene: {
        value: null,
        status: "needs_evidence",
        reason:
          "No calibrated scene classifier configured. Brightness or object class does not establish indoor/outdoor.",
      },
      motion: { value: null, status: "needs_capture_evidence" },
      original: item.sample.conditions ?? null,
    },
    rights,
    privacy: {
      ...privacy,
      regions,
      humanInspectionRequired: true,
      absenceIsNotClearance: true,
    },
    draft,
    contributors: [...(await w.contributors(item))],
    humanApproval: false,
    trainingStarted: false,
  };
  const finalPath = `${base}/reports/${id}.json`,
    temporaryPath = finalPath + ".tmp";
  await writeFile(
    await w.safe(temporaryPath, true),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx", mode: 0o600 }
  );
  await rename(await w.safe(temporaryPath), await w.safe(finalPath, true));
  return report;
}
export async function board(w) {
  await folders(w);
  const c = await w.catalog(),
    reports = new Map();
  for (const file of await readdir(await w.safe(`${base}/reports`))) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const r = await w.json(`${base}/reports/${file}`),
      prior = reports.get(r.itemKey);
    if (!prior || prior.at < r.at) reports.set(r.itemKey, r);
  }
  const items = c.items
    .map(i => {
      const r = reports.get(i.key),
        valid = r && current(r, i);
      const blockers = [
        ...(i.contentKind !== "real" ? ["synthetic_separate"] : []),
        ...(i.conflict ? ["manifest_conflict"] : []),
        ...["rights", "privacy", "labels"].filter(
          kind => i.decisions?.[kind]?.status !== "approved"
        ),
        ...(!i.sample.annotation?.objects?.length
          ? ["no_objects_review_hard_negative"]
          : []),
      ];
      const classIds = [
        ...new Set((i.sample.annotation?.objects ?? []).map(o => o.classId)),
      ];
      const qualityPenalty = (valid ? r.issues : []).filter(x =>
        [
          "orientation_review",
          "low_resolution",
          "exposure",
          "low_detail",
        ].includes(x.type)
      ).length;
      const evidencePenalty = valid
        ? r.rights.filter(s => s.evidenceStatus !== "hash_verified").length
        : 2;
      return {
        key: i.key,
        id: i.sample.id,
        version: i.version,
        contentKind: i.contentKind,
        status: i.status,
        report: valid ? r : null,
        previousReport: r && !valid ? r : null,
        stale: !!r && !valid,
        blockers,
        classIds,
        eligibleSnapshot: i.contentKind === "real" && i.status === "approved",
        priority:
          blockers.length +
          (valid ? r.proposals.length : 0) * 0.05 +
          qualityPenalty +
          evidencePenalty +
          (classIds.some(id => [1, 2, 3, 5].includes(id)) ? 0 : 1),
        leakageGroup: i.sample.leakageGroup,
        split: i.sample.split ?? null,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  let related = null;
  const batchFiles = (await readdir(await w.safe(base)))
    .filter(f => /^batch-[a-zA-Z0-9T-]+\.json$/.test(f))
    .sort();
  if (batchFiles.length) {
    const batch = await w.json(`${base}/${batchFiles.at(-1)}`);
    related = {
      at: batch.at,
      pairs: batch.similarity?.pairs ?? [],
      note: "Cached navigation candidates only. Existing live scan and independent decision are required before release.",
    };
  }
  return {
    items,
    related,
    summary: {
      real: items.filter(i => i.contentKind === "real").length,
      synthetic: items.filter(i => i.contentKind === "synthetic").length,
      analyzed: items.filter(i => i.report).length,
      eligible: items.filter(i => i.eligibleSnapshot).length,
    },
    trainingEnabled: false,
  };
}
export async function draftPath(w, id) {
  const r = await getReport(w, id),
    item = await w.item(r.itemKey);
  check(current(r, item), "Analysis is stale");
  check(r.draft, "No proposed derivative");
  check(r.draft.path === `${base}/drafts/${id}.png`, "Invalid draft path");
  const path = await w.safe(r.draft.path);
  check((await fileHash(path)) === r.draft.sha256, "Draft SHA mismatch");
  return path;
}
export async function confirm(w, p, actor) {
  check(actor.roles.includes("annotator"), "Role not authorized");
  check(p.confirm === true, "Explicit preparer confirmation required");
  const r = await getReport(w, p.reportId),
    item = await w.item(r.itemKey);
  check(current(r, item) && p.version === item.version, "Analysis is stale");
  const audit = {
    reportId: r.id,
    reportSha256: await fileHash(await w.safe(`${base}/reports/${r.id}.json`)),
    producer: r.producer,
    confirmedBy: actor.id,
    proposalIds: [],
    privacyClearance: false,
  };
  if (p.action === "draft") {
    const path = await draftPath(w, r.id);
    return w.change(
      item.key,
      {
        action: "derivative",
        version: item.version,
        reason: p.reason,
        image: (await readFile(path)).toString("base64"),
      },
      actor,
      { proposalAudit: { ...audit, draftSha256: r.draft.sha256 } }
    );
  }
  check(
    p.action === "labels" &&
      Array.isArray(p.proposalIds) &&
      p.proposalIds.length <= 100 &&
      new Set(p.proposalIds).size === p.proposalIds.length,
    "Explicit proposal selection required"
  );
  const objects = structuredClone(item.sample.annotation?.objects ?? []),
    changed = new Set();
  const rejected = p.rejectedProposalIds ?? [];
  check(
    Array.isArray(rejected) &&
      rejected.length <= 100 &&
      new Set(rejected).size === rejected.length &&
      rejected.every(
        id => r.proposals.some(x => x.id === id) && !p.proposalIds.includes(id)
      ),
    "Invalid rejected proposal selection"
  );
  for (const id of p.proposalIds) {
    const proposal = r.proposals.find(x => x.id === id);
    check(proposal, "Unknown proposal");
    if (proposal.objectId) {
      check(
        !changed.has(proposal.objectId),
        "Choose only one proposal for each original object"
      );
      changed.add(proposal.objectId);
      const o = objects.find(o => o.id === proposal.objectId);
      check(o, "Original object missing");
      o.classId = proposal.classId;
      o.box = proposal.box;
    } else
      objects.push({
        id: randomUUID(),
        classId: proposal.classId,
        box: proposal.box,
        trackId: null,
        occluded: false,
        truncated: false,
        groundContact: "unknown",
      });
  }
  audit.proposalIds = p.proposalIds;
  audit.rejectedProposalIds = rejected;
  audit.deferredProposalIds = r.proposals
    .filter(x => !p.proposalIds.includes(x.id) && !rejected.includes(x.id))
    .map(x => x.id);
  return w.change(
    item.key,
    {
      action: "labels",
      version: item.version,
      reason: p.reason,
      objects,
      conditions: p.conditions ?? item.sample.conditions,
    },
    actor,
    { proposalAudit: audit }
  );
}
export async function shareable(w) {
  const b = await board(w),
    counts = {};
  const real = b.items.filter(i => i.contentKind === "real"),
    analyzed = real.filter(i => i.report);
  for (const i of analyzed)
    for (const issue of i.report.issues)
      counts[issue.type] = (counts[issue.type] ?? 0) + 1;
  return {
    schemaVersion: 1,
    scope: "local_machine_preparation_not_accuracy_evaluation",
    realImages: real.length,
    syntheticImages: b.summary.synthetic,
    realWithCurrentReport: analyzed.length,
    approved: real.filter(i => i.status === "approved").length,
    rejected: real.filter(i => i.status === "rejected").length,
    pending: real.filter(i => !["approved", "rejected"].includes(i.status))
      .length,
    correctionCandidateImages: analyzed.filter(i => i.report.proposals.length)
      .length,
    proposedPrivacyMaskImages: analyzed.filter(
      i => i.report.privacy.regions.length
    ).length,
    proposedDrafts: analyzed.filter(i => i.report.draft).length,
    missingSceneEvidence: analyzed.filter(
      i => i.report.conditions.scene.status === "needs_evidence"
    ).length,
    privacyToolCompleted: analyzed.filter(
      i => i.report.privacy.status === "completed"
    ).length,
    modelOrOCRFailures: analyzed.filter(i => i.report.modelFailures.length)
      .length,
    sourceEvidenceGaps: analyzed.filter(i =>
      i.report.rights.some(s => s.evidenceStatus !== "hash_verified")
    ).length,
    issueCounts: counts,
    automaticHumanApprovals: 0,
    trainingStarted: false,
    cloudUpload: false,
    limitations: [
      "Model candidates and heuristic masks are not verified labels or privacy clearance.",
      "Saved license evidence hashes do not establish commercial AI-training entitlement.",
      "Scene, session provenance and motion require evidence. No metric distances inferred.",
      "All actual final approvals require independent human decisions.",
    ],
  };
}
