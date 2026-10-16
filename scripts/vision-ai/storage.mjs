import { mkdir, stat, realpath, copyFile, rmdir, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { requireValue as check, readJson, writeJson, checkedFile, fileHash, localPath, nonempty, sha, taxonomyPath } from './common.mjs';
import { validateSource, prepareDraft, importCoco } from './data.mjs';

export async function outsideGit(path) {
  // Resolve symlinked ancestors too: a lexical path outside the checkout is insufficient.
  let p = resolve(path), missing = [];
  while (true) {
    try { p = await realpath(p); break; } catch (e) { if (e.code !== 'ENOENT') throw e; missing.unshift(p.split(/[\\/]/).at(-1)); p = dirname(p); }
  }
  let ancestor = p;
  while (true) {
    try { await stat(join(ancestor, '.git')); throw new Error('dataset storage must be outside every Git checkout'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  return resolve(p, ...missing);
}

export async function initStorage(path) {
  const root = await outsideGit(path); await mkdir(root);
  for (const folder of ['images', 'videos', 'labels', 'distances', 'rights', 'collections', 'exports', 'runs', 'registry',
    'splits/train', 'splits/validation', 'splits/test']) await mkdir(resolve(root, folder), { recursive: true });
  await writeJson(resolve(root, 'storage.json'), { schemaVersion: 1, name: 'Basira-Vision-Datasets',
    mode: 'local-outside-git', cloudProvisioned: false, containsUserData: false,
    accessReview: 'pending-operator-review-of-local-ACL-and-disk-encryption',
    futureProviders: ['gcs', 'r2'], policy: 'No public links, credentials, uploads, user capture, or automatic training.' });
  await writeJson(resolve(root, 'bundle-inventory.template.json'), bundleTemplate());
  return { status: 'EMPTY_STORAGE_CREATED', root, cloudProvisioned: false, trainingPerformed: false };
}

export function bundleTemplate() {
  return { schemaVersion: 1, id: 'basira-pilot-001', contentKind: 'real', containsUserData: false,
    note: 'EMPTY TEMPLATE: add only team/licensed files. See ml/vision/PHASE2.md. This is not approved data.',
    sources: [{ id: 'team-001', kind: 'basira_team', origin: '', license: '', trainingAllowed: false, containsUserData: false,
      rightsReview: { status: 'pending', reviewer: '', at: '', evidence: { path: 'rights/team-permission.txt', sha256: '' } } }],
    files: [], samples: [], cocoPath: null };
}

/** Hash only explicitly inventoried files; does not discover personal media or grant rights approval. */
export async function bundleDraft(inventory, root) {
  check(inventory?.schemaVersion === 1 && Array.isArray(inventory.files) && Array.isArray(inventory.sources) &&
    Array.isArray(inventory.samples), 'bundle inventory files, sources and samples required');
  const files = [];
  for (const f of inventory.files) {
    const digest = await fileHash(localPath(root, f.path)); await checkedFile(root, f.path, digest);
    files.push({ ...f, sha256: digest });
  }
  const byPath = new Map(files.map(f => [f.path, f]));
  return { ...inventory, files,
    sources: inventory.sources.map(s => ({ ...s, rightsReview: { ...s.rightsReview, status: 'pending', reviewer: '', at: '',
      evidence: { path: s.rightsReview.evidence.path, sha256: byPath.get(s.rightsReview.evidence.path)?.sha256 ?? '' } } })),
    samples: inventory.samples.map(s => ({ ...s, sha256: byPath.get(s.path)?.sha256 ?? '', split: null,
      media: s.media?.kind === 'video_frame' ? { ...s.media, video: { ...s.media.video, sha256: byPath.get(s.media.video.path)?.sha256 ?? '' } } : s.media })) };
}

/** Import a local, explicitly licensed bundle. No networking, unpacking, approval generation or split changes. */
export async function importBundle(bundle, incomingRoot, storageRoot) {
  const root = await outsideGit(storageRoot);
  check((await readJson(resolve(root, 'storage.json'))).name === 'Basira-Vision-Datasets', 'initialize storage first');
  check(await realpath(resolve(root, 'collections')) === resolve(root, 'collections'), 'collections directory cannot be a symlink');
  check(bundle?.schemaVersion === 1 && /^[a-z0-9][a-z0-9-]{2,63}$/.test(bundle.id), 'safe unique bundle id required');
  check(bundle.contentKind === 'real' && bundle.containsUserData === false, 'only declared real non-user data can be imported');
  check(Array.isArray(bundle.sources) && bundle.sources.length > 0 && Array.isArray(bundle.files) && bundle.files.length > 0 &&
    Array.isArray(bundle.samples) && bundle.samples.length > 0, 'bundle files, sources and sample inventory required');
  const sourceIds = new Set();
  for (const source of bundle.sources) {
    check(!sourceIds.has(source.id), 'duplicate bundle source'); sourceIds.add(source.id); await validateSource(source, incomingRoot);
  }
  const files = new Map(), mediaHashes = new Set(), resolved = new Map();
  for (const f of bundle.files) {
    check(['image', 'video', 'labels', 'distance', 'rights'].includes(f.kind) && sourceIds.has(f.sourceId) && sha(f.sha256) &&
      nonempty(f.originalId) && nonempty(f.origin), 'per-file source/original identity/rights attribution required');
    localPath(incomingRoot, f.path); const key = f.path.toLowerCase();
    check(!files.has(key), 'duplicate bundle path');
    const prefix = { image: 'images/', video: 'videos/', labels: 'labels/', distance: 'distances/', rights: 'rights/' }[f.kind];
    check(f.path.startsWith(prefix), 'bundle paths must use their typed storage folders');
    files.set(key, f); resolved.set(f.path, await checkedFile(incomingRoot, f.path, f.sha256));
    if (['image', 'video'].includes(f.kind)) { check(!mediaHashes.has(f.sha256), 'duplicate media content in bundle'); mediaHashes.add(f.sha256); }
  }
  const listed = (path, kind, sourceId, digest) => {
    const f = files.get(path?.toLowerCase());
    check(f && f.path === path && f.kind === kind && f.sourceId === sourceId && (!digest || f.sha256 === digest), 'inventory references an unlisted or mismatched file'); return f;
  };
  for (const source of bundle.sources) listed(source.rightsReview.evidence.path, 'rights', source.id, source.rightsReview.evidence.sha256);
  for (const s of bundle.samples) {
    listed(s.path, 'image', s.sourceId, s.sha256);
    check(s.split == null && nonempty(s.leakageGroup), 'import cannot reuse frozen splits; site/session group required');
    if (s.media?.kind === 'video_frame') listed(s.media.video.path, 'video', s.sourceId, s.media.video.sha256);
  }
  if (bundle.cocoPath) check(files.get(bundle.cocoPath.toLowerCase())?.kind === 'labels', 'COCO labels must be listed');
  // One writer: prevents concurrent imports accepting identical content into separate collections.
  const lock = resolve(root, '.import-lock'); await mkdir(lock);
  try {
    for (const entry of await readdir(resolve(root, 'collections'), { withFileTypes: true })) {
      check(entry.isDirectory() && !entry.isSymbolicLink(), 'unexpected collection entry');
      const prior = await readJson(resolve(root, 'collections', entry.name, 'bundle.json'));
      check(!prior.files.some(f => ['image', 'video'].includes(f.kind) && mediaHashes.has(f.sha256)), 'media already imported in another collection; reconcile provenance instead of duplicating');
    }
    const output = resolve(root, 'collections', bundle.id); await mkdir(output);
    // A failed import is retained for inspection; it never produces an approved dataset.
    await writeJson(resolve(output, 'bundle.json'), bundle);
    for (const f of bundle.files) {
      const target = localPath(output, f.path); await mkdir(dirname(target), { recursive: true });
      await copyFile(resolved.get(f.path), target, constants.COPYFILE_EXCL);
      await checkedFile(output, f.path, f.sha256);
    }
    let draft = await prepareDraft({ schemaVersion: 1, id: bundle.id, sources: bundle.sources,
      samples: bundle.samples.map(s => ({ ...s, provenance: files.get(s.path.toLowerCase()) })) }, output);
    if (bundle.cocoPath) draft = importCoco(draft, await readJson(localPath(output, bundle.cocoPath)), await readJson(taxonomyPath));
    await writeJson(resolve(output, 'dataset.draft.json'), draft);
    return { status: 'IMPORTED_PENDING_PRIVACY_AND_INDEPENDENT_LABEL_REVIEW', root: output, samples: draft.samples.length, trainingAllowed: false };
  } finally { await rmdir(lock); }
}

/** Inventory for a later administrator-run private transfer; intentionally performs no upload. */
export async function transferPlan(rootPath, provider, bucket) {
  const root = await outsideGit(rootPath);
  check((await readJson(resolve(root, 'storage.json'))).name === 'Basira-Vision-Datasets', 'initialize storage first');
  check(['gcs', 'r2'].includes(provider) && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'gcs/r2 provider and bucket name required');
  const files = [];
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      check(!entry.isSymbolicLink(), 'symlinks forbidden in transfer inventory');
      const key = `${prefix}${entry.name}`, path = join(folder, entry.name);
      check(!/(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key))$/i.test(key) && !/^\.studio\/(?:identities(?:\.|$)|credentials(?:\/|$))/i.test(key), 'credentials cannot be included in transfer inventory');
      if (entry.isDirectory()) await walk(path, `${key}/`);
      else if (entry.isFile()) files.push({ key, bytes: (await stat(path)).size, sha256: await fileHash(path) });
    }
  }
  await walk(root);
  return { schemaVersion: 1, provider, bucket, status: 'PLAN_ONLY_NO_UPLOAD', files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0), requirements: ['private bucket', 'public access disabled',
      'least-privilege credentials outside dataset', 'encryption', 'retention and deletion policy', 'verify SHA-256 after restore'], credentialFilesAllowed: false };
}
