import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {validateEvidence,validModelId,registryPath,registerCompletion,verifyRegistered,listRegistered} from './registry.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cleanup=async root=>{assert.equal(dirname(root),resolve('.vision-ai'));await rm(root,{recursive:true,force:true});};
const completion={scope:'basira-experimental-training-completion',status:'completed',productionEligible:false,humanApproval:false,modelSha256:'a'.repeat(64),evaluationScope:'development_validation'};
const training={onnxSha256:'a'.repeat(64),manifestSha256:'b'.repeat(64),onnxCheckerPassed:true,onnxRuntimePassed:true,onnxParity:1e-5,
  candidates:[{optimizerSteps:12,parameterDelta:.1}],validation:{images:12,scenes:3}};
const provenance={kind:'project_generated',allowedUse:'local_experimental_inference',trainingContentKind:'synthetic_ground_truth',startingWeights:'project_random_initialization_lineage',datasetSha256:'b'.repeat(64)};
test('registration checks actual-training/export/test provenance without asserting production approval',()=>{
  assert.equal(validateEvidence(completion,training,{},provenance).images,12);
  for(const change of [{productionEligible:true},{humanApproval:true},{status:'training'},{evaluationScope:'unknown'}])assert.throws(()=>validateEvidence({...completion,...change},training,{},provenance));
  for(const change of [{candidates:[]},{onnxParity:1},{onnxSha256:'c'.repeat(64)},{validation:{images:0}},{onnxCheckerPassed:false}])assert.throws(()=>validateEvidence(completion,{...training,...change},{},provenance));
  assert.throws(()=>validateEvidence(completion,training,{}, {...provenance,startingWeights:'unknown_external_weights'}),/lineage/);
});
test('independent test evidence must bind the same model/dataset; validation is not a real evaluation',()=>{
  assert.equal(validateEvidence(completion,training,{},provenance).realEvaluation,'not_established');
  assert.throws(()=>validateEvidence({...completion,evaluationScope:'independent_synthetic_test'},training,{v3:{images:24},v3WeightsSha256:'wrong'},provenance),/binding/);
});
test('model IDs and registry locations cannot escape or enter public model assets',()=>{
  assert.equal(validModelId('stairs-v3-abc'),true);
  for(const id of ['../model','x/y','X','a'.repeat(100)])assert.equal(validModelId(id),false);
  assert.throws(()=>registryPath(resolve('client/public/research-models')),/publishable/);
  assert.throws(()=>registryPath(resolve('dist/public/research-models')),/publishable/);
});
test('incomplete releases are hidden and changed bytes fail integrity',async()=>{
  const root=await mkdtemp(resolve('.vision-ai/registry-unit-'));
  try{
    const folder=resolve(root,'test-only');await mkdir(folder);
    assert.deepEqual(await listRegistered(root),[]);
    const model=Buffer.from('transport-only fixture, never used for inference');
    const entry={researchOnly:true,productionEnabled:false,sha256:hash(model),input:{name:'image',shape:[1,3,160,160],color:'RGB',range:[0,1],resize:'letterbox',padValue:127},outputs:['presence_logits','direction_logits','box_xywh']};
    const entryBytes=Buffer.from(JSON.stringify(entry));await writeFile(resolve(folder,'model.onnx'),model);await writeFile(resolve(folder,'entry.json'),entryBytes);
    await writeFile(resolve(folder,'release.json'),JSON.stringify({id:'test-only',scope:'basira-experimental-display-only',researchOnly:true,productionEligible:false,navigationEnabled:false,
      modelSha256:hash(model),entrySha256:hash(entryBytes),validation:{status:'verified',modelSha256:hash(model),checkerPassed:true,cpuInferencePassed:true}}));
    assert.equal((await verifyRegistered(root,'test-only')).manifest.id,'test-only');
    await writeFile(resolve(folder,'model.onnx'),'changed');await assert.rejects(()=>verifyRegistered(root,'test-only'),/hash mismatch/);assert.deepEqual(await listRegistered(root),[]);
  }finally{await cleanup(root);}
});
test('completion without artifact bindings cannot register an arbitrary model',async()=>{
  const root=await mkdtemp(resolve('.vision-ai/completion-unit-'));
  try{const path=resolve(root,'invalid.completion.json');await writeFile(path,JSON.stringify({...completion,id:'invalid'}));await assert.rejects(()=>registerCompletion(path,{root:resolve(root,'registry')}),/artifact evidence/);}
  finally{await cleanup(root);}
});
