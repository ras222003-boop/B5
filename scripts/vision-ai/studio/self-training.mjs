/** Private research runs. Nothing here writes Studio review decisions or official approvals. */
import { randomUUID } from 'node:crypto';
import { writeFile, realpath, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileHash, validBox, requireValue as check, repo } from '../common.mjs';
import { assertNotFinalTest, finalCohort, markDevelopment } from '../test-cohort.mjs';
import { fingerprint, releaseGroups } from './assistant.mjs';
import { stairsTruth } from '../stairs-task.mjs';

const base = '.studio/self-training';
const stairClasses = new Set([2301, 2302, 2303]);
const blockedUse = new Set(['independent_test_candidate', 'test']);
const now = () => new Date().toISOString();

export function assertResearchRights(item) {
  check(!item.conflict && item.sample.media?.kind === 'image', 'Only unchanged indexed images are eligible');
  check(!blockedUse.has(item.sample.intendedUse) && item.sample.split !== 'test', 'Protected test image');
  check(item.contentKind === 'real', 'Research training requires real images with verified rights');
  check(item.sources.length > 0 && item.sources.every(s =>
    s.trainingAllowed === true && s.containsUserData === false &&
    typeof s.license === 'string' && s.license.length > 0 &&
    s.rightsReview?.status === 'approved' && s.rightsReview?.reviewer &&
    s.rightsReview?.evidence?.sha256
  ), 'Image training rights are not approved for this scope');
  check(item.sample.privacy?.status === 'approved' && item.sample.privacy?.metadataStripped === true,
    'Privacy approval and metadata-free active image required');
}

