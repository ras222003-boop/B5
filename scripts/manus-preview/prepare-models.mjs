/** Explicit allowlist: published Apache-2.0 Tiny + clean V3, notices retained. Never a dataset upload. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PINNED } from "./pins.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
// Preserve required public author/source attributions, redact local machine paths from research metadata.
const publicMetadata = value => {
  if (typeof value === "string")
    return /^(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|tmp|mnt)\/)/i.test(value)
      ? "[local artifact path redacted]"
      : value;
  if (Array.isArray(value)) return value.map(publicMetadata);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, publicMetadata(v)])
    );
  return value;
};
export async function prepareModels(source, destination, sourceCommit) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("A pinned source commit is required");
  const files = [],
    models = [];
  // Read and verify every byte BEFORE creating the destination. No directories from source are copied recursively.
  const pending = [];
  for (const [id, folder] of [
    ["objects-yolox-tiny", ""],
    ["objects-basira-v3", "finetuned-v3/"],
  ]) {
    const p = JSON.parse(
      await readFile(resolve(source, folder + "manifest.json"), "utf8")
    );
    if (
      p.id !== id ||
      p.modelSha256 !== PINNED[id] ||
      p.maskForStills !== false ||
      p.navigationEligible !== false ||
      p.productionEligible !== false ||
      p.humanApproval !== false ||
      p.researchOnlyData === true
    )
      throw Error("Restricted or changed model rejected");
    if (!String(p.licence ?? p.licences?.yolox ?? "").includes("Apache-2.0"))
      throw Error("Missing publisher grant");
    const paths =
      id === "objects-yolox-tiny"
        ? ["yolox/yolox_tiny.onnx", "yolox/LICENSE", "yolox/README.md"]
        : [
            "yolox/yolox_tiny.onnx",
            "yolox/LICENSE",
            "yolox/LICENSE-YCB",
            "yolox/LINEAGE.json",
            "yolox/DATA-ATTRIBUTIONS.json",
          ];
    for (const path of paths) {
      const bytes = await readFile(resolve(source, folder + path)),
        entry = p.assets[path];
      if (!entry || sha(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
        throw Error("Asset/notice fingerprint mismatch");
      if (
        path.endsWith("/LICENSE") &&
        !bytes.includes(Buffer.from("Apache License"))
      )
        throw Error("Wrong publisher licence");
      pending.push({ path: folder + path, bytes });
    }
    const clean = {
      ...p,
      assets: Object.fromEntries(paths.map(path => [path, p.assets[path]])),
    };
    if (id === "objects-basira-v3") {
      const lineage = JSON.parse(
        pending
          .find(x => x.path === folder + "yolox/LINEAGE.json")
          .bytes.toString()
      );
      if (
        lineage.usedRestrictedSources !== false ||
        lineage.usedV1OrV2WeightsOrTeacher !== false ||
        lineage.commercialTrainingAllowed !== true ||
        lineage.modelSha256 !== PINNED[id] ||
        lineage.initialTinySha256 !==
          "9de513de589ac98bb92d3bca53b5af7b9acfa9b0bacb831f7999d0f7afaee8f0"
      )
        throw Error("Unclean V3 lineage");
      const knowledge = await readFile(
        resolve(source, folder + "basira-knowledge.json")
      );
      if (
        sha(knowledge) !== p.knowledgeSha256 ||
        sha(
          pending.find(x => x.path === folder + "yolox/LINEAGE.json").bytes
        ) !== p.lineageEvidenceSha256
      )
        throw Error("Lineage/knowledge mismatch");
      pending.push({
        path: folder + "basira-knowledge.json",
        bytes: Buffer.from(
          JSON.stringify(
            {
              ...publicMetadata(JSON.parse(knowledge.toString())),
              previewLocalPathsRedacted: true,
            },
            null,
            2
          )
        ),
      });
      clean.knowledgeSha256 = sha(pending.at(-1).bytes);
    }
    pending.push({
      path: folder + "manifest.json",
      bytes: Buffer.from(JSON.stringify(clean, null, 2)),
    });
    models.push({
      id,
      sha256: PINNED[id],
      publisherGrant: "Apache-2.0",
      upstreamPretrainingPhotosReaudited: false,
      productionApproved: false,
    });
  }
  await mkdir(destination); // Never overwrite a previous admission.
  for (const item of pending) {
    await mkdir(dirname(resolve(destination, item.path)), { recursive: true });
    await writeFile(resolve(destination, item.path), item.bytes, {
      flag: "wx",
    });
    files.push({
      path: item.path,
      bytes: item.bytes.length,
      sha256: sha(item.bytes),
    });
  }
  const admission = {
    schemaVersion: 1,
    sourceCommit,
    models,
    files,
    maskModelsIncluded: false,
    restrictedModelsIncluded: false,
    privateMediaIncluded: false,
    trainingDataIncluded: false,
    usage:
      "Isolated research preview; source grants are not production, phone, colour or navigation qualification.",
  };
  await writeFile(
    resolve(destination, "preview-admission.json"),
    JSON.stringify(admission, null, 2),
    { flag: "wx" }
  );
  return admission;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [source, out, commit] = process.argv.slice(2);
  if (!source || !out)
    throw Error(
      "Usage: prepare-models.mjs <local-registry> <new-private-output> <commit>"
    );
  const result = await prepareModels(resolve(source), resolve(out), commit);
  console.log(
    JSON.stringify({
      models: result.models,
      bytes: result.files.reduce((a, b) => a + b.bytes, 0),
      privateMediaIncluded: false,
      uploaded: false,
    })
  );
}
