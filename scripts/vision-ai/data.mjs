import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { readJson, writeJson, requireValue as check, nonempty, sha, finite, fileHash, jsonHash,
  checkedFile, localPath, validBox, taxonomyPath, hash } from './common.mjs';
import { proximityPolicy, validateSpatial, validateMotion } from './spatial.mjs';
import { validateStairsDirection } from './stairs-task.mjs';

export const splits = ['train', 'validation', 'test'];
const review = item => item?.status === 'approved' && nonempty(item.reviewer) &&
  nonempty(item.at) && Number.isFinite(Date.parse(item.at));

export async function validateSource(source, root, verifyFiles = true) {
  check(nonempty(source?.id) && ['basira_team', 'licensed_dataset'].includes(source.kind), 'only Basira team or licensed datasets allowed');
  check(nonempty(source.origin) && nonempty(source.license) && source.trainingAllowed === true &&
    source.containsUserData === false && review(source.rightsReview), `${source.id}: rights review required; user data forbidden`);
  check(nonempty(source.rightsReview.evidence?.path) && sha(source.rightsReview.evidence.sha256), 'rights evidence file and SHA-256 required');
  localPath(root, source.rightsReview.evidence.path);
  if (verifyFiles) await checkedFile(root, source.rightsReview.evidence.path, source.rightsReview.evidence.sha256);
}

