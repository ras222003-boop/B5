import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const source=new URL('model-assets/metric-depth/model_fp32.onnx',root);
const destination=new URL('client/public/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/',root);
const expected='2e762752eb777176c94036ecd0003fee8dfee78784e1e80a8bc3aaf1075e8bc4';
const chunkSize=16*1024*1024;
const bytes=await readFile(source);
const digest=createHash('sha256').update(bytes).digest('hex');
if(digest!==expected)throw new Error(`Metric source checksum mismatch: ${digest}`);
await mkdir(destination,{recursive:true});
const parts=[];
for(let offset=0,index=0;offset<bytes.length;offset+=chunkSize,index++){
  const name=`model_fp32.part-${index}.bin`;
  const part=bytes.subarray(offset,Math.min(bytes.length,offset+chunkSize));
  await writeFile(new URL(name,destination),part);
  parts.push({file:name,bytes:part.length});
}
await writeFile(new URL('parts.json',destination),JSON.stringify({format:'basira-metric-onnx-parts-v1',totalBytes:bytes.length,sha256:digest,parts},null,2)+'\n');
console.log(`Split verified metric ONNX into ${parts.length} deployable parts (${bytes.length} bytes total)`);
