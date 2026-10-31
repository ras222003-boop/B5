/** Add the evaluation-only YOLOX-S profile to a preview deployment checkout. Nothing is pushed here.
 * - splits the pinned official ONNX into 5 MB transport parts (the Git host rejected large single pushes before)
 * - writes MODEL-PARTS-S.json and a generalised assemble-preview.mjs that rebuilds BOTH V3 and S during CI
 * - appends the profile to api/vision/object-quality/manifest (Tiny and V3 profiles untouched)
 * - records new files in SOURCE.json so verify-preview pins every byte
 * Usage: node add-yolox-s-delivery.mjs <deployment-checkout> <yolox_s.onnx> <evaluation-evidence.json>
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const [deployArg, modelArg, evidenceArg] = process.argv.slice(2);
const deploy = resolve(deployArg);
const sha = b => createHash("sha256").update(b).digest("hex");
const PIN = {
  bytes: 35858002,
  sha256: "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063",
};
const model = await readFile(resolve(modelArg));
if (model.length !== PIN.bytes || sha(model) !== PIN.sha256) throw Error("Model is not the pinned official YOLOX-S");
const evidence = await readFile(resolve(evidenceArg));
const target = "api/vision/object-quality/models/objects-yolox-s/assets/yolox/yolox_s.onnx";

// 1. transport parts
await mkdir(resolve(deploy, ".delivery"), { recursive: true });
const parts = [];
for (let i = 0, n = 0; i < model.length; i += 5_000_000, n++) {
  const chunk = model.subarray(i, Math.min(model.length, i + 5_000_000)),
    path = `.delivery/ys-${String(n).padStart(2, "0")}.bin`;
  await writeFile(resolve(deploy, path), chunk);
  parts.push({ path, bytes: chunk.length, sha256: sha(chunk) });
}
await writeFile(
  resolve(deploy, "MODEL-PARTS-S.json"),
  JSON.stringify({ schemaVersion: 1, target, bytes: PIN.bytes, sha256: PIN.sha256, parts }, null, 2)
);

// 2. generalised assembly (V3 behaviour unchanged, S added)
await writeFile(
  resolve(deploy, "assemble-preview.mjs"),
  `import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex'),p=JSON.parse(await readFile('SOURCE.json'));
const PINS=[['MODEL-PARTS.json','api/vision/object-quality/models/objects-basira-v3/assets/yolox/yolox_tiny.onnx','1f0e088797c8792329c0270151fc375193158f5406a94c9c214cfb3d72e54a38',20258925,/^\\.delivery\\/v3-\\d{2}\\.bin$/],
 ['MODEL-PARTS-S.json','${target}','${PIN.sha256}',${PIN.bytes},/^\\.delivery\\/ys-\\d{2}\\.bin$/]];
const assembled=[];
for(const [file,target,sha,bytes,pattern] of PINS){const m=JSON.parse(await readFile(file));
if(m.target!==target||m.sha256!==sha||m.bytes!==bytes)throw Error('Unqualified model transport');
const chunks=[];for(const r of m.parts){if(!pattern.test(r.path))throw Error('Invalid part');const b=await readFile(r.path);if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Changed transport part');chunks.push(b);}
const model=Buffer.concat(chunks);if(model.length!==m.bytes||hash(model)!==m.sha256)throw Error('ONNX reassembly mismatch');await mkdir(dirname(m.target),{recursive:true});
try{const prior=await readFile(m.target);if(hash(prior)!==m.sha256)throw Error('Refuse to replace an existing different model');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(m.target,model,{flag:'wx'});}
assembled.push(hash(model));}
await mkdir('dist');for(const r of p.files){const b=await readFile(r.path);if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Changed runtime file');await mkdir(dirname(resolve('dist',r.path)),{recursive:true});await copyFile(r.path,resolve('dist',r.path));}
for(const name of ['README.md','SOURCE.json'])await copyFile(name,resolve('dist',name));
const notices=JSON.parse(await readFile('third-party-notices/catalog.json'));await mkdir('dist/third-party-notices');for(const r of notices.entries){if(!/^[a-zA-Z0-9_.-]+$/.test(r.file))throw Error('Invalid notice');const b=await readFile('third-party-notices/'+r.file);if(hash(b)!==r.sha256)throw Error('Changed licence notice');await copyFile('third-party-notices/'+r.file,'dist/third-party-notices/'+r.file);}await copyFile('third-party-notices/catalog.json','dist/third-party-notices/catalog.json');
console.log(JSON.stringify({assembledModelSha256:assembled,verifiedRuntimeFiles:p.files.length,transportPartsPublished:false,iphoneTested:false}));
`
);

// 3. licence file and evaluation evidence travel with the model
const licence = await readFile(resolve(deploy, "api/vision/object-quality/assets/yolox/LICENSE"));
const licencePath = "api/vision/object-quality/models/objects-yolox-s/assets/yolox/LICENSE";
await mkdir(dirname(resolve(deploy, licencePath)), { recursive: true });
await writeFile(resolve(deploy, licencePath), licence);
const evidencePath = "model-notices/yolox-s-evaluation.json";
await mkdir(resolve(deploy, "model-notices"), { recursive: true });
await writeFile(resolve(deploy, evidencePath), evidence);

// 4. profile in the manifest
const manifestPath = resolve(deploy, "api/vision/object-quality/manifest");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.profiles = manifest.profiles.filter(x => x.id !== "objects-yolox-s");
manifest.profiles.push({
  id: "objects-yolox-s",
  name: "YOLOX-S 640 — كشف أدق وأبطأ (تجريبي)",
  model: "yolox-s",
  modelSha256: PIN.sha256,
  threshold: 0.5,
  inputSize: 640,
  navigationEligible: false,
  productionEligible: false,
  humanApproval: false,
  maskForStills: false,
  maskModel: "slimsam-q8",
  maskQualification: "REJECTED_FINAL",
  colorStatus: "UNPROVEN",
  validationSha256: sha(evidence),
  assets: {
    "yolox/yolox_s.onnx": { sha256: PIN.sha256, bytes: PIN.bytes },
    "yolox/LICENSE": { sha256: sha(licence), bytes: licence.length },
  },
});
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
await writeFile(manifestPath, manifestBytes);

// 5. pin everything in SOURCE.json
const source = JSON.parse(await readFile(resolve(deploy, "SOURCE.json"), "utf8"));
const upsert = (path, bytes, hash) => {
  source.files = source.files.filter(r => r.path !== path);
  source.files.push({ path, bytes, sha256: hash });
};
upsert("api/vision/object-quality/manifest", manifestBytes.length, sha(manifestBytes));
upsert(licencePath, licence.length, sha(licence));
upsert(evidencePath, evidence.length, sha(evidence));
upsert(target, PIN.bytes, PIN.sha256);
source.files.sort((a, b) => a.path.localeCompare(b.path));
source.bytes = source.files.reduce((n, r) => n + r.bytes, 0);
await writeFile(resolve(deploy, "SOURCE.json"), JSON.stringify(source, null, 2));
console.log(JSON.stringify({ parts: parts.length, profileValidationSha256: sha(evidence), files: source.files.length }));