/** Fails closed. Human attestations are checked for completeness, never certified as truthful. */
export async function validateDataset(data, root, { verifyFiles = true, requireSplit = true, allowSynthetic = false } = {}) {
  await (await import('./test-cohort.mjs')).guardFinalSplits(data,root);
  const taxonomy = await readJson(taxonomyPath);
  check(data?.schemaVersion === 1 && nonempty(data.id) && nonempty(data.annotationRevision), 'dataset identity/revision required');
  check(data.taxonomyVersion === taxonomy.version, 'taxonomy version mismatch');
  check(data.contentKind === 'real' || allowSynthetic && data.contentKind === 'synthetic', 'real approved data required; synthetic fixtures cannot train');
  const hasSynthetic = data.sources?.some(s => s.originKind === 'synthetic') ||
    data.samples?.some(s => s.originKind === 'synthetic' || s.generation);
  check(!hasSynthetic || data.contentKind === 'synthetic' && allowSynthetic,
    'synthetic provenance cannot enter real evaluation, training export or metric calibration');
  const spatialEnabled = data.spatialPolicyVersion !== undefined;
  if (spatialEnabled) check(data.spatialPolicyVersion === proximityPolicy.version, 'spatial policy version mismatch');
  else check(data.motionSegments === undefined && data.samples?.every(s => s.annotation?.objects?.every(o => o.spatial === undefined)),
    'spatial labels require explicit spatialPolicyVersion');
  check(Array.isArray(data.sources) && data.sources.length > 0, 'approved sources required');
  const sources = new Set();
  for (const source of data.sources) {
    check(!sources.has(source.id), 'duplicate source id'); sources.add(source.id);
    await validateSource(source, root, verifyFiles);
  }
  check(Array.isArray(data.samples) && data.samples.length > 0, 'no labeled training data available');
  const classes = new Map(taxonomy.classes.map(c => [c.id, c]));
  const ids = new Set(), paths = new Set(), hashes = new Set(), groupSplits = new Map(), videos = new Map(), tracks = new Map();
  const counts = Object.fromEntries(splits.map(s => [s, 0])), classCounts = {}, warnings = [];
  for (const s of data.samples) {
    check(nonempty(s.id) && !ids.has(s.id), 'duplicate/empty sample id'); ids.add(s.id);
    localPath(root, s.path);
    check(!paths.has(s.path.toLowerCase()) && sha(s.sha256) && !hashes.has(s.sha256), `${s.id}: duplicate path or image content`);
    paths.add(s.path.toLowerCase()); hashes.add(s.sha256);
    check(Number.isSafeInteger(s.width) && Number.isSafeInteger(s.height) && s.width > 0 && s.height > 0 &&
      s.width * s.height <= 100_000_000, `${s.id}: invalid dimensions`);
    check(sources.has(s.sourceId) && nonempty(s.leakageGroup), `${s.id}: source and site/session leakageGroup required`);
    check(splits.includes(s.split) || !requireSplit && s.split === null, `${s.id}: invalid split`);
    if (s.split) counts[s.split]++;
    const group = key => {
      if (groupSplits.has(key)) check(groupSplits.get(key) === s.split, `${s.id}: split leakage: ${key}`);
      groupSplits.set(key, s.split);
    };
    group(`group:${s.leakageGroup}`);
    check(['image', 'video_frame'].includes(s.media?.kind), `${s.id}: invalid media kind`);
    if (s.media.kind === 'video_frame') {
      const v = s.media.video;
      check(nonempty(v?.id) && sha(v.sha256) && finite(s.media.timestampMs) && s.media.timestampMs >= 0, `${s.id}: video identity/time required`);
      localPath(root, v.path);
      if (spatialEnabled) check(review(v.privacy) && v.privacy.metadataStripped === true &&
        ['absent', 'redacted'].includes(v.privacy.faces) && ['absent', 'redacted'].includes(v.privacy.plates) &&
        ['absent', 'redacted'].includes(v.privacy.personalText) && ['absent', 'redacted'].includes(v.privacy.voices),
        'phase-two original video privacy/audio review required');
      const prior = videos.get(v.id);
      if (prior) check(prior.sha256 === v.sha256 && prior.path === v.path, 'inconsistent video id');
      else { if (verifyFiles) await checkedFile(root, v.path, v.sha256); videos.set(v.id, v); }
      group(`video:${v.sha256}`);
      const frameKey = `${v.sha256}:${s.media.timestampMs}`;
      check(!paths.has(frameKey), 'duplicate video timestamp'); paths.add(frameKey);
    }
    check(review(s.privacy) && s.privacy.metadataStripped === true &&
      ['absent', 'redacted'].includes(s.privacy.faces) && ['absent', 'redacted'].includes(s.privacy.plates) &&
      ['absent', 'redacted'].includes(s.privacy.personalText), `${s.id}: privacy review/redaction required`);
    check(['daylight', 'indoor', 'low_light', 'mixed'].includes(s.conditions?.lighting) &&
      ['indoor', 'outdoor'].includes(s.conditions.scene) && ['static', 'moving'].includes(s.conditions.motion), `${s.id}: scene conditions required`);
    check(Array.isArray(s.hardNegatives) && s.hardNegatives.every(k => taxonomy.hardNegatives.includes(k)), `${s.id}: invalid hard negatives`);
    const a = s.annotation;
    check(a?.status === 'reviewed' && nonempty(a.annotator) && nonempty(a.reviewer) && a.annotator !== a.reviewer &&
      a.exhaustive === true && Array.isArray(a.objects) && Array.isArray(a.surfaces), `${s.id}: independent exhaustive annotation review required`);
    const objectIds = new Set(), frameTracks = new Set(), identicalBoxes = new Set();
    for (const o of a.objects) {
      validateStairsDirection(o);
      check(nonempty(o.id) && !objectIds.has(o.id), 'duplicate/empty object id'); objectIds.add(o.id);
      check(classes.has(o.classId) && classes.get(o.classId).kind !== 'surface' && validBox(o.box), `${s.id}: invalid class/box`);
      const boxKey = `${o.classId}:${o.box.join(',')}`;
      check(!identicalBoxes.has(boxKey), `${s.id}: duplicate annotation geometry`); identicalBoxes.add(boxKey);
      check(typeof o.occluded === 'boolean' && typeof o.truncated === 'boolean' &&
        ['yes', 'no', 'unknown'].includes(o.groundContact), `${s.id}: annotation attributes required`);
      if (s.media.kind === 'video_frame') {
        check(nonempty(o.trackId) && !frameTracks.has(o.trackId), `${s.id}: unique video track ID required`);
        frameTracks.add(o.trackId);
        const key = `${s.media.video.sha256}:${o.trackId}`;
        if (tracks.has(key)) check(tracks.get(key) === o.classId, `${s.id}: track class changed`);
        tracks.set(key, o.classId);
      } else check(o.trackId === null, 'still images must have null trackId');
      if (spatialEnabled) await validateSpatial(o.spatial, s, root, verifyFiles);
      const key = classes.get(o.classId).key;
      classCounts[key] ??= { train: 0, validation: 0, test: 0, unsplit: 0 };
      classCounts[key][s.split ?? 'unsplit']++;
      if (o.box[2] * s.width < 4 || o.box[3] * s.height < 4) warnings.push(`${s.id}/${o.id}: box thinner than 4 pixels; inspect label`);
    }
    for (const p of a.surfaces) {
      check(classes.get(p.classId)?.kind === 'surface' && Array.isArray(p.points) && p.points.length >= 3 &&
        p.points.every(point => Array.isArray(point) && point.length === 2 && point.every(v => finite(v) && v >= 0 && v <= 1)), 'invalid surface polygon');
      const area = p.points.reduce((n, [x, y], i) => { const q = p.points[(i + 1) % p.points.length]; return n + x * q[1] - q[0] * y; }, 0);
      check(Math.abs(area) > 1e-8, 'degenerate surface polygon');
    }
    if (verifyFiles) {
      const path = await checkedFile(root, s.path, s.sha256);
      const { default: sharp } = await import('sharp');
      const meta = await sharp(path, { limitInputPixels: 100_000_000 }).metadata();
      check(['jpeg', 'png', 'webp'].includes(meta.format) && meta.width === s.width && meta.height === s.height, `${s.id}: decoded dimensions/format mismatch`);
      check(!meta.exif && !meta.xmp && !meta.iptc && !meta.comments?.length && (meta.pages ?? 1) === 1, `${s.id}: strip metadata; single-frame media required`);
    }
  }
  if (spatialEnabled) await validateMotion(data, root, verifyFiles);
  if (requireSplit) {
    check(splits.every(k => counts[k] > 0), 'train/validation/test must all be nonempty');
    check(data.splitPolicy?.algorithm === 'sha256-group-order-v1' && Number.isSafeInteger(data.splitPolicy.seed), 'frozen split provenance required');
    for (const [key, value] of Object.entries(classCounts)) if (splits.some(k => !value[k])) warnings.push(`${key}: missing class coverage in one or more splits`);
  }
  return { schemaVersion: 1, datasetSha256: jsonHash(data), taxonomySha256: await fileHash(taxonomyPath), samples: ids.size,
    counts, classCounts, warnings, rightsAndPrivacy: 'operator attestations checked; human review still required' };
}

