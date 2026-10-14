/** Offline suggestions only. A model score, heuristic or matching hash never grants approval. */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, fileHash, validBox, requireValue as check } from "../common.mjs";
import { dataNeeds } from "../data-needs.mjs";
import { bundleDraft } from "../storage.mjs";
import { prepareDraft } from "../data.mjs";

export const assistantVersion = "basira-local-review-1";
export const rightsBlocked = i =>
  i.decisions?.rights?.status === "rejected" ||
  i.sources.some(s => s.rightsReview?.status === "rejected");
const issue = (type, action, confidence = null, details = {}) => ({
  id: hash(type + JSON.stringify(details)).slice(0, 24),
  type,
  action,
  confidence,
  confidenceKind:
    confidence === null ? "not_estimated" : "heuristic_not_calibrated",
  ...details,
  approval: "human_required",
});
async function folders(w) {
  await w.ensure(".studio/assistant");
  for (const dir of ["reports", "fingerprints", "pairs", "packets"])
    await w.ensure(".studio/assistant/" + dir);
}
async function append(w, folder, value) {
  await folders(w);
  const path = `.studio/assistant/${folder}/${randomUUID()}.json`;
  await writeFile(
    await w.safe(path, true),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx", mode: 0o600 }
  );
  return path;
}

export async function fingerprint(w, item, original = false) {
  const path = await w.mediaPath(item, original),
    sha = await fileHash(path);
  check(
    sha ===
      (original
        ? item.sample.sha256
        : (item.activeSha256 ?? item.sample.sha256)),
    "Media SHA-256 mismatch"
  );
  await folders(w);
  const cache = `.studio/assistant/fingerprints/${sha}.json`;
  try {
    const f = await w.json(cache);
    check(
      f.version === assistantVersion && f.sha256 === sha,
      "Invalid fingerprint cache"
    );
    return f;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const image = sharp(path, { limitInputPixels: 100_000_000 }),
    meta = await image.metadata();
  const { data, info } = await image
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelSha256 = hash(
    Buffer.concat([
      Buffer.from(`${info.width}:${info.height}:${info.channels}:`),
      data,
    ])
  );
  const small = await image
    .clone()
    .flatten({ background: "#fff" })
    .greyscale()
    .resize(128, 128, { fit: "fill" })
    .raw()
    .toBuffer();
  let sum = 0,
    lap = 0,
    lap2 = 0,
    n = 0;
  const hist = Array(16).fill(0);
  for (const v of small) {
    sum += v;
    hist[Math.min(15, Math.floor(v / 16))]++;
  }
  for (let y = 1; y < 127; y++)
    for (let x = 1; x < 127; x++) {
      const p = y * 128 + x,
        l =
          4 * small[p] -
          small[p - 1] -
          small[p + 1] -
          small[p - 128] -
          small[p + 128];
      lap += l;
      lap2 += l * l;
      n++;
    }
  const dh = await image
    .clone()
    .flatten({ background: "#fff" })
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits += dh[y * 9 + x] > dh[y * 9 + x + 1] ? "1" : "0";
  const f = {
    version: assistantVersion,
    sha256: sha,
    pixelSha256,
    width: meta.width,
    height: meta.height,
    aspect: meta.width / meta.height,
    orientation: meta.orientation ?? 1,
    dHash: bits,
    histogram: hist.map(v => v / small.length),
    brightness: sum / small.length,
    detailVariance: lap2 / n - (lap / n) ** 2,
    metadataPresent: !!(
      meta.exif ||
      meta.xmp ||
      meta.iptc ||
      meta.comments?.length
    ),
    exifPresent: !!meta.exif,
    xmpPresent: !!meta.xmp,
  };
  try {
    await writeFile(await w.safe(cache, true), JSON.stringify(f), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return f;
}
export function similarity(a, b) {
  if (a.sha256 === b.sha256 || a.pixelSha256 === b.pixelSha256)
    return { kind: "exact", score: 1, hamming: 0 };
  const hamming = [...a.dHash].filter((v, i) => v !== b.dHash[i]).length;
  const histogramDistance =
    a.histogram.reduce((n, v, i) => n + Math.abs(v - b.histogram[i]), 0) / 2;
  const aspectDelta = Math.abs(Math.log(a.aspect / b.aspect));
  if (hamming <= 6 && histogramDistance <= 0.12 && aspectDelta < 0.05)
    return {
      kind: "similar_candidate",
      score: 1 - hamming / 64,
      hamming,
      histogramDistance,
    };
  return null;
}
async function decisions(w) {
  await folders(w);
  const { readdir } = await import("node:fs/promises");
  const result = new Map();
  for (const name of (
    await readdir(await w.safe(".studio/assistant/pairs"))
  ).sort()) {
    const d = await w.json(".studio/assistant/pairs/" + name);
    const prev = result.get(d.id);
    if (!prev || d.at > prev.at) result.set(d.id, d);
  }
  return result;
}
export async function scan(w) {
  const c = await w.catalog();
  check(
    c.issues.length === 0,
    "Catalog errors block complete similarity verification"
  );
  check(
    c.items.length <= 1000,
    "Similarity scan limit is 1000 indexed samples; no release is allowed on a partial scan"
  );
  const samples = [];
  for (const i of c.items) {
    const fingerprints = [await fingerprint(w, i, true)];
    if (i.activeSha256 && i.activeSha256 !== i.sample.sha256)
      fingerprints.push(await fingerprint(w, i));
    samples.push({ item: i, fingerprints });
  }
  const saved = await decisions(w),
    pairs = [];
  for (let a = 0; a < samples.length; a++)
    for (let b = a + 1; b < samples.length; b++) {
      const x = samples[a],
        y = samples[b];
      let match = null;
      for (const xf of x.fingerprints)
        for (const yf of y.fingerprints) {
          const candidate = similarity(xf, yf);
          if (
            candidate &&
            (!match ||
              candidate.kind === "exact" ||
              candidate.score > match.score)
          )
            match = candidate;
        }
      if (!match) continue;
      const id = hash(
        [
          `${x.item.key}:${x.fingerprints.map(f => f.sha256).join(":")}`,
          `${y.item.key}:${y.fingerprints.map(f => f.sha256).join(":")}`,
        ]
          .sort()
          .join("|")
      );
      const decision = saved.get(id);
      pairs.push({
        id,
        a: x.item.key,
        b: y.item.key,
        aSha256: x.fingerprints[0].sha256,
        bSha256: y.fingerprints[0].sha256,
        ...match,
        decision: decision ?? null,
        crossSplit: !!(
          x.item.sample.split &&
          y.item.sample.split &&
          x.item.sample.split !== y.item.sample.split
        ),
        requiresReview: match.kind !== "exact" && !decision,
      });
    }
  return {
    version: assistantVersion,
    complete: true,
    indexed: samples.length,
    pairs,
    thresholds: {
      dHashMaxHamming: 6,
      histogramMaxDistance: 0.12,
      aspectLogDelta: 0.05,
    },
    limitation:
      "Perceptual similarity is a candidate, not proof. Crops, flips, occlusion and other variants may be missed. Exact decoded pixels include dimensions.",
    trainingPerformed: false,
  };
}
export async function reviewPair(w, p, actor) {
  check(actor.roles.includes("labels"), "Independent reviewer role required");
  check(
    ["same", "different"].includes(p.relation) && p.reason?.trim().length >= 3,
    "Similarity decision and reason required"
  );
  const c = await w.catalog(),
    s = await scan(w),
    pair = s.pairs.find(i => i.id === p.id);
  check(pair, "Similarity pair changed; scan again");
  check(
    pair.kind !== "exact" || p.relation === "same",
    "Exact copies cannot be dismissed"
  );
  for (const key of [pair.a, pair.b]) {
    const i = c.items.find(i => i.key === key);
    check(
      i.sample.annotation?.annotator &&
        !(await w.contributors(i)).has(actor.id),
      "Independent reviewer must differ from contributor"
    );
  }
  const record = {
    ...pair,
    decision: undefined,
    relation: p.relation,
    actor: actor.id,
    reason: p.reason,
    at: new Date().toISOString(),
    automaticApproval: false,
  };
  await append(w, "pairs", record);
  return record;
}
export async function releaseGroups(w, selected) {
  const c = await w.catalog(),
    s = await scan(w),
    wanted = new Set(selected.map(i => i.key));
  const parents = new Map(c.items.map(i => [i.key, i.key]));
  const find = k => {
    const p = parents.get(k);
    if (p !== k) parents.set(k, find(p));
    return parents.get(k);
  };
  const declared = new Map();
  for (const i of c.items)
    for (const name of [
      "group:" + i.sample.leakageGroup,
      ...(i.sample.media?.video
        ? ["video:" + i.sample.media.video.sha256]
        : []),
    ]) {
      if (declared.has(name))
        parents.set(find(i.key), find(declared.get(name)));
      else declared.set(name, i.key);
    }
  for (const p of s.pairs) {
    if (p.kind !== "exact" && p.decision?.relation === "different") continue;
    if (p.requiresReview) continue;
    parents.set(find(p.a), find(p.b));
  }
  const selectedComponents = new Set(selected.map(i => find(i.key)));
  for (const p of s.pairs)
    if (
      p.requiresReview &&
      (selectedComponents.has(find(p.a)) || selectedComponents.has(find(p.b)))
    )
      throw new Error(
        "Unresolved similar images block release; independent review required"
      );
  const groups = new Map();
  for (const i of c.items) {
    const k = find(i.key);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i.key);
  }
  const result = new Map();
  for (const keys of groups.values())
    if (keys.some(k => wanted.has(k))) {
      const members = keys.map(k => c.items.find(i => i.key === k)),
        locked = new Set(members.map(i => i.sample.split).filter(Boolean));
      check(
        locked.size <= 1,
        "Duplicate/similar content crosses frozen splits; never move test images to training"
      );
      check(
        !locked.size ||
          !members.some(i => wanted.has(i.key) && i.sample.split == null),
        "Unassigned copy of held-out data cannot be released"
      );
      if (keys.length > 1) {
        const group = "similarity-" + hash(keys.sort().join("|")).slice(0, 24);
        for (const k of keys) result.set(k, group);
      }
    }
  return result;
}
export async function analyze(w, key, actor) {
  const i = await w.item(key),
    f = await fingerprint(w, i),
    issues = [];
  if (rightsBlocked(i))
    issues.push(
      issue(
        "rights_rejected",
        "استبعد هذه الصورة؛ ابحث عن مصدر مستقل مرخص أو مثال اصطناعي جديد. لا تنقحها لتجاوز الحقوق.",
        1
      )
    );
  if (f.metadataPresent)
    issues.push(
      issue(
        "metadata_privacy",
        "جهز نسخة مستقلة خالية من البيانات الوصفية ثم راجع الخصوصية.",
        1
      )
    );
  if (f.orientation !== 1)
    issues.push(
      issue(
        "orientation_review",
        "صحح اتجاه الصورة في نسخة مستقلة قبل اقتراح المربعات أو التنقيح؛ احتفظ بالأصل.",
        1
      )
    );
  if (Math.min(f.width, f.height) < 320)
    issues.push(
      issue(
        "low_resolution",
        "اجمع نسخة أصلية أعلى دقة أو وثق حدود استخدامها.",
        1,
        { metric: { width: f.width, height: f.height } }
      )
    );
  if (f.brightness < 35 || f.brightness > 225)
    issues.push(
      issue(
        "exposure",
        "راجع الإضاءة؛ المتوسط وحده لا يثبت جودة الصورة.",
        0.7,
        { metric: { brightness: f.brightness } }
      )
    );
  if (f.detailVariance < 20)
    issues.push(
      issue(
        "low_detail",
        "راجع احتمال الطمس أو المشهد قليل التفاصيل؛ لا ترفض الصورة آليًا.",
        0.6,
        { metric: { detailVariance: f.detailVariance } }
      )
    );
  if (!i.sample.annotation?.exhaustive)
    issues.push(
      issue(
        "incomplete_labels",
        "راجع كل الأجسام والسلبيات؛ غياب وسم لا يعني غياب الجسم.",
        null
      )
    );
  for (const o of i.sample.annotation?.objects ?? []) {
    if (!validBox(o.box))
      issues.push(
        issue("invalid_box", "صحح حدود الجسم.", 1, { objectId: o.id })
      );
    if ([1, 5, 6, 7, 8].includes(o.classId))
      issues.push(
        issue(
          "privacy_region_review",
          "وجود شخص أو مركبة يتطلب مراجعة الوجه/اللوحة. لم تُحدد منطقة حساسة تلقائيًا.",
          null,
          { objectId: o.id }
        )
      );
  }
  const report = {
    version: assistantVersion,
    id: randomUUID(),
    itemKey: key,
    imageSha256: f.sha256,
    itemVersion: i.version,
    baseHash: i.baseHash,
    actor: actor.id,
    at: new Date().toISOString(),
    scope: "local-quality-and-label-consistency",
    issues,
    proposals: [],
    redactionRegions: [],
    capabilities: {
      quality: "heuristics",
      objectDetection: "available-on-explicit-local-run",
      ocr: "available-on-explicit-local-run",
      faceDetector: "not-configured",
      plateDetector: "not-configured",
      cloudAnalysis: "disabled",
    },
    humanApproval: false,
    trainingPerformed: false,
  };
  const path = await append(w, "reports", report);
  return { ...report, path };
}
export function compareLabels(objects, detections) {
  const issues = [],
    proposals = [];
  const iou = (a, b) => {
    const area =
      Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
      Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    return area / (a[2] * a[3] + b[2] * b[3] - area);
  };
  for (const d of detections) {
    let best = null,
      overlap = 0;
    for (const o of objects) {
      const v = iou(o.box, d.box);
      if (v > overlap) {
        best = o;
        overlap = v;
      }
    }
    const type =
      overlap < 0.3
        ? "unlabeled_candidate"
        : best?.classId !== d.classId
          ? "class_disagreement"
          : overlap < 0.8
            ? "box_disagreement"
            : null;
    if (type) {
      const proposal = {
        id: randomUUID(),
        type,
        objectId: overlap < 0.3 ? null : best.id,
        classId: d.classId,
        box: d.box,
        confidence: d.score,
        confidenceKind: "model_score_not_calibrated",
        source: "existing-efficientdet-lite0",
        status: "proposed",
      };
      proposals.push(proposal);
      issues.push({
        ...issue(
          type,
          "راجع اقتراح النموذج مقارنة بالصورة والوسم الأصلي.",
          d.score,
          { proposalId: proposal.id }
        ),
        confidenceKind: proposal.confidenceKind,
      });
    }
  }
  return { issues, proposals };
}
export async function saveModelReport(w, p, actor, modelManifest) {
  const i = await w.item(p.key);
  check(
    (await fingerprint(w, i)).orientation === 1,
    "Normalize orientation in a reviewed derivative before model proposals"
  );
  check(
    i.version === p.version &&
      p.imageSha256 === (i.activeSha256 ?? i.sample.sha256),
    "Analysis is stale"
  );
  check(
    Array.isArray(p.detections) &&
      p.detections.length <= 100 &&
      Array.isArray(p.text) &&
      p.text.length <= 1000 &&
      (p.failures == null ||
        (Array.isArray(p.failures) &&
          p.failures.length <= 4 &&
          p.failures.every(f => f && typeof f === "object"))),
    "Bounded model outputs required"
  );
  for (const d of p.detections)
    check(
      w.taxonomy.classes.some(
        c => c.id === d.classId && c.baselineLabels.length
      ) &&
        validBox(d.box) &&
        Number.isFinite(d.score) &&
        d.score >= 0 &&
        d.score <= 1,
      "Invalid detector output"
    );
  const comparison = compareLabels(
      i.sample.annotation?.objects ?? [],
      p.detections
    ),
    regions = [];
  for (const t of p.text) {
    check(
      typeof t.text === "string" &&
        t.text.length <= 160 &&
        validBox(t.box) &&
        Number.isFinite(t.score) &&
        t.score >= 0 &&
        t.score <= 1,
      "Invalid OCR output"
    );
    if (
      /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s()-]{6,}\d)|(?:هوية|جواز|رقم حساب|عنوان شخصي))/i.test(
        t.text
      )
    ) {
      regions.push({
        box: t.box,
        reason: "potential_sensitive_text",
        confidence: t.score,
      });
      comparison.issues.push({
        ...issue(
          "sensitive_text_candidate",
          "راجع النص واقترح تغطيته في نسخة مستقلة.",
          t.score,
          { box: t.box }
        ),
        confidenceKind: "ocr_score_not_calibrated",
      });
    }
  }
  const report = {
    version: assistantVersion,
    id: randomUUID(),
    itemKey: i.key,
    imageSha256: p.imageSha256,
    itemVersion: i.version,
    baseHash: i.baseHash,
    at: new Date().toISOString(),
    actor: actor.id,
    scope: "local-model-proposals",
    ...comparison,
    redactionRegions: regions,
    models: modelManifest,
    modelFailures: (p.failures ?? []).slice(0, 4).map(f => ({
      capability: ["objectDetector", "ocr"].includes(f.capability)
        ? f.capability
        : "unknown",
      error: String(f.error ?? "Unknown failure").slice(0, 300),
    })),
    humanApproval: false,
    trainingPerformed: false,
    attestation:
      "Browser-supplied model outputs are suggestions, not authenticated inference or ground truth. No reviewer identity or approval is accepted from the browser.",
  };
  const path = await append(w, "reports", report);
  return { ...report, path };
}
export async function reports(w, key) {
  await folders(w);
  const { readdir } = await import("node:fs/promises");
  const all = [];
  for (const f of await readdir(await w.safe(".studio/assistant/reports"))) {
    const r = await w.json(".studio/assistant/reports/" + f);
    if (!key || r.itemKey === key) all.push(r);
  }
  return all.sort((a, b) => b.at.localeCompare(a.at));
}
export async function redact(w, key, p, actor) {
  const i = await w.item(key);
  check(!rightsBlocked(i), "Rights rejected: derivatives cannot bypass rights");
  check(actor.roles.includes("annotator"), "Role not authorized");
  check(
    Array.isArray(p.regions) &&
      p.regions.length > 0 &&
      p.regions.length <= 100 &&
      p.regions.every(validBox),
    "Explicit valid redaction regions required"
  );
  check(
    p.confirm === true &&
      p.reason?.trim().length >= 3 &&
      p.version === i.version,
    "Human redaction confirmation, reason and current version required"
  );
  const source = await w.mediaPath(i),
    before = await fileHash(source);
  check(before === (i.activeSha256 ?? i.sample.sha256), "Media SHA mismatch");
  const meta = await sharp(source).metadata();
  check(
    !meta.orientation || meta.orientation === 1,
    "Normalize orientation in a separately reviewed derivative before redaction"
  );
  const rectangles = p.regions
    .map(
      ([x, y, width, height]) =>
        `<rect x="${Math.floor(x * meta.width)}" y="${Math.floor(y * meta.height)}" width="${Math.ceil(width * meta.width) + 1}" height="${Math.ceil(height * meta.height) + 1}" fill="black"/>`
    )
    .join("");
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${rectangles}</svg>`
  );
  const bytes = await sharp(source)
    .composite([{ input: mask }])
    .png()
    .toBuffer();
  const result = await w.change(
    key,
    {
      action: "derivative",
      version: p.version,
      reason: p.reason,
      image: bytes.toString("base64"),
      assistantAudit: {
        method: "solid-mask",
        regions: p.regions,
        inputSha256: before,
        reportIds: p.reportIds ?? [],
      },
    },
    actor
  );
  check((await fileHash(source)) === before, "Original changed");
  return result;
}
export async function needsPacket(w, actor) {
  const c = await w.catalog(),
    needs = await dataNeeds();
  const scanResult = await scan(w);
  const r = await reports(w);
  const packet = {
    schemaVersion: 1,
    kind: "chatgpt-review-packet-without-media",
    at: new Date().toISOString(),
    createdByRole: "local-operator",
    planning: needs,
    inventory: {
      real: c.items.filter(i => i.contentKind === "real").length,
      synthetic: c.items.filter(i => i.contentKind === "synthetic").length,
    },
    classCounts: c.summary.classCounts,
    similarity: {
      pairs: scanResult.pairs.length,
      unresolved: scanResult.pairs.filter(p => p.requiresReview).length,
      crossSplit: scanResult.pairs.filter(p => p.crossSplit).length,
    },
    reports: r.map(x => ({
      localReference: x.id,
      issues: x.issues.map(({ type, action, confidence, confidenceKind }) => ({
        type,
        action,
        confidence,
        confidenceKind,
      })),
      proposalClassIds: x.proposals.map(p => p.classId),
    })),
    suggestedSyntheticExamples: needs.classes
      .filter(c => c.kind !== "surface")
      .map(c => ({
        classId: c.classId,
        prompt: `Create a new generic ${c.key} scene with ${c.examples}. No personal identity, readable private text, source-photo imitation or metric-distance claim.`,
        approval: "rights-privacy-label-review-required",
        evaluationUse: "forbidden",
      })),
    instructions:
      "ChatGPT may prioritize data needs and suggest experiments. It cannot approve rights/privacy/labels. This packet excludes images, filenames, sources, OCR text, actors and metric evidence. Inspect before sharing; class counts may still be sensitive.",
    cloudUploadPerformed: false,
  };
  const path = await append(w, "packets", {
    ...packet,
    localAudit: { actor: actor.id },
  });
  return { packet, path };
}
export async function importSynthetic(w, p, actor) {
  check(actor.roles.includes("annotator"), "Role not authorized");
  for (const field of [
    "generator",
    "model",
    "prompt",
    "generatedAt",
    "origin",
    "license",
    "rightsText",
  ])
    check(
      typeof p[field] === "string" &&
        p[field].trim().length > 0 &&
        p[field].length < 20000,
      "Generation provenance and rights evidence required"
    );
  check(
    Number.isFinite(Date.parse(p.generatedAt)) &&
      p.independentCreation === true &&
      p.noUserData === true,
    "Independent synthetic creation declaration required"
  );
  check(
    p.settings &&
      typeof p.settings === "object" &&
      !Array.isArray(p.settings) &&
      JSON.stringify(p.settings).length < 10000 &&
      !/api.?key|password|token|secret|authorization/i.test(
        JSON.stringify(p.settings)
      ),
    "Non-secret generation settings required"
  );
  check(
    typeof p.image === "string" && p.image.length < 24_000_000,
    "Image upload limit exceeded"
  );
  const bytes = Buffer.from(p.image, "base64");
  const meta = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
  check(
    ["png", "jpeg", "webp"].includes(meta.format) &&
      (meta.pages ?? 1) === 1 &&
      (!meta.orientation || meta.orientation === 1),
    "Single-frame synthetic image with known orientation required"
  );
  const decoded = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelHash = hash(
    Buffer.concat([
      Buffer.from(
        `${decoded.info.width}:${decoded.info.height}:${decoded.info.channels}:`
      ),
      decoded.data,
    ])
  );
  for (const i of (await w.catalog()).items)
    if (rightsBlocked(i)) {
      const f = await fingerprint(w, i, true);
      check(
        f.sha256 !== hash(bytes) && f.pixelSha256 !== pixelHash,
        "Rejected original cannot be relabeled as synthetic"
      );
    }
  const id = "synthetic-" + randomUUID(),
    prefix = "incoming/" + id;
  await w.ensure("incoming");
  await w.ensure(prefix);
  for (const name of ["images", "rights"]) await w.ensure(prefix + "/" + name);
  const imagePath = `images/original.${meta.format === "jpeg" ? "jpg" : meta.format}`;
  await writeFile(await w.safe(prefix + "/" + imagePath, true), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  const generation = {
    generator: p.generator,
    model: p.model,
    prompt: p.prompt,
    settings: p.settings,
    seed: p.seed ?? null,
    generatedAt: p.generatedAt,
    origin: p.origin,
    license: p.license,
    rightsText: p.rightsText,
    independentCreation: true,
    uploadedBy: actor.id,
    at: new Date().toISOString(),
    rightsReview: "pending",
    contentKind: "synthetic",
  };
  await writeFile(
    await w.safe(prefix + "/rights/generation.json", true),
    JSON.stringify(generation, null, 2),
    { flag: "wx", mode: 0o600 }
  );
  const inventory = {
    schemaVersion: 1,
    id,
    contentKind: "synthetic",
    containsUserData: false,
    sources: [
      {
        id: "generation",
        kind: "licensed_dataset",
        origin: p.origin,
        originKind: "synthetic",
        license: p.license,
        trainingAllowed: false,
        containsUserData: false,
        rightsReview: {
          status: "pending",
          reviewer: "",
          at: "",
          evidence: { path: "rights/generation.json", sha256: "" },
        },
      },
    ],
    files: [
      {
        path: imagePath,
        kind: "image",
        sourceId: "generation",
        originalId: id,
        origin: p.origin,
      },
      {
        path: "rights/generation.json",
        kind: "rights",
        sourceId: "generation",
        originalId: id + "-rights",
        origin: p.origin,
      },
    ],
    samples: [
      {
        id,
        path: imagePath,
        sourceId: "generation",
        originKind: "synthetic",
        generation,
        leakageGroup: id,
        split: null,
        media: { kind: "image" },
        conditions: {
          lighting: "unreviewed",
          scene: "unreviewed",
          motion: "unreviewed",
        },
        hardNegatives: [],
      },
    ],
  };
  const root = resolve(w.root, prefix),
    bundle = await bundleDraft(inventory, root);
  await writeFile(
    await w.safe(prefix + "/bundle.pending.json", true),
    JSON.stringify(bundle, null, 2),
    { flag: "wx", mode: 0o600 }
  );
  const draft = {
    ...(await prepareDraft(bundle, root)),
    contentKind: "synthetic",
  };
  await writeFile(
    await w.safe(prefix + "/dataset.review.pending.json", true),
    JSON.stringify(draft, null, 2),
    { flag: "wx", mode: 0o600 }
  );
  return {
    id,
    contentKind: "synthetic",
    status:
      "PENDING_HUMAN_REVIEW_NOT_ELIGIBLE_FOR_REAL_EVALUATION_OR_METRIC_CALIBRATION",
    trainingStarted: false,
  };
}