export class SelfTraining {
  constructor(w) { this.w = w; this.job = null; this.child = null; this.timer = null; this.persistQueue = Promise.resolve(); }
  async init() {
    await this.w.ensure(base);
    const files = (await readdir(await this.w.safe(base))).filter(x => /^[a-f0-9-]{36}-\d{6}\.json$/.test(x));
    const prior = [];
    for (const file of files) {
      try { const record = await this.w.json(`${base}/${file}`); if (record.id) prior.push(record); }
      catch { /* An incomplete write is never treated as a valid result. */ }
    }
    this.job = prior.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.revision - a.revision)[0] ?? null;
    if (this.job && ['analyzing', 'training', 'exporting'].includes(this.job.status)) {
      this.job.status = 'stopped';
      this.job.reason = 'Studio restarted before completion; inspect partial private artifacts.';
      await this.log('restart', this.job.reason);
    }
    return this;
  }
  public() {
    const j = this.job;
    if (!j) return { status: 'idle' };
    const { token, ...result } = j;
    return structuredClone(result);
  }
  async persist() {
    if (!this.job) return;
    this.job.revision = (this.job.revision ?? 0) + 1;
    const { token, ...record } = this.job;
    const serialized = JSON.stringify(record, null, 2) + '\n';
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      const path = `${base}/${record.id}-${String(record.revision).padStart(6, '0')}.json`;
      await writeFile(await this.w.safe(path, true), serialized, { flag: 'wx', mode: 0o600 });
    });
    await this.persistQueue;
  }
  async log(stage, message) {
    if (!this.job) return;
    this.job.events.push({ at: now(), stage, message: String(message).slice(0, 500) });
    this.job.updatedAt = now();
    await this.persist();
  }
  async eligible(item) {
    assertResearchRights(item);
    await assertNotFinalTest(this.w.root, item);
    const evidence = await this.w.sourceEvidence(item);
    check(evidence.every(x => x.sha256), 'Rights evidence unavailable');
    const image = await this.w.mediaPath(item);
    const sha = item.activeSha256 ?? item.sample.sha256;
    check(await fileHash(image) === sha, 'Image SHA-256 mismatch');
    check(item.sample.width * item.sample.height <= 2_000_000, 'Research CPU image limit is two megapixels');
    const f = await fingerprint(this.w, item);
    check(f.orientation === 1 && !f.metadataPresent, 'Correct orientation and strip image metadata first');
    check(f.width * f.height <= 2_000_000, 'Research CPU image limit is two megapixels');
    const reference = item.sample.annotation?.status === 'reviewed' && item.sample.annotation?.exhaustive
      ? stairsTruth(item.sample).map(o => ({ classId: o.classId, box: o.box,
        source: 'existing_human_review', evidence: o.stairsDirection.evidence })) : [];
    return { key: item.key, version: item.version, baseHash: item.baseHash,
      sha256: sha, leakageGroup: item.sample.leakageGroup, path: image,
      width: f.width, height: f.height, sourceEvidence: evidence.map(e => e.sha256), reference };
  }
  async start(p, actor, capability) {
    check(actor.roles?.includes('annotator'), 'Annotator role required');
    check(!this.job || !['analyzing', 'training', 'exporting'].includes(this.job.status), 'Research run already active');
    check(p?.authorization === true && p?.device === 'cpu' &&
      Number.isInteger(p.maxMinutes) && p.maxMinutes >= 1 && p.maxMinutes <= 30 &&
      Number.isInteger(p.threads) && p.threads >= 1 && p.threads <= 4,
      'Explicit bounded local CPU authorization required');
    check(['single', 'multi'].includes(p.mode), 'Unknown research mode');
    check(['studio-local', 'studio-segformer'].includes(p.provider), 'Only bundled offline adapters are enabled for private images');
    if (p.provider === 'studio-segformer')
      check(p.noncommercialResearch === true, 'SegFormer requires explicit noncommercial research scope');
    check((p.provider === 'studio-segformer' ? capability.semanticSegmenter : capability.objectDetector)?.status === 'available',
      'Selected bundled local model unavailable');
    const modelSha256 = (p.provider === 'studio-segformer' ? capability.semanticSegmenter : capability.objectDetector).sha256;
    const c = await this.w.catalog();
    const matching = c.items.filter(i => p.mode === 'multi' || i.key === p.key);
    const candidates = matching.slice(0, p.mode === 'single' ? 1 : 32);
    check(candidates.length, 'No matching indexed image');
    const selected = [], excluded = matching.slice(candidates.length).map(i => ({ key: i.key, reason: 'Research run image limit: 32' }));
    for (const i of candidates) {
      try { selected.push(await this.eligible(i)); }
      catch (e) { excluded.push({ key: i.key, reason: e.message }); }
    }
    if (!selected.length) {
      const id = randomUUID();
      this.job = { id, status: 'stopped', mode: p.mode, provider: p.provider, modelSha256, actor: actor.id,
        startedAt: now(), updatedAt: now(), authorization: { device: 'cpu', maxMinutes: p.maxMinutes,
          threads: p.threads, scope: 'local_noncommercial_research_only' }, selected: [], excluded,
        analyzed: [], events: [], trainingStarted: false, trainingPerformed: false, onnxVerified: false,
        humanApproval: false, productionEligible: false, evaluation: 'not_performed',
        reason: 'No image has verified research rights, privacy and test isolation' };
      await this.log('gate', this.job.reason);
      return this.public();
    }
    if (p.mode === 'multi') {
      const groups = await releaseGroups(this.w, c.items.filter(i => selected.some(s => s.key === i.key)));
      for (const s of selected) s.leakageGroup = groups.get(s.key) ?? s.leakageGroup;
      const protectedGroups = new Set((await finalCohort(this.w.root))?.samples
        .map(x => groups.get(x.key)).filter(Boolean) ?? []);
      check(!selected.some(s => protectedGroups.has(s.leakageGroup)),
        'Protected final-test image is duplicated in the research selection');
    }
    for (const s of selected) await markDevelopment(this.w, await this.w.item(s.key));
    const id = randomUUID();
    this.job = { id, status: 'analyzing', mode: p.mode, provider: p.provider, modelSha256,
      actor: actor.id, startedAt: now(), updatedAt: now(),
      authorization: { device: 'cpu', maxMinutes: p.maxMinutes, threads: p.threads, scope: 'local_noncommercial_research_only' },
      deadline: Date.now() + p.maxMinutes * 60_000, selected, excluded,
      analyzed: [], events: [], trainingStarted: false, trainingPerformed: false, onnxVerified: false,
      humanApproval: false, productionEligible: false, evaluation: 'not_performed' };
    await this.log('start', `Authorized ${selected.length} private research image(s); ${excluded.length} excluded.`);
    this.timer = setTimeout(() => { this.stop('Authorized time limit reached').catch(() => {}); }, p.maxMinutes * 60_000);
    return this.public();
  }
  async submit(p, actor) {
    const j = this.job;
    check(j?.status === 'analyzing' && p.id === j.id, 'No active image analysis');
    check(actor.id === j.actor, 'Research run belongs to another local account');
    check(Date.now() < j.deadline, 'Authorized time limit reached');
    const selected = j.selected[j.analyzed.length];
    check(selected?.key === p.key, 'Analysis order or image mismatch');
    const item = await this.w.item(p.key);
    const fresh = await this.eligible(item);
    check(fresh.sha256 === selected.sha256 && fresh.version === selected.version && fresh.baseHash === selected.baseHash,
      'Image changed during analysis');
    check(Array.isArray(p.detections) && p.detections.length <= 100, 'Bounded detections required');
    const labels = p.detections.map(d => {
      check(stairClasses.has(d.classId) && validBox(d.box) && Number.isFinite(d.score) && d.score >= 0 && d.score <= 1,
        'Invalid stairs detection');
      return { classId: d.classId, box: d.box, confidence: d.score,
        confidenceKind: d.confidenceKind === 'region_heuristic_not_calibrated'
          ? d.confidenceKind : 'model_score_not_calibrated', source: j.provider,
        evidence: { imageSha256: selected.sha256, modelSha256: p.modelSha256 },
        inputAttestation: 'browser_supplied_output_not_server_verified',
        status: 'automatic_unreviewed', humanApproved: false };
    });
    check(p.modelSha256 === j.modelSha256, 'Bundled model SHA-256 mismatch');
    j.analyzed.push({ key: p.key, imageSha256: selected.sha256, labels,
      direction: labels.some(x => x.classId === 2301) ? 'up' : labels.some(x => x.classId === 2302) ? 'down' : 'unknown',
      issues: Array.isArray(p.issues) ? p.issues.slice(0, 20).map(String) : [] });
    await this.log('analysis', `${j.analyzed.length}/${j.selected.length}: ${labels.length} unreviewed stairs labels`);
    return this.public();
  }
  async finish(actor) {
    const j = this.job;
    check(j?.status === 'analyzing' && j.analyzed.length === j.selected.length, 'Analysis incomplete');
    check(actor.id === j.actor, 'Research run belongs to another local account');
    const positives = j.selected.filter(x => x.reference.length);
    if (j.mode === 'single') {
      j.status = 'completed';
      j.reason = 'Single-image educational run: no independent validation or accuracy estimate.';
      await this.log('complete', j.reason);
      clearTimeout(this.timer);
      return this.public();
    }
    const groups = new Set(positives.map(x => j.selected.find(s => s.key === x.key).leakageGroup));
    if (positives.length < 3 || groups.size < 3) {
      j.status = 'stopped';
      j.reason = 'At least three positive images from three distinct development groups are required for train/validation.';
      await this.log('gate', j.reason);
      clearTimeout(this.timer);
      return this.public();
    }
    // Train against existing human-reviewed reference labels only. AI proposals
    // remain unreviewed evidence and cannot silently become ground truth.
    j.status = 'training';
    await this.log('training', 'Starting bounded CPU research trainer. No official approval is recorded.');
    this.train().catch(async e => { if (this.job?.id === j.id && j.status !== 'stopped') {
      try {
        const partial = await this.w.json(`${base}/${j.id}-model/training-run.json`);
        j.trainingPerformed = partial.trainingPerformed === true;
        j.weightsSha256 = partial.weightsSha256;
      } catch { /* No completed training record exists. */ }
      j.status = 'failed'; j.reason = e.message; await this.log('error', e.message); clearTimeout(this.timer); } });
    return this.public();
  }
  async train() {
    const j = this.job;
    for (const selected of j.selected) {
      const fresh = await this.eligible(await this.w.item(selected.key));
      check(fresh.sha256 === selected.sha256 && fresh.version === selected.version &&
        fresh.baseHash === selected.baseHash, 'Research input or rights changed before CPU training');
    }
    if (j.status !== 'training') return;
    const plan = { schemaVersion: 1, scope: 'local_research_only', images: j.selected.map(s => ({
      path: s.path, sha256: s.sha256, group: s.leakageGroup, width: s.width, height: s.height,
      labels: s.reference.map(({ classId, box }) => ({ classId, box }))
    })), epochs: 1, threads: j.authorization.threads, deadlineEpochMs: j.deadline,
      output: await this.w.safe(`${base}/${j.id}-model`, true) };
    await writeFile(await this.w.safe(`${base}/${j.id}-plan.json`, true), JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
    let configured;
    try { configured = (await this.w.json('.studio/training-readiness.json')).python; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const python = process.env.BASIRA_RESEARCH_PYTHON || configured ||
      resolve(homedir(), 'Basira-Private-Backup/tools/basira-training-cpu-py312/Scripts/python.exe');
    check(/^(python(?:3(?:\.\d+)?)?)(?:\.exe)?$/i.test(basename(python)) &&
      (await realpath(python)).toLowerCase() === resolve(python).toLowerCase(),
      'Configured local CPU Python environment unavailable');
    if (j.status !== 'training') return;
    const args = [resolve(repo, 'scripts/vision-ai/research-train.py'), await this.w.safe(`${base}/${j.id}-plan.json`)];
    await new Promise((ok, no) => {
      const child = spawn(python, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CUDA_VISIBLE_DEVICES: '', OMP_NUM_THREADS: String(j.authorization.threads),
          NO_PROXY: '*', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' } });
      this.child = child;
      child.on('spawn', () => { j.trainingStarted = true; this.log('trainer', 'Local CPU process launched.').catch(() => {}); });
      let output = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', b => {
        output = (output + b.toString()).slice(-4000);
        this.log('trainer', b.toString().slice(0, 500)).catch(() => {});
      });
      child.on('error', no);
      child.on('close', code => { this.child = null; code === 0 ? ok() : no(new Error(`CPU trainer exited ${code}: ${output}`)); });
    });
    if (j.status === 'stopped') return;
    const result = await this.w.json(`${base}/${j.id}-model/report.json`);
    j.trainingPerformed = result.trainingPerformed === true;
    j.onnxVerified = result.onnxVerified === true;
    j.weightsSha256 = result.weightsSha256;
    j.onnxSha256 = result.onnxSha256;
    j.evaluation = 'development_validation_only_insufficient_for_accuracy_or_navigation_safety';
    j.status = 'completed';
    await this.log('complete', 'CPU training and ONNX verification completed; no independent test or safety claim.');
    clearTimeout(this.timer);
  }
  async stop(reason = 'Stopped by user', actor = null) {
    const j = this.job;
    if (!j || !['analyzing', 'training', 'exporting'].includes(j.status)) return this.public();
    if (actor) check(actor.id === j.actor, 'Research run belongs to another local account');
    j.status = 'stopped'; j.reason = reason;
    if (this.child) this.child.kill();
    clearTimeout(this.timer);
    await this.log('stop', reason);
    return this.public();
  }
  async fail(reason, actor) {
    const j = this.job;
    check(j?.status === 'analyzing' && actor.id === j.actor, 'No authorized analysis to fail');
    j.status = 'failed';
    j.reason = `Local agent failed: ${String(reason ?? 'unknown').slice(0, 300)}`;
    clearTimeout(this.timer);
    await this.log('error', j.reason);
    return this.public();
  }
  async close() { await this.stop('Studio server closed'); }
}
