import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const asset=new URL('model-assets/metric-depth/model_fp32.onnx',root);
const partsBase=new URL('client/public/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/',root);
const report=JSON.parse(await readFile(new URL('docs/metric-depth-parity.json',root),'utf8'));
const expectedModel='2e762752eb777176c94036ecd0003fee8dfee78784e1e80a8bc3aaf1075e8bc4';
const expectedCheckpoint='b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545';
if(report.checkpoint_sha256!==expectedCheckpoint||report.fp32_sha256!==expectedModel||
   report.input_shape?.join(',')!=='1,3,392,392'||report.samples?.length!==5||
   report.samples.some(sample=>sample.fp32?.max_m>.001)){
  throw new Error('Metric checkpoint provenance or FP32 parity report changed');
}
const size=(await stat(asset)).size;
if(size<90_000_000||size>100_000_000)throw new Error(`Unexpected metric ONNX size: ${size}`);
const digest=createHash('sha256');
for await(const chunk of createReadStream(fileURLToPath(asset)))digest.update(chunk);
const actual=digest.digest('hex');
if(actual!==expectedModel)throw new Error(`Metric ONNX hash mismatch: ${actual}`);
const manifest=JSON.parse(await readFile(new URL('parts.json',partsBase),'utf8'));
if(manifest.format!=='basira-metric-onnx-parts-v1'||manifest.totalBytes!==size||
   manifest.sha256!==actual||manifest.parts?.length!==6)throw new Error('Invalid metric ONNX parts manifest');
const splitDigest=createHash('sha256');
let total=0;
for(const [index,part] of manifest.parts.entries()){
  if(part.file!==`model_fp32.part-${index}.bin`||part.bytes!==(index<5?16*1024*1024:size-5*16*1024*1024))
    throw new Error(`Invalid metric ONNX part ${index}`);
  const url=new URL(part.file,partsBase);
  if((await stat(url)).size!==part.bytes)throw new Error(`Metric ONNX part ${index} has incorrect size`);
  for await(const chunk of createReadStream(fileURLToPath(url)))splitDigest.update(chunk);
  total+=part.bytes;
}
if(total!==size||splitDigest.digest('hex')!==actual)throw new Error('Hosted ONNX slices differ from the verified FP32 original');
console.log(`Verified indoor metric ONNX FP32 and ${manifest.parts.length} deployable slices: ${size} bytes, SHA-256 ${actual}`);
