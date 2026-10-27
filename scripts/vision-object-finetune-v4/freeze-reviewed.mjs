/** Produce an immutable local supervised-object DATASET PLAN from approved images.
 * No model execution, no held-out test labels, no image uploads, no training.
 * Fail closed unless metadata, real pixels and original publisher weight SHA pass.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessV4Intake } from './intake.mjs';
import { inspectV4Images } from './image-preflight.mjs';

const project = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileSha(path) {
  const digest = createHash('sha256');
  for await (const part of createReadStream(path)) digest.update(part);
  return digest.digest('hex');
}
function isInside(parent, child) {
  const diff = relative(parent, child);
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff));
}
export function cocoModelClasses(rawTypeScript) {
  const names = [...rawTypeScript.matchAll(/^  \["([^"]+)",/gm)].map(m => m[1]);
  if (names.length !== 80 || new Set(names).size !== 80 ||
      names[0] !== 'person' || names[9] !== 'traffic light' || names[56] !== 'chair' ||
      names[73] !== 'book') throw Error('COCO80 order is unknown; refusing label index remapping');
  return names;
}
export function buildScopedV4Package(manifest, policy, names) {
  if (manifest.experimentKind !== 'coco80' ||
      manifest.selectedTargets.some(key => !names.includes(key) ||
        policy.targets.find(t => t.key === key)?.kind !== 'coco80')) {
    throw Error('only existing, explicitly reviewed COCO80 classes can use this exporter');
  }
  const selected = [...manifest.selectedTargets];
  const rows = split => manifest.records.filter(r => r.split === split).map(row => ({
    id: row.id, sourceDatasetId: row.sourceDatasetId,
    captureGroupId: row.captureGroupId, imagePath: row.imagePath,
    imageSha256: row.sha256, width: row.width, height: row.height,
    // Unlabelled classes are UNKNOWN, never negative examples for all COCO80.
    verifiedExhaustiveClasses: selected,
    partialLabelScope: true,
    objects: row.objects.map(obj => ({
      className: obj.classKey,
      cocoOutputIndex: names.indexOf(obj.classKey),
      normalizedXYWH: obj.bbox,
      shape: obj.shape
    }))
  }));
  const withheld = manifest.records.filter(r => r.split === 'test').map(r => ({
    imageSha256: r.sha256, captureGroupId: r.captureGroupId
  }));
  const train = rows('train'), validation = rows('validation');
  if (!train.length || !validation.length || !withheld.length) throw Error('all independent splits required');
  if (train.some(r => r.objects.some(obj => obj.cocoOutputIndex < 0)) ||
      validation.some(r => r.objects.some(obj => obj.cocoOutputIndex < 0)))
    throw Error('unknown class output index');
  return {
    schemaVersion:1,
    kind:'scoped-coco80-v4',
    allowedInputClasses:selected,
    initialModel:policy.modelStart,
    training:train,
    validation,
    withheldFinalIndex:withheld,
    safety:'No partial-label negative mining outside verifiedExhaustiveClasses; test labels and pixels are excluded from this package.'
  };
}
function flag(argv, name) {
  const index = argv.indexOf('--' + name);
  return index < 0 ? undefined : argv[index+1];
}
export async function freezeReviewedV4({manifestPath,protectedIndexPath,dataRoot,outputDir,originalTinyCheckpoint}) {
  if ([manifestPath,protectedIndexPath,dataRoot,outputDir,originalTinyCheckpoint].some(x => !x))
    throw Error('manifest, protected-index, data-root, output and original Tiny checkpoint required');
  const input = realpathSync(resolve(dataRoot));
  const output = resolve(outputDir);
  if (isInside(project,input) || isInside(project,output) || isInside(input,output) ||
      isInside(output,input) || existsSync(output))
    throw Error('private output must be new and outside Git and input roots');
  const manifestBytes=readFileSync(manifestPath);
  const protectedBytes=readFileSync(protectedIndexPath);
  const policyBytes=readFileSync(join(project,'ml/vision/objects-v4-targets.v1.json'));
  const manifest=JSON.parse(manifestBytes), protectedIndex=JSON.parse(protectedBytes);
  const policy=JSON.parse(policyBytes);
  const metadata=assessV4Intake(manifest,protectedIndex,policy,input);
  const images=await inspectV4Images(manifest,input);
  if (!metadata.intakeReady || !images.imageContentVerified)
    throw Error('independent image, rights, label, split or historical-final intake gate failed');
  const realCheckpoint = realpathSync(resolve(originalTinyCheckpoint));
  if (isInside(project,realCheckpoint)) throw Error('model weights must stay outside the repository');
  const weightDigest=await fileSha(realCheckpoint);
  if (weightDigest!==policy.modelStart.sha256) throw Error('original Tiny checkpoint SHA-256 mismatch');
  const names=cocoModelClasses(readFileSync(join(project,'client/src/lib/vision/cocoLabels.ts'),'utf8'));
  const pkg=buildScopedV4Package(manifest,policy,names);
  // Freeze ONLY train/validation metadata; test labels stay in the private
  // historical manifest and are not copied into trainer-facing files.
  mkdirSync(output,{recursive:false,mode:0o700});
  const write=(name,body)=>writeFileSync(join(output,name),JSON.stringify(body,null,2)+'\n',{flag:'wx',mode:0o600});
  write('train.json', {kind:pkg.kind, labels:pkg.allowedInputClasses, images:pkg.training});
  write('validation.json', {kind:pkg.kind, labels:pkg.allowedInputClasses, images:pkg.validation});
  write('sealed-final-index.json', {sealed:true, imageCount:pkg.withheldFinalIndex.length, references:pkg.withheldFinalIndex, humanReviewRequiredBeforeEvaluation:true});
  write('lineage-lock.json', {
    schemaVersion:1, trainingStarted:false, readyForControlledTrainingExperiment:true,
    promotionEligible:false, originalTinyCheckpointSha256:weightDigest,
    inputManifestSha256:hash(manifestBytes), historicalExclusionIndexSha256:hash(protectedBytes),
    policySha256:hash(policyBytes), cocoOutputOrderSha256:hash(names.join('\n')),
    trainingImageCount:pkg.training.length, validationImageCount:pkg.validation.length,
    testImageCount:pkg.withheldFinalIndex.length, finalUsedForModelSelection:false,
    caution:'Reviewers must verify actual rights, labels, group independence and no hidden duplicates; a validated JSON record alone is not proof.'
  });
  return {freezeCreated:true, trainingStarted:false, train:pkg.training.length,
    validation:pkg.validation.length, heldOutFinal:pkg.withheldFinalIndex.length, outputDir:output};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  try {
    const result=await freezeReviewedV4({
      manifestPath:flag(args,'manifest'),protectedIndexPath:flag(args,'protected-index'),
      dataRoot:flag(args,'data-root'),outputDir:flag(args,'output'),
      originalTinyCheckpoint:flag(args,'original-tiny-checkpoint')
    });
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  } catch (error) {
    process.stderr.write('Reviewed V4 dataset freeze refused: '+error.message+'\n');
    process.exitCode=1;
  }
}