export function assignSplits(data, seed = 20261014) {
  check(Number.isSafeInteger(seed) && data.samples.every(s => s.split === null), 'seed must be integer; cannot re-split a frozen dataset');
  // Union groups sharing any video, even if an operator used different site/session names.
  const parents = new Map();
  const find = x => { if (!parents.has(x)) parents.set(x, x); if (parents.get(x) !== x) parents.set(x, find(parents.get(x))); return parents.get(x); };
  for (const s of data.samples) {
    const group = `group:${s.leakageGroup}`; find(group);
    if (s.media.kind === 'video_frame') parents.set(find(`video:${s.media.video.sha256}`), find(group));
  }
  const groups = new Map();
  for (const s of data.samples) { const k = find(`group:${s.leakageGroup}`); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s.id); }
  check(groups.size >= 3, 'at least three independent location/session groups required');
  const ordered = [...groups.values()].map(ids => ({ ids, rank: hash(`${seed}:${[...ids].sort().join('|')}`) })).sort((a, b) => a.rank.localeCompare(b.rank));
  const validationCount = Math.max(1, Math.round(ordered.length * .15));
  const testCount = Math.max(1, Math.round(ordered.length * .15));
  const assignments = new Map();
  ordered.forEach((g, i) => g.ids.forEach(id => assignments.set(id, i < testCount ? 'test' : i < testCount + validationCount ? 'validation' : 'train')));
  return { ...data, splitPolicy: { algorithm: 'sha256-group-order-v1', seed, targetGroupRatios: [.7, .15, .15],
    note: 'Grouped by location/session and video SHA. Ratios are group-based, not stratified; review coverage before freezing.' },
  samples: data.samples.map(s => ({ ...s, split: assignments.get(s.id) })) };
}

