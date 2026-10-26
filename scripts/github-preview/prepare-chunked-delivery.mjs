/** Small transport chunks, exact original ONNX assembled and checked in the isolated Pages workflow. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile),
  [checkoutArg, baseCommit] = process.argv.slice(2),
  cwd = resolve(checkoutArg),
  git = async (args, extra = {}) =>
    (
      await run("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        ...extra,
      })
    ).stdout.trim();
if (
  (await git(["remote", "get-url", "origin"])) !==
    "https://github.com/ras222003-boop/basira-iphone-research-preview.git" ||
  !/^[a-f0-9]{40}$/.test(baseCommit)
)
  throw Error("Explicit independent preview base required");
if (
  (await git(["ls-remote", "origin", "refs/heads/codex/preview"])).split(
    /\s/
  )[0] !== baseCommit
)
  throw Error("Remote advanced; inspect before recovery");
const hash = b => createHash("sha256").update(b).digest("hex"),
  target =
    "api/vision/object-quality/models/objects-basira-v3/assets/yolox/yolox_tiny.onnx",
  bytes = await readFile(resolve(cwd, target));
if (
  hash(bytes) !==
  "1f0e088797c8792329c0270151fc375193158f5406a94c9c214cfb3d72e54a38"
)
  throw Error("Qualified V3 model identity mismatch");
await mkdir(resolve(cwd, ".delivery"));
const parts = [];
for (let at = 0; at < bytes.length; at += 5_000_000) {
  const chunk = bytes.subarray(at, at + 5_000_000),
    path = ".delivery/v3-" + String(parts.length).padStart(2, "0") + ".bin";
  await writeFile(resolve(cwd, path), chunk, { flag: "wx" });
  parts.push({ path, bytes: chunk.length, sha256: hash(chunk) });
}
const transport = {
  schemaVersion: 1,
  target,
  bytes: bytes.length,
  sha256: hash(bytes),
  parts,
};
await writeFile(
  resolve(cwd, "MODEL-PARTS.json"),
  JSON.stringify(transport, null, 2),
  { flag: "wx" }
);
await writeFile(
  resolve(cwd, "assemble-preview.mjs"),
  `import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {createHash} from 'node:crypto';\nconst hash=b=>createHash('sha256').update(b).digest('hex'),m=JSON.parse(await readFile('MODEL-PARTS.json')),p=JSON.parse(await readFile('SOURCE.json'));\nif(m.target!=='${target}'||m.sha256!=='${hash(bytes)}'||m.bytes!==${bytes.length})throw Error('Unqualified model transport');\nconst chunks=[];for(const r of m.parts){if(!/^\\.delivery\\/v3-\\d{2}\\.bin$/.test(r.path))throw Error('Invalid part');const b=await readFile(r.path);if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Changed transport part');chunks.push(b);}\nconst model=Buffer.concat(chunks);if(model.length!==m.bytes||hash(model)!==m.sha256)throw Error('ONNX reassembly mismatch');await mkdir(dirname(m.target),{recursive:true});\ntry{const prior=await readFile(m.target);if(hash(prior)!==m.sha256)throw Error('Refuse to replace an existing different model');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(m.target,model,{flag:'wx'});}\nawait mkdir('dist');for(const r of p.files){const b=await readFile(r.path);if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Changed runtime file');await mkdir(dirname(resolve('dist',r.path)),{recursive:true});await copyFile(r.path,resolve('dist',r.path));}\nfor(const name of ['README.md','SOURCE.json'])await copyFile(name,resolve('dist',name));\nconst notices=JSON.parse(await readFile('third-party-notices/catalog.json'));await mkdir('dist/third-party-notices');for(const r of notices.entries){if(!/^[a-zA-Z0-9_.-]+$/.test(r.file))throw Error('Invalid notice');const b=await readFile('third-party-notices/'+r.file);if(hash(b)!==r.sha256)throw Error('Changed licence notice');await copyFile('third-party-notices/'+r.file,'dist/third-party-notices/'+r.file);}await copyFile('third-party-notices/catalog.json','dist/third-party-notices/catalog.json');\nconsole.log(JSON.stringify({assembledModelSha256:hash(model),verifiedRuntimeFiles:p.files.length,transportPartsPublished:false,iphoneTested:false}));\n`,
  { flag: "wx" }
);
const workflowPath = resolve(cwd, ".github/workflows/pages.yml"),
  workflow = await readFile(workflowPath, "utf8");
await writeFile(
  workflowPath,
  workflow
    .replace(
      "      - run: node verify-preview.mjs",
      "      - run: node assemble-preview.mjs\n      - run: node verify-preview.mjs"
    )
    .replace("path: '.'", "path: 'dist'")
);
const env = {
  ...process.env,
  GIT_INDEX_FILE: resolve(cwd, ".git/chunked-snapshot.index"),
};
await git(["read-tree", baseCommit], { env });
const add = [
  "MODEL-PARTS.json",
  "assemble-preview.mjs",
  ".github/workflows/pages.yml",
  ...parts.map(p => p.path),
  "assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm",
  "vision/onnx/ort-wasm-simd-threaded.jsep.wasm",
];
for (const path of add) {
  const sha = await git(["hash-object", "-w", path]);
  await git(
    ["update-index", "--add", "--cacheinfo", "100644," + sha + "," + path],
    { env }
  );
}
const tree = await git(["write-tree"], { env }),
  snapshot = await git([
    "-c",
    "commit.gpgsign=false",
    "commit-tree",
    tree,
    "-p",
    baseCommit,
    "-m",
    "Verified chunked model transport; exact ONNX assembled before Pages publication",
  ]);
await git(["branch", "codex/chunked-snapshot", snapshot]);
console.log(
  JSON.stringify({
    snapshot,
    tree,
    baseCommit,
    parts: parts.length,
    modelSha256: hash(bytes),
    rawOriginalPreserved: true,
  })
);
