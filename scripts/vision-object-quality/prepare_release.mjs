/** Local opt-in assets only, outside public/build. Never promotes a production model. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(
    process.argv[2] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  out = resolve(".vision-ai/object-quality");
const json = async p => JSON.parse(await readFile(p, "utf8")),
  hash = b => createHash("sha256").update(b).digest("hex");
const selection = await json(resolve(root, "selection-lock.json")),
  evaluation = await readFile(resolve(root, "validation-evaluation.json")),
  masks = await json(resolve(root, "validation-mask-evaluation.json")),
  sources = await json(resolve(root, "assets/assets.json"));
const finalMasks = await json(resolve(root, "test-mask-evaluation.json"));
const maskContract = await json(resolve(root, "mask-contract-audit.json"));
if (
  selection.cameraModel !== "yolox-tiny" ||
  selection.threshold !== 0.5 ||
  selection.validationEvaluationSha256 !== hash(evaluation)
)
  throw new Error("Validation selection mismatch");
const assets = {};
for (const record of sources.records) {
  if (!record.path.startsWith("yolox/") && !record.path.startsWith("slimsam/"))
    continue;
  if (record.path === "yolox/yolox_nano.onnx") continue;
  const bytes = await readFile(resolve(root, "assets", record.path));
  if (hash(bytes) !== record.sha256)
    throw new Error("Source weights/licence changed");
  const path = resolve(out, record.path);
  await mkdir(dirname(path), { recursive: true });
  await copyFile(resolve(root, "assets", record.path), path);
  assets[record.path] = { sha256: record.sha256, bytes: bytes.length };
}
const profile = {
  id: "objects-yolox-tiny",
  name: "YOLOX-Tiny — أشياء وألوان تجريبية",
  model: "yolox-tiny",
  modelSha256: assets["yolox/yolox_tiny.onnx"].sha256,
  threshold: selection.threshold,
  navigationEligible: false,
  productionEligible: false,
  humanApproval: false,
  maskForStills:
    maskContract.deploymentAllowed === true &&
    masks.photoMaskEligible &&
    finalMasks.photoMaskEligible,
  maskModel: "slimsam-q8",
  validationSha256: hash(evaluation),
  assets,
  maskContractStatus: "POINT_PROMPTS_ONLY_UNQUALIFIED",
  maskQualification: finalMasks.photoMaskEligible
    ? "QUALIFIED_STILLS_ONLY"
    : "REJECTED_FINAL",
  colorStatus: "UNPROVEN",
  maskFinalEvidenceSha256: hash(
    await readFile(resolve(root, "test-mask-evaluation.json"))
  ),
  qualification:
    "desktop validation only; iPhone and human colour accuracy unproven; final mask failure vetoes deployment without retuning the final test",
  licences: {
    yolox: "Apache-2.0 official publisher release linked by repository",
    slimsam:
      "Apache-2.0 pinned ONNX model-card revision " + sources.slimSamRevision,
  },
};
const validated = JSON.parse(evaluation).models[selection.cameraModel],
  audit = await json(resolve(root, "onnx-assets-audit.json"));
const checked = audit.records.find(
  r => r.file === "assets/yolox/yolox_tiny.onnx"
);
if (
  validated.modelSha256 !== profile.modelSha256 ||
  checked?.sha256 !== profile.modelSha256 ||
  checked.checkerPassed !== true ||
  JSON.stringify(checked.inputs.images) !== "[1,3,416,416]" ||
  JSON.stringify(checked.outputs.output) !== "[1,3549,85]"
)
  throw new Error("Release differs from validated/checker-tested model");
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(profile, null, 2)
);
console.log(
  JSON.stringify({
    root: out,
    id: profile.id,
    modelSha256: profile.modelSha256,
    maskForStills: profile.maskForStills,
    productionEligible: false,
  })
);
