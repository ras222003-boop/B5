/** Training-completion hook: actual artifacts/evidence -> local experimental registry. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {registerCompletion,defaultRegistry} from './registry.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function completeV3({root,run,v2Report,registry=process.env.BASIRA_EXPERIMENTAL_MODELS_ROOT??defaultRegistry,python}){
  root=resolve(root);run=resolve(run);const rel=relative(root,run);if(!rel||rel.startsWith('..'))throw new Error('Run must be inside its synthetic cohort');
  const lock=await read(resolve(run,'selection-lock.json')),manifest=await read(resolve(root,'manifest.json')),validation=await read(resolve(root,'validation.json')),baseline=await read(v2Report);
  if(manifest.contentKind!=='synthetic_ground_truth'||validation.passed!==true||validation.manifestSha256!==lock.manifestSha256||digest(await readFile(resolve(root,'manifest.json')))!==lock.manifestSha256)throw new Error('Generated data validation/identity changed');
  if(baseline.sourceWeights!=='random_initialization')throw new Error('Unknown starting-weight rights: explicit reviewed completion required');
  const entryPath=resolve(run,'entry.json'),entry=await read(entryPath);
  const provenancePath=resolve(run,'experimental-provenance.json');
  const provenance={kind:'project_generated',allowedUse:'local_experimental_inference',trainingContentKind:'synthetic_ground_truth',
    startingWeights:'project_random_initialization_lineage',datasetSha256:lock.manifestSha256,baselineReportSha256:digest(await readFile(v2Report)),
    note:'Procedural project geometry and project-trained weights. No human approval or external-asset authorization is generated.'};
  const provenanceBytes=Buffer.from(JSON.stringify(provenance,null,2));await writeFile(provenancePath,provenanceBytes);
  let evaluationPath=resolve(run,'selection-lock.json'),evaluationScope='development_validation';
  try{await readFile(resolve(root,'comparison/comparison.json'));evaluationPath=resolve(root,'comparison/comparison.json');evaluationScope='independent_synthetic_test';}catch(error){if(error.code!=='ENOENT')throw error;}
  const artifact=async path=>({path:relative(root,path).replaceAll('\\','/'),sha256:digest(await readFile(path))});
  const completion={schemaVersion:1,scope:'basira-experimental-training-completion',status:'completed',
    id:`stairs-${entry.sha256.slice(0,16)}-${digest(await readFile(entryPath)).slice(0,8)}`,name:entry.name,
    modelSha256:entry.sha256,entry:await artifact(entryPath),training:await artifact(resolve(run,'selection-lock.json')),
    evaluation:await artifact(evaluationPath),provenance:await artifact(provenancePath),evaluationScope,productionEligible:false,humanApproval:false};
  const path=resolve(root,'model.completion.json'),bytes=Buffer.from(JSON.stringify(completion,null,2));
  try{const previous=await readFile(path);if(!previous.equals(bytes))throw new Error('Completion already emitted; do not silently replace its evaluation/selection evidence');}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx'});}
  return registerCompletion(path,{root:registry,python});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
  if(!value('--root')||!value('--run')||!value('--v2-report'))throw new Error('--root, --run and --v2-report required');
  console.log(JSON.stringify(await completeV3({root:value('--root'),run:value('--run'),v2Report:value('--v2-report'),registry:value('--registry')??process.env.BASIRA_EXPERIMENTAL_MODELS_ROOT??defaultRegistry,python:value('--python')})));
}
