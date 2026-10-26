/** Publish metadata/aggregate evidence only. Never copies photos, masks, original licence HTML or user camera logs. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]),
  read = async p => JSON.parse(await readFile(p, "utf8")),
  hash = b => createHash("sha256").update(b).digest("hex");
const final = await read(resolve(root, "evaluation-test-frozen-final.json")),
  dev = await read(resolve(root, "evaluation-development-neutral-guard.json")),
  calibration = await read(
    resolve(root, "evaluation-calibration-fixed-policy.json")
  ),
  audit = await read(resolve(root, "cohort-audit.json")),
  manifest = await read(resolve(root, "manifest.json")),
  lock = await read(resolve(root, "selection-lock.json"));
const sourceHashesCanonical = {};
for (const f of Object.keys(final.sourceHashes)) {
  const bytes = await readFile(f);
  if (hash(bytes) !== final.sourceHashes[f])
    throw Error("Frozen colour implementation changed after final evaluation");
  sourceHashesCanonical[f] = hash(
    Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"))
  );
}
const stable = key =>
  final.synthetic.results
    .filter(r => r.variant === "contrast")
    .map(r => {
      const seq = r.sequence[key],
        first = seq.findIndex((o, i) => i > 6 && o.name);
      return {
        id: r.id,
        firstValidFrame: seq.findIndex(o => o.name),
        recoveryFramesAfterInjectedAmbiguity: first < 0 ? null : first - 6,
        nameChanges: seq.filter(
          (o, i) => i && o.name && seq[i - 1].name && o.name !== seq[i - 1].name
        ).length,
        acceptedFrames: seq.filter(o => o.name).length,
      };
    });
const priorMask = await read(
  resolve(root, "../vision-readiness-001/mask-evaluation-test-native-box.json")
);
const evidence = {
  schemaVersion: 1,
  status: "RESEARCH_REVIEW_ACCEPTANCE_NOT_MET",
  baseCommit: "e8393c3a78f5856e6130a9b8ece973748706580d",
  branch: "codex/basira-colour-quality-v3",
  generatedAtUtc: new Date().toISOString(),
  userReportedBaseline: {
    rawLogProvided: false,
    rawCameraPixelsProvided: false,
    durationMs: 7650,
    processedFrames: 12,
    effectiveFps: 1.57,
    medianInferenceMs: 206,
    colourObservations: 39,
    unclear: 32,
    estimates: 7,
    backgroundAmbiguity: 19,
    object2BlackConsecutiveEstimates: 7,
    referenceColourCorrectness: null,
    meaning: "User-supplied metadata; repetition is not independent accuracy.",
  },
  data: audit,
  sourceHashes: final.sourceHashes,
  sourceHashesCanonicalLf: sourceHashesCanonical,
  sourceHashMeaning:
    "Frozen local source byte hashes plus LF-canonical hashes for Git checkout portability; no algorithm change after final evaluation.",
  cohortSha256: final.cohortSha256,
  selectionProtocol: lock,
  development: { before: dev.before, after: dev.after },
  calibration: { before: calibration.before, after: calibration.after },
  final: {
    scope: final.scope,
    images: final.images,
    before: final.before,
    after: final.after,
    audio: final.audio,
    colourCpuMs: final.colourCpuMs,
    rows: final.rows,
  },
  synthetic: {
    scope: final.synthetic.scope,
    cases: final.synthetic.cases,
    knownColourCases: final.synthetic.knownColourCases,
    before: final.synthetic.before,
    after: final.synthetic.after,
    stressCases: final.synthetic.stressCases,
    stressEstimates: final.synthetic.stressEstimates,
    temporalBefore: stable("old"),
    temporalAfter: stable("candidate"),
  },
  maskRecommendation: {
    newModelLoaded: false,
    enabled: false,
    existingPublisher: "https://huggingface.co/nielsr/slimsam-77-uniform",
    recordedPublisherLicense: "Apache-2.0",
    priorLocalTest: {
      images: priorMask.images,
      acceptedMasks: priorMask.acceptedMatchedMasks,
      meanIoU: priorMask.meanAcceptedIoU,
      worstIoU: priorMask.worstAcceptedIoU,
      medianMs: priorMask.medianMs,
      p95Ms: priorMask.p95Ms,
      independentColourReferences: priorMask.humanColourReferences,
    },
    reason:
      "Prior mask geometry and desktop latency do not qualify body-colour accuracy or iPhone performance; instance masks do not by themselves separate glass, shadows or paint.",
  },
  coverageGaps: [
    "No newly adjudicated Basira real-colour references",
    "Insufficient final chair/bag/lighting/reflection coverage",
    "No eligible new red/white-car supplement candidates in the cached licence-verified source pool",
    "No new physical iPhone/Safari performance, battery or memory measurement",
    "Six final reference objects are insufficient for95% qualification",
  ],
  acceptance95Proven: false,
  modelTrainingPerformed: false,
  maskActivationPerformed: false,
  productionChanged: false,
  stairsV3Changed: false,
  imagesPublished: false,
  userMediaSaved: false,
  userMediaUploaded: false,
};
const out = resolve("docs/vision-ai-evidence/colour-quality-v3");
await mkdir(out, { recursive: true });
await writeFile(
  resolve(out, "results.json"),
  JSON.stringify(evidence, null, 2) + "\n"
);
const attribution = {
  attributeLicense: "CC-BY-4.0",
  attributeSource: manifest.attributeSource,
  attribution: manifest.attribution,
  photos: manifest.samples.map(r => ({
    imageId: r.id,
    author: r.author,
    source: r.source,
    licence: r.license,
    licenceEvidenceSha256: r.licenceEvidenceSha256,
    imageSha256: r.sha256,
    split: r.split,
  })),
  photosIncluded: false,
};
await writeFile(
  resolve(out, "DATA-ATTRIBUTIONS.json"),
  JSON.stringify(attribution, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    publishedAggregateEvidence: true,
    privateMediaIncluded: false,
    photos: manifest.samples.length,
    finalReferences: final.before.references,
    acceptance95Proven: false,
  })
);
