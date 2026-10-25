/** Immutable, local experimental registry. Never writes the production model selector. */
import {mkdir,readFile,writeFile,copyFile,rename,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {normalizeEntry} from '../camera-lab/adapter.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(here,'../../..');
export const defaultRegistry=resolve(repository,'.vision-ai/experimental-models');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,message)=>{if(!ok)throw new Error(message);};
export const validModelId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,95}$/.test(id);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export function registryPath(root){
  const folder=resolve(root);
  for(const exposed of ['client/public','dist']){const rel=relative(resolve(repository,exposed),folder);check(rel.startsWith('..')||isAbsolute(rel),'Registry must not be placed in publishable assets');}
  return folder;
}
async function boundFile(base,record){
  check(record&&typeof record.path==='string'&&!isAbsolute(record.path)&&!record.path.includes('\\')&&!record.path.split('/').includes('..'),'Relative artifact evidence path required');
  const root=await realpath(base),path=await realpath(resolve(base,record.path)),rel=relative(root,path);
  check(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Artifact escaped completion directory');
  const size=(await stat(path)).size;check(size<=64*1024*1024,'Artifact exceeds 64 MiB limit');
  const bytes=await readFile(path);check(hash(bytes)===record.sha256,'Artifact evidence hash mismatch');return{path,bytes};
}
export function validateEvidence(completion,training,evaluation,provenance){
  check(completion.scope==='basira-experimental-training-completion'&&completion.status==='completed','Completed experimental run required');
  check(completion.productionEligible===false&&completion.humanApproval===false,'No production or human approval may be asserted');
  check(['project_generated','reviewed_external'].includes(provenance.kind)&&provenance.allowedUse==='local_experimental_inference','Explicit model/data provenance scope required');
  if(provenance.kind==='reviewed_external')check(provenance.review?.status==='approved'&&provenance.review?.recordSha256,'External rights review required');
  if(provenance.kind==='project_generated')check(provenance.trainingContentKind==='synthetic_ground_truth'&&provenance.startingWeights==='project_random_initialization_lineage'&&provenance.datasetSha256===training.manifestSha256,'Project synthetic data/weight lineage evidence required');
  check(training.onnxSha256===completion.modelSha256,'Training evidence belongs to another model');
  check(training.onnxCheckerPassed===true&&training.onnxRuntimePassed===true&&Number.isFinite(training.onnxParity)&&training.onnxParity<=1e-4,'Successful export and parity evidence required');
  check(Array.isArray(training.candidates)&&training.candidates.some(c=>c.optimizerSteps>0&&c.parameterDelta>0),'Actual optimizer/weight-change evidence required');
  check(['development_validation','independent_synthetic_test','independent_real_test'].includes(completion.evaluationScope),'Explicit evaluation scope required');
  const metrics=completion.evaluationScope==='development_validation'?training.validation:evaluation.v3??evaluation.metrics;
  check(metrics&&Number.isInteger(metrics.images??metrics.samples)&&(metrics.images??metrics.samples)>0,'Nonempty measured evaluation required');
  if(completion.evaluationScope==='independent_synthetic_test')check(evaluation.v3WeightsSha256===training.weightsSha256&&evaluation.manifestSha256===training.manifestSha256,'Synthetic test/model binding mismatch');
  if(completion.evaluationScope==='independent_real_test')check(evaluation.modelSha256===completion.modelSha256&&evaluation.status==='real_data_evaluated','Independent real evidence binding mismatch');
  return {images:metrics.images??metrics.samples,scenes:metrics.scenes??null,
    fixedDetection:metrics.fixedDetection??metrics.fixedPresence??null,confidenceCalibrated:false,
    realEvaluation:completion.evaluationScope==='independent_real_test'?'performed_not_navigation_approval':'not_established'};
}
export async function registerCompletion(completionPath,{root=defaultRegistry,python=process.env.BASIRA_RESEARCH_PYTHON??resolve(repository,'.metric-venv/Scripts/python.exe')}={}){
  root=registryPath(root);completionPath=resolve(completionPath);const base=dirname(completionPath),completion=await json(completionPath);
  check(validModelId(completion.id),'Invalid experimental model ID');
  const entryFile=await boundFile(base,completion.entry),entry=JSON.parse(entryFile.bytes.toString('utf8')),contract=normalizeEntry(entry);
  check(contract.adapter==='separated-v3'&&JSON.stringify(contract.input.shape)==='[1,3,160,160]','No adapter for this model contract');
  check(entry.model==='model.onnx'&&entry.sha256===completion.modelSha256,'Sibling model identity mismatch');
  const model=await boundFile(dirname(entryFile.path),{path:'model.onnx',sha256:entry.sha256});
  const training=await boundFile(base,completion.training),evaluation=await boundFile(base,completion.evaluation),provenance=await boundFile(base,completion.provenance);
  const provenanceData=JSON.parse(provenance.bytes);
  if(provenanceData.kind==='reviewed_external'){
    await boundFile(base,completion.rightsEvidence);
    check(completion.rightsEvidence.sha256===provenanceData.review?.recordSha256,'External rights evidence binding mismatch');
  }
  const measured=validateEvidence(completion,JSON.parse(training.bytes),JSON.parse(evaluation.bytes),provenanceData);
  try{const old=await verifyRegistered(root,completion.id);check(old.manifest.completionSha256===hash(await readFile(completionPath)),'Immutable experimental ID already used');return old.manifest;}catch(error){if(error.code!=='ENOENT')throw error;}
  const validation=await new Promise((done,reject)=>execFile(python,[resolve(here,'validate_onnx.py'),'--entry',entryFile.path],{windowsHide:true,timeout:30000,maxBuffer:128*1024,env:{...process.env,CUDA_VISIBLE_DEVICES:'',OMP_NUM_THREADS:'2'}},(error,stdout)=>{
    if(error)return reject(new Error(`Local ONNX validation failed: ${error.message}`));try{done(JSON.parse(stdout));}catch(e){reject(e);}
  }));
  check(validation.status==='verified'&&validation.modelSha256===entry.sha256,'ONNX technical validation failed');
  const manifest={schemaVersion:1,scope:'basira-experimental-display-only',id:completion.id,name:String(completion.name??contract.name).slice(0,100),
    modelSha256:entry.sha256,entrySha256:hash(entryFile.bytes),completionSha256:hash(await readFile(completionPath)),
    evaluationScope:completion.evaluationScope,evaluation:measured,validation,researchOnly:true,productionEligible:false,navigationEnabled:false,
    trainingDataEnrollment:'separate_explicit_action_required',registeredAt:new Date().toISOString()};
  await mkdir(root,{recursive:true});const destination=resolve(root,completion.id);
  const staging=resolve(root,`.pending-${randomUUID()}`);await mkdir(staging);
  await copyFile(model.path,resolve(staging,'model.onnx'));await writeFile(resolve(staging,'entry.json'),entryFile.bytes);
  await writeFile(resolve(staging,'release.json'),JSON.stringify(manifest,null,2));
  check(hash(await readFile(resolve(staging,'model.onnx')))===entry.sha256,'Model changed while copying');
  await rename(staging,destination);return manifest;
}
export async function verifyRegistered(root,id){
  check(validModelId(id),'Invalid model ID');root=registryPath(root);const directory=resolve(root,id);
  const manifest=await json(resolve(directory,'release.json'));
  check(manifest.id===id&&manifest.scope==='basira-experimental-display-only'&&manifest.productionEligible===false&&manifest.navigationEnabled===false,'Invalid experimental release policy');
  check(manifest.researchOnly===true&&manifest.validation?.status==='verified'&&manifest.validation.modelSha256===manifest.modelSha256&&manifest.validation.checkerPassed===true&&manifest.validation.cpuInferencePassed===true,'Missing registered technical verification');
  const model=await boundFile(directory,{path:'model.onnx',sha256:manifest.modelSha256});
  const entry=await boundFile(directory,{path:'entry.json',sha256:manifest.entrySha256});
  const contract=normalizeEntry(JSON.parse(entry.bytes));check(contract.sha256===manifest.modelSha256,'Registered entry/model mismatch');
  return {manifest,contract,model,entry};
}
export async function listRegistered(root=defaultRegistry){
  let folders;try{folders=await readdir(registryPath(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return[];throw error;}
  const results=[];for(const folder of folders){if(!folder.isDirectory()||!validModelId(folder.name))continue;
    try{results.push((await verifyRegistered(root,folder.name)).manifest);}catch{/* Corrupt/incomplete releases are not offered. */}}
  return results.sort((a,b)=>b.registeredAt.localeCompare(a.registeredAt));
}
export async function scanCompletions(inbox,options){
  const results=[];
  for(const file of await readdir(inbox)){if(!file.endsWith('.completion.json'))continue;
    try{const model=await registerCompletion(resolve(inbox,file),options);results.push({file,status:'registered',id:model.id});}
    catch(error){results.push({file,status:'rejected',reason:error.message});}}
  return results;
}
