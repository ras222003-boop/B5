/** Import owner-supplied local photos into a private V4 review draft.
 * Never certifies rights, labels, people/privacy clearance, or model readiness.
 * All output remains local and outside the Git repository.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, chmodSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, extname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const repoRoot = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,119}$/.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputFormats = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function inside(root, child) {
  const diff = relative(root, child);
  return diff === '' || (!diff.startsWith('..' + sep) && diff !== '..' && !isAbsolute(diff));
}
function fileInPrivateFolder(inputRoot, entry) {
  if (!entry.isFile() || !inputFormats.has(extname(entry.name).toLowerCase())) return false;
  const full = realpathSync(join(inputRoot, entry.name));
  if (!inside(inputRoot, full)) throw Error('symlink or path escape detected');
  return full;
}

export async function prepareV4Captures({
  inputDir, outputDir, sourceDatasetId, captureGroupId, selectedTargets = ['chair', 'book']
}) {
  if (!validId(sourceDatasetId) || !validId(captureGroupId)) throw Error('explicit source and capture-group IDs required');
  const policy = JSON.parse(readFileSync(join(repoRoot, 'ml/vision/objects-v4-targets.v1.json'), 'utf8'));
  if (policy.deniedDatasetIds.includes(sourceDatasetId.toLowerCase()))
    throw Error('source dataset is restricted or unknown');
  const targets = Array.isArray(selectedTargets) && selectedTargets.length > 0
    ? selectedTargets.map(key => policy.targets.find(x => x.key === key)) : [];
  if (targets.length === 0 || targets.some(x => !x || x.kind !== targets[0].kind) ||
      new Set(selectedTargets).size !== selectedTargets.length) {
    throw Error('selected targets must be unique and belong to one training head');
  }
  const input = realpathSync(resolve(inputDir));
  const output = resolve(outputDir);
  if (inside(repoRoot, input) || inside(repoRoot, output) || inside(input, output) ||
      inside(output, input)) throw Error('private data must remain outside repository and source folder');
  if (existsSync(output)) throw Error('refusing to replace an existing output folder');
  const candidates = readdirSync(input, {withFileTypes: true}).filter(x => fileInPrivateFolder(input, x));
  if (candidates.length < 1 || candidates.length > 250) throw Error('input must contain between 1 and 250 supported photos');
  mkdirSync(output, {recursive: false, mode: 0o700});
  mkdirSync(join(output, 'images'), {mode: 0o700});
  const records = [], rejected = {invalid: 0, oversized: 0, duplicate: 0};
  const seen = new Set();
  for (const entry of candidates) {
    const file = fileInPrivateFolder(input, entry);
    if (!file) continue;
    if (statSync(file).size > 25 * 1024 * 1024) {rejected.oversized++; continue;}
    try {
      // Rotate EXIF orientation before labelling; re-encode PNG without EXIF/GPS/XMP.
      const bytes = await sharp(file, {failOn: 'error', limitInputPixels:50_000_000})
        .rotate().png({compressionLevel:8}).toBuffer();
      const digest = sha(bytes);
      if (seen.has(digest)) {rejected.duplicate++; continue;}
      seen.add(digest);
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.exif?.length || metadata.xmp?.length)
        throw Error('re-encoded photo failed metadata validation');
      const id = randomUUID(), imagePath = 'images/' + id + '.png';
      const filePath = join(output, imagePath);
      writeFileSync(filePath, bytes, {flag:'wx', mode:0o600});
      records.push({
        id, sourceDatasetId, captureGroupId,
        split: null, imagePath, sha256: digest, width: metadata.width,
        height: metadata.height,
        rights: {
          licenseId: null, commercialTrainingAllowed: false, sourceOrOwner: '',
          attribution: '', evidencePath: '', evidenceSha256: ''
        },
        privacy: {metadataStripped: true, facesPlatesHandled: false},
        review: {
          rightsBy: '', privacyBy: '', labelsBy: '', independentLabelsBy: '',
          rightsApproved: false, privacyApproved: false,
          labelsApproved: false, independentApproved: false
        },
        annotationProvenance:'unreviewed',
        verifiedExhaustiveClasses: [],
        objects:[]
      });
    } catch { rejected.invalid++; }
  }
  const manifest = {
    schemaVersion: 1,
    experimentKind: targets[0].kind,
    selectedTargets,
    modelInitialization: policy.modelStart,
    warning: 'UNAPPROVED DRAFT. Assign independent scene-level splits and complete actual human rights, privacy and label reviews; never turn these flags true without evidence.',
    records
  };
  const manifestPath = join(output, 'manifest.draft.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag:'wx', mode:0o600});
  return {acceptedDraftPhotos:records.length, rejected, manifestPath, readyToTrain:false, approvalsInvented:false};
}
function flag(argv, name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argv=process.argv.slice(2);
    const result=await prepareV4Captures({
      inputDir:flag(argv,'input'), outputDir:flag(argv,'output'),
      sourceDatasetId:flag(argv,'source-id'), captureGroupId:flag(argv,'capture-group'),
      selectedTargets:(flag(argv,'targets')||'chair,book').split(',').map(x=>x.trim())
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('V4 private capture import refused: ' + error.message + '\n');
    process.exitCode=1;
  }
}