export async function exportCoco(data, root, output) {
  const report = await validateDataset(data, root);
  const taxonomy = await readJson(taxonomyPath), categories = taxonomy.classes.filter(c => c.kind !== 'surface').map(c => ({ id: c.id, name: c.key, supercategory: c.kind }));
  await mkdir(output); // refuse an existing export; preserves the locked test set
  const files = {};
  for (const split of splits) {
    const selected = data.samples.filter(s => s.split === split);
    let annotationId = 0;
    const value = { info: { datasetId: data.id, annotationRevision: data.annotationRevision, datasetSha256: report.datasetSha256,
      taxonomySha256: report.taxonomySha256, contentKind: data.contentKind, split }, categories,
    images: selected.map((s, i) => ({ id: i + 1, sample_id: s.id, file_name: s.path, width: s.width, height: s.height, sha256: s.sha256 })),
    annotations: selected.flatMap((s, i) => s.annotation.objects.map(o => ({ id: ++annotationId, image_id: i + 1, category_id: o.classId,
      bbox: [o.box[0] * s.width, o.box[1] * s.height, o.box[2] * s.width, o.box[3] * s.height],
      area: o.box[2] * s.width * o.box[3] * s.height, iscrowd: 0, track_id: o.trackId,
      ...(o.spatial ? { basira_spatial: o.spatial } : {}) }))) };
    await writeJson(resolve(output, `${split}.json`), value); files[`${split}.json`] = await fileHash(resolve(output, `${split}.json`));
  }
  await writeJson(resolve(output, 'dataset.lock.json'), { schemaVersion: 1, ...report, files, dataset: data });
  return report;
}

export async function prepareDraft(inventory, root) {
  check(inventory?.schemaVersion === 1 && nonempty(inventory.id) && Array.isArray(inventory.samples), 'inventory requires id and samples');
  const taxonomy = await readJson(taxonomyPath), { default: sharp } = await import('sharp');
  const samples = [];
  for (const item of inventory.samples) {
    const path = localPath(root, item.path), digest = await fileHash(path);
    await checkedFile(root, item.path, digest);
    const meta = await sharp(path).metadata();
    samples.push({ ...item, sha256: digest, width: meta.width, height: meta.height, split: null,
      privacy: { status: 'pending', reviewer: '', at: '', faces: 'unreviewed', plates: 'unreviewed', personalText: 'unreviewed', metadataStripped: false },
      annotation: { status: 'pending', annotator: '', reviewer: '', exhaustive: false, objects: [], surfaces: [] } });
  }
  return { schemaVersion: 1, id: inventory.id, annotationRevision: 'draft-1', contentKind: 'real', taxonomyVersion: taxonomy.version,
    sources: inventory.sources ?? [], samples };
}

/** Import from CVAT/Label Studio COCO exports using exact taxonomy names; never grants review approval. */
export function importCoco(data, coco, taxonomy) {
  const classes = new Map(taxonomy.classes.filter(c => c.kind !== 'surface').map(c => [c.key, c.id]));
  check(Array.isArray(coco.images) && Array.isArray(coco.categories) && Array.isArray(coco.annotations), 'invalid COCO document');
  const categories = new Map(), images = new Map(), byPath = new Map();
  for (const c of coco.categories) { check(classes.has(c.name) && !categories.has(c.id), 'unknown/duplicate COCO category'); categories.set(c.id, classes.get(c.name)); }
  for (const i of coco.images) { check(!images.has(i.id) && !byPath.has(i.file_name), 'duplicate COCO image'); images.set(i.id, i); byPath.set(i.file_name, i); }
  check(coco.images.length === data.samples.length && data.samples.every(s => byPath.has(s.path)), 'COCO must cover every manifest image exactly');
  const ids = new Set();
  for (const a of coco.annotations) { check(!ids.has(a.id) && images.has(a.image_id) && categories.has(a.category_id) &&
    (!a.iscrowd) && !a.ignore, 'invalid annotation; crowd/ignore unsupported by local evaluator'); ids.add(a.id); }
  return { ...data, annotationRevision: `${data.annotationRevision}-import`, samples: data.samples.map(s => {
    const i = byPath.get(s.path); check(i.width === s.width && i.height === s.height, 'COCO dimensions differ');
    const objects = coco.annotations.filter(a => a.image_id === i.id).map(a => {
      check(Array.isArray(a.bbox) && a.bbox.length === 4, 'missing COCO box');
      const box = a.bbox.map((v, j) => v / (j % 2 ? s.height : s.width)); check(validBox(box), 'invalid COCO box');
      return { id: String(a.id), classId: categories.get(a.category_id), box, trackId: a.track_id == null ? null : String(a.track_id),
        occluded: false, truncated: false, groundContact: 'unknown', ...(a.basira_spatial ? { spatial: a.basira_spatial } : {}) };
    });
    return { ...s, annotation: { ...s.annotation, status: 'pending', reviewer: '', exhaustive: false, objects } };
  }) };
}

export async function loadValidated(path, options) {
  const data = await readJson(path); const report = await validateDataset(data, dirname(resolve(path)), options); return { data, report };
}
