/** Prepare a NEW deployment repository from a verified clean static build; no upload occurs here. */
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  appendFile,
} from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
const [rootArg, destinationArg, noticesArg] = process.argv.slice(2),
  root = resolve(rootArg),
  destination = resolve(destinationArg),
  receipt = JSON.parse(
    await readFile(resolve(root, "static-build-receipt.json"), "utf8")
  );
if (
  !receipt.publishable ||
  !receipt.sourceWasClean ||
  receipt.developmentBuild ||
  receipt.privateMediaIncluded !== false ||
  receipt.restrictedModelsIncluded !== false
)
  throw Error("Only a qualified clean build may be packaged");
if (!noticesArg)
  throw Error("Explicit reviewed third-party notice directory required");
const noticesRoot = resolve(noticesArg),
  notices = JSON.parse(
    await readFile(resolve(noticesRoot, "catalog.json"), "utf8")
  );
const requiredNotices = [
  "onnxruntime-MIT.txt",
  "mediapipe-Apache-2.0.txt",
  "tensorflow-models-Apache-2.0.txt",
  "react-LICENSE",
  "react-dom-LICENSE",
];
if (
  !Array.isArray(notices.entries) ||
  requiredNotices.some(name => !notices.entries.some(r => r.file === name))
)
  throw Error("Missing core runtime licence notice");
for (const row of notices.entries) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(row.file) || row.file === "catalog.json")
    throw Error("Invalid licence path");
  const b = await readFile(resolve(noticesRoot, row.file));
  if (
    b.length !== row.bytes ||
    createHash("sha256").update(b).digest("hex") !== row.sha256
  )
    throw Error("Changed licence notice");
}
const checked = [];
for (const row of receipt.files) {
  const file = resolve(root, "site", row.path),
    rel = relative(resolve(root, "site"), file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw Error("Invalid deployment path");
  const bytes = await readFile(file);
  if (
    bytes.length !== row.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== row.sha256
  )
    throw Error("Build changed after validation");
  checked.push(row.path);
}
await mkdir(destination);
await mkdir(resolve(destination, "third-party-notices"));
for (const row of notices.entries)
  await copyFile(
    resolve(noticesRoot, row.file),
    resolve(destination, "third-party-notices", row.file)
  );
await copyFile(
  resolve(noticesRoot, "catalog.json"),
  resolve(destination, "third-party-notices/catalog.json")
);
for (const path of checked) {
  await mkdir(dirname(resolve(destination, path)), { recursive: true });
  await copyFile(resolve(root, "site", path), resolve(destination, path));
}
await writeFile(
  resolve(destination, "SOURCE.json"),
  JSON.stringify(receipt, null, 2),
  { flag: "wx" }
);
await writeFile(resolve(destination, ".gitattributes"), "* -text\n", {
  flag: "wx",
});
await writeFile(
  resolve(destination, "README.md"),
  `# Basira independent iPhone research preview\n\nSource: https://github.com/ras222003-boop/B5/tree/${receipt.sourceCommit}\n\nThis repository serves the EXISTING Basira vision page as a static browser experiment, independent of https://basira-m7myneuo.manus.space. It is not the production platform, an examination/account service, or a navigation/fall-prevention system. No database, server AI, payment service, microphone recording or private-media upload endpoint exists. Browser POST/beacon/native transcription paths are disabled; camera input is processed locally. GitHub still receives ordinary static-site access logs.\n\nOpen the deployed site at its repository path with \`#/navigation/vision\`. Lite0 remains the default; Tiny and clean V3 require explicit selection. Model scores/colours and approach cues are experimental and uncalibrated; masks remain disabled. The browser preview has no native iPhone LiDAR bridge or native haptics. Safari does not support the Web Vibration API, so vibration behaviour must be tested in the signed iOS app on a real device. An iPhone/VoiceOver test must be performed by the device owner and is NOT claimed by the desktop software-media test.\n\nOnly publisher-granted Tiny and provenance-isolated V3 are included. Apache-2.0/YCB notices, training-source attributions and lineage are retained under the model API asset paths and model-notices/. No training images, protected tests, V1/V2/BDD/SegFormer/SlimSAM weights, credentials, local certificates or private logs are included. Source permission does not establish production, privacy, colour or navigation qualification.\n\nDeployment is manual via the Research Pages preview workflow; pushes do not deploy automatically. B5 main, the original Manus project, its domain and database are unchanged. SOURCE.json pins every built file and source commit.\n`,
  { flag: "wx" }
);
await mkdir(resolve(destination, ".github/workflows"), { recursive: true });
await writeFile(
  resolve(destination, ".github/workflows/pages.yml"),
  `name: Research Pages preview\non:\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\nconcurrency:\n  group: independent-research-pages\n  cancel-in-progress: false\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment:\n      name: github-pages\n      url: \${{ steps.deploy.outputs.page_url }}\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: node verify-preview.mjs\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: '.'\n      - id: deploy\n        uses: actions/deploy-pages@v4\n`,
  { flag: "wx" }
);
await writeFile(
  resolve(destination, "verify-preview.mjs"),
  `import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';\nconst p=JSON.parse(await readFile('SOURCE.json'));if(!p.publishable||p.developmentBuild||!p.sourceWasClean||p.privateMediaIncluded!==false||p.restrictedModelsIncluded!==false)throw Error('Unqualified preview');\nfor(const r of p.files){if(r.path.includes('..')||r.path.startsWith('/')||/\\\\|\\.env|\\.pem$|\\.key$|\\.pth$|\\.pt$|Xenova|onnx-community|slimsam/i.test(r.path))throw Error('Unqualified path');const b=await readFile(resolve(r.path));if(b.length!==r.bytes||createHash('sha256').update(b).digest('hex')!==r.sha256)throw Error('Changed preview file');}\nconsole.log(JSON.stringify({verifiedFiles:p.files.length,sourceCommit:p.sourceCommit,privateMediaIncluded:false,iphoneTested:false}));\n`,
  { flag: "wx" }
);
await appendFile(
  resolve(destination, "verify-preview.mjs"),
  `const notices=JSON.parse(await readFile('third-party-notices/catalog.json'));for(const r of notices.entries){if(!/^[a-zA-Z0-9_.-]+$/.test(r.file))throw Error('Invalid licence path');const b=await readFile('third-party-notices/'+r.file);if(b.length!==r.bytes||createHash('sha256').update(b).digest('hex')!==r.sha256)throw Error('Changed licence notice');}\n`
);
console.log(
  JSON.stringify({
    destination,
    sourceCommit: receipt.sourceCommit,
    verifiedFiles: checked.length,
    bytes: receipt.bytes,
    uploaded: false,
  })
);
