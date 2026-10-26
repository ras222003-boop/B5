/** Freeze implementation and acceptance protocol BEFORE any final inference. No human approval or promotion is created. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]),
  hash = b => createHash("sha256").update(b).digest("hex"),
  cohort = JSON.parse(await readFile(resolve(root, "cohort-lock.json"))),
  audit = JSON.parse(await readFile(resolve(root, "cohort-audit.json")));
if (!audit.passed || !audit.images)
  throw Error("Nonempty audited independent cohort required");
const files = [
    "objectColors.ts",
    "objectColorEstimator.ts",
    "objectColorSpaces.ts",
    "colourAnnouncement.ts",
    "objectSpeech.ts",
    "objectSceneDescription.ts",
  ].map(f => "client/src/lib/vision/" + f),
  sourceHashes = {};
for (const f of files) sourceHashes[f] = hash(await readFile(f));
const lock = {
  sourceHashes,
  manifestSha256: cohort.manifestSha256,
  baselineSha256: hash(await readFile(resolve(root, "baseline-colours.mjs"))),
  frozenAtUtc: new Date().toISOString(),
  targetSelectiveAccuracy: 0.95,
  qualification: {
    minimumIndependentAcceptedRealReferences: 100,
    minimumSourceGroups: 20,
    reviewedLabelsRequired: true,
    indoorOutdoorAndReflectionCoverageRequired: true,
    syntheticOnlyQualificationForbidden: true,
    automaticSpeechEnabled: false,
  },
  meaning:
    "Final results are for reporting only; no model/threshold selection from this test. Published labels remain provisional until separately adjudicated. No training or human approval.",
};
await writeFile(
  resolve(root, "selection-lock.json"),
  JSON.stringify(lock, null, 2),
  { flag: "wx" }
);
console.log(
  JSON.stringify({
    frozen: true,
    sourceFiles: files.length,
    cohortSha256: cohort.manifestSha256,
    colourSpeechQualified: false,
  })
);
