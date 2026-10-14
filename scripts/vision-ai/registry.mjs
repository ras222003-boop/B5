import { mkdir, copyFile, rename, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson, fileHash, checkedFile, requireValue as check, sha, nonempty, taxonomyPath } from './common.mjs';

const validVersion = version => typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version);
async function state(root) {
  try { return await readJson(resolve(root, 'lab-state.json')); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, scope: 'offline-lab-only', active: null, previous: null, history: [] }; throw error; }
}
async function locked(root, action) {
  await mkdir(root, { recursive: true });
  const lock = resolve(root, '.write-lock');
  await mkdir(lock); // concurrent mutations fail; no lost updates
  try { return await action(); } finally { await rmdir(lock); }
}
export async function verifyRelease(root, version) {
  check(validVersion(version), 'invalid version');
  const folder = resolve(root, version), manifest = await readJson(resolve(folder, 'release.json'));
  check(manifest.schemaVersion === 1 && manifest.version === version && manifest.scope === 'offline-lab-only' &&
    manifest.productionEligible === false && ['onnx', 'tflite'].includes(manifest.format) &&
    Array.isArray(manifest.files) && manifest.files.length === 4, 'invalid lab release');
  const expected = [`model.${manifest.format}`, 'metrics.json', 'license-evidence.txt', 'taxonomy.json'];
  check(new Set(manifest.files.map(f => f.path)).size === 4 && expected.every(name => manifest.files.some(f => f.path === name)), 'incomplete release file inventory');
  check(manifest.files.find(f => f.path === expected[0]).sha256 === manifest.modelSha256 &&
    manifest.files.find(f => f.path === 'taxonomy.json').sha256 === manifest.taxonomySha256, 'release manifest hash inconsistency');
  for (const f of manifest.files) await checkedFile(folder, f.path, f.sha256);
  check(manifest.taxonomySha256 === await fileHash(taxonomyPath), 'release taxonomy differs; migration required');
  return manifest;
}
export async function registerRelease(root, descriptor, inputRoot) {
  check(validVersion(descriptor.version) && ['tflite', 'onnx'].includes(descriptor.format) &&
    nonempty(descriptor.sourceCommit) && /^[a-f0-9]{40}$/.test(descriptor.sourceCommit) &&
    sha(descriptor.modelSha256) && descriptor.taxonomySha256 === await fileHash(taxonomyPath), 'invalid release identity/hash');
  check(['existing-baseline', 'experimental-candidate'].includes(descriptor.status) && nonempty(descriptor.licenseEvidence), 'status/license evidence required');
  check(descriptor.compatibility && nonempty(descriptor.compatibility.input) && nonempty(descriptor.compatibility.output) &&
    nonempty(descriptor.compatibility.runtime), 'model input/output/runtime contract required');
  const model = await checkedFile(inputRoot, descriptor.modelPath, descriptor.modelSha256);
  const evidence = await checkedFile(inputRoot, descriptor.metricsPath, descriptor.metricsSha256);
  const metrics = await readJson(evidence);
  check(metrics.modelSha256 === descriptor.modelSha256 || metrics.run?.modelSha256 === descriptor.modelSha256, 'performance evidence belongs to another model');
  check(nonempty(metrics.scope) && metrics.schemaVersion === 1, 'performance evidence scope required');
  check(descriptor.trainingRunSha256 == null || sha(descriptor.trainingRunSha256), 'invalid training run hash');
  check(descriptor.datasetSha256 == null || sha(descriptor.datasetSha256) && descriptor.datasetSha256 === metrics.datasetSha256, 'performance evidence dataset mismatch');
  const license = await checkedFile(inputRoot, descriptor.licenseEvidence, descriptor.licenseSha256);
  return locked(root, async () => {
    const folder = resolve(root, descriptor.version);
    await mkdir(folder); // immutable version, including interrupted staging; operator inspects before removal
    const names = [`model.${descriptor.format}`, 'metrics.json', 'license-evidence.txt', 'taxonomy.json'];
    const sources = [model, evidence, license, taxonomyPath], files = [];
    for (let i = 0; i < names.length; i++) {
      await copyFile(sources[i], resolve(folder, names[i]), 1);
      files.push({ path: names[i], sha256: await fileHash(resolve(folder, names[i])) });
    }
    check(files[0].sha256 === descriptor.modelSha256 && files[1].sha256 === descriptor.metricsSha256 &&
      files[2].sha256 === descriptor.licenseSha256 && files[3].sha256 === descriptor.taxonomySha256, 'source changed during registration');
    const manifest = { schemaVersion: 1, scope: 'offline-lab-only', version: descriptor.version, status: descriptor.status,
      sourceCommit: descriptor.sourceCommit, format: descriptor.format, modelSha256: descriptor.modelSha256,
      taxonomySha256: descriptor.taxonomySha256, compatibility: descriptor.compatibility,
      trainingRunSha256: descriptor.trainingRunSha256 ?? null, datasetSha256: descriptor.datasetSha256 ?? null, files,
      createdAt: new Date().toISOString(), productionEligible: false };
    await writeJson(resolve(folder, 'release.json'), manifest);
    return manifest;
  });
}
export async function selectRelease(root, version, reason, rollback = false) {
  check(nonempty(reason), 'selection/rollback reason required');
  return locked(root, async () => {
    const current = await state(root), target = rollback ? current.previous : version;
    check(target && target !== current.active, 'no different/previous lab release available');
    const manifest = await verifyRelease(root, target);
    const next = { ...current, active: target, previous: current.active, history: [...current.history,
      { at: new Date().toISOString(), action: rollback ? 'rollback' : 'select', from: current.active, to: target, reason,
        releaseSha256: await fileHash(resolve(root, target, 'release.json')), modelSha256: manifest.modelSha256 }] };
    const temporary = resolve(root, `.state-${randomUUID()}.json`);
    await writeJson(temporary, next); await rename(temporary, resolve(root, 'lab-state.json')); return next;
  });
}
