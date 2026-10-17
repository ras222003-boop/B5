import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { initStorage } from "../storage.mjs";
import { fileHash, readJson, taxonomyPath } from "../common.mjs";
import { unknownSpatial } from "../spatial.mjs";
import { passwordHash } from "./server.mjs";

export async function fixture(root, { images = 12, classes } = {}) {
  await initStorage(root);
  await mkdir(resolve(root, ".studio"));
  await mkdir(resolve(root, "incoming/demo"), { recursive: true });
  await mkdir(resolve(root, "incoming/demo/images"));
  await mkdir(resolve(root, "incoming/demo/rights"));
  await mkdir(resolve(root, "incoming/demo/videos"));
  await writeFile(
    resolve(root, ".studio/identities.json"),
    JSON.stringify({
      users: ["editor", "reviewer"].map(id => ({
        id,
        name: id === "editor" ? "محرر تجريبي" : "مراجع مستقل تجريبي",
        roles:
          id === "editor" ? ["annotator"] : ["rights", "privacy", "labels"],
        salt: "synthetic-fixture-salt",
        passwordHash: passwordHash(
          "synthetic-fixture-password",
          "synthetic-fixture-salt"
        ),
      })),
    })
  );
  await writeFile(
    resolve(root, "incoming/demo/rights/team.txt"),
    "SYNTHETIC ONLY. Test permission, not a real license or human attestation."
  );
  const taxonomy = await readJson(taxonomyPath),
    classIds = classes ?? [5, 2, 1, 3, 23, 24];
  const data = {
    schemaVersion: 1,
    id: "synthetic-studio-demo",
    contentKind: "synthetic",
    taxonomyVersion: taxonomy.version,
    annotationRevision: "demo-1",
    spatialPolicyVersion: "basira-proximity-experimental-1.0.0",
    motionSegments: [],
    sources: [
      {
        id: "synthetic-team",
        kind: "basira_team",
        origin: "synthetic controlled fixture",
        license: "synthetic-test-only",
        trainingAllowed: false,
        containsUserData: false,
        rightsReview: {
          status: "pending",
          reviewer: "",
          at: "",
          evidence: {
            path: "rights/team.txt",
            sha256: await fileHash(
              resolve(root, "incoming/demo/rights/team.txt")
            ),
          },
        },
      },
    ],
    samples: [],
  };
  for (let i = 0; i < images; i++) {
    const cls = classIds[i % classIds.length],
      n = String(i + 1).padStart(3, "0");
    const shapes = {
      5: '<rect x="130" y="220" width="365" height="120" rx="22" fill="#6a9084"/><path d="M200 220l50-90h125l70 90" fill="#486a63"/><circle cx="215" cy="340" r="34" fill="#223e37"/><circle cx="420" cy="340" r="34" fill="#223e37"/>',
      2: '<rect x="235" y="140" width="160" height="140" rx="10" fill="#d4a077"/><rect x="218" y="270" width="200" height="28" rx="6" fill="#af7c59"/><path d="M245 295v100m150-100v100" stroke="#684f40" stroke-width="16"/>',
      1: '<circle cx="315" cy="145" r="42" fill="#d6ad82"/><path d="M270 200h90v120h-90z" fill="#75959d"/><path d="M287 318v80m55-80v80m-70-190l-32 96m120-96l30 96" stroke="#3e6168" stroke-width="22" stroke-linecap="round"/>',
      3: '<rect x="155" y="220" width="330" height="28" rx="8" fill="#bda17e"/><path d="M185 250v130m270-130v130" stroke="#786953" stroke-width="19"/>',
      23: '<path d="M170 380v-55h70v-55h70v-55h70v-55h85v220z" fill="#a9b6a8"/><path d="M170 325h70m0-55h70m0-55h70m0-55h85" stroke="#738a7d" stroke-width="5"/>',
      24: '<path d="M70 300h500v65H70z" fill="#b6b3a3"/><path d="M70 300h500" stroke="#e3dbc6" stroke-width="18"/><path d="M170 310v42m110-42v42m110-42v42" stroke="#8d978c" stroke-width="3"/>',
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${i % 2 ? "#e2dfd0" : "#dfe8de"}"/><rect y="320" width="640" height="160" fill="#c7d5c5"/><path d="M0 430h640M90 320L10 480m540-160l80 160" stroke="#b8c7b4" stroke-width="2"/><circle cx="565" cy="70" r="34" fill="#f4e6b1"/>${shapes[cls]}<text x="24" y="40" fill="#52725c" font-family="sans-serif" font-size="16">SYNTHETIC • ${n}</text></svg>`;
    const path = `images/demo-${n}.png`;
    await sharp(Buffer.from(svg))
      .png()
      .toFile(resolve(root, "incoming/demo", path));
    data.samples.push({
      id: `demo-${n}`,
      path,
      sha256: await fileHash(resolve(root, "incoming/demo", path)),
      width: 640,
      height: 480,
      sourceId: "synthetic-team",
      leakageGroup: "synthetic-session-" + i,
      split: null,
      media: { kind: "image" },
      conditions: { lighting: "daylight", scene: "outdoor", motion: "static" },
      hardNegatives: [],
      privacy: {
        status: "pending",
        reviewer: "",
        at: "",
        faces: "unreviewed",
        plates: "unreviewed",
        personalText: "unreviewed",
        metadataStripped: false,
      },
      annotation: {
        status: "pending",
        annotator: "fixture-author",
        reviewer: "",
        exhaustive: false,
        objects: [
          {
            id: "object-" + i,
            classId: cls,
            box: [0.15, 0.18, 0.65, 0.68],
            trackId: null,
            occluded: false,
            truncated: false,
            groundContact: "unknown",
            spatial: unknownSpatial(),
          },
        ],
        surfaces: [],
      },
    });
  }
  // Keep fixture policy pinned to the real toolkit; synthetic content still cannot train.
  data.spatialPolicyVersion = (
    await readJson(resolve("ml/vision/proximity-policy.v1.json"))
  ).version;
  await writeFile(
    resolve(root, "incoming/demo/dataset.review.pending.json"),
    JSON.stringify(data, null, 2)
  );
  return data;
}
