import { afterEach, describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { objectQualityHandler } from "./objectQuality";
import { validObjectQualityProfile } from "../shared/objectQuality";
const base = resolve(".vision-ai");
let root: string | undefined;
afterEach(async () => {
  if (root) {
    if (dirname(root) !== base) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});
async function fixture() {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(resolve(base, "object-quality-test-"));
  await mkdir(resolve(root, "yolox"));
  const bytes = Buffer.from("unit-test model bytes, not an inference artifact"),
    sha = createHash("sha256").update(bytes).digest("hex");
  const profile = {
    id: "objects-yolox-tiny",
    name: "test only",
    model: "yolox-tiny",
    threshold: 0.5,
    modelSha256: sha,
    navigationEligible: false,
    productionEligible: false,
    humanApproval: false,
    maskForStills: false,
    maskModel: "slimsam-q8",
    maskQualification: "REJECTED_FINAL",
    colorStatus: "UNPROVEN",
    validationSha256: "a".repeat(64),
    assets: { "yolox/yolox_tiny.onnx": { sha256: sha, bytes: bytes.length } },
  };
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(profile));
  await writeFile(resolve(root, "yolox/yolox_tiny.onnx"), bytes);
  return root;
}
async function request(
  handler: ReturnType<typeof objectQualityHandler>,
  url: string,
  changes: Record<string, unknown> = {}
) {
  const result = {
    status: 200,
    body: "",
    headers: {} as Record<string, string>,
  };
  const req = {
    url,
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:4350" },
    ...changes,
  } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      result.headers[k] = v;
    },
    set statusCode(n: number) {
      result.status = n;
    },
    end: (v: unknown) => {
      result.body = String(v ?? "");
    },
  } as unknown as Response;
  await handler(req, res, (() => {}) as NextFunction);
  return result;
}
describe("local research model boundary", () => {
  it("rejects a renamed restricted V3 lineage and keeps Tiny available", async () => {
    const root = await fixture(), handler = objectQualityHandler({enabled:true,root});
    const baseProfile = JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8"));
    const folder = resolve(root,"finetuned-v3"); await mkdir(resolve(folder,"yolox"),{recursive:true});
    const lineage = {modelSha256:baseProfile.modelSha256,initialTinySha256:"9de513de589ac98bb92d3bca53b5af7b9acfa9b0bacb831f7999d0f7afaee8f0",
      usedRestrictedSources:false,usedV1OrV2WeightsOrTeacher:false,commercialTrainingAllowed:true};
    const bytes = Buffer.from(JSON.stringify(lineage));
    const profile = {...baseProfile,id:"objects-basira-v3",inputSize:640,threshold:.65,
      commercialTrainingAllowed:true,knowledgeSha256:"b".repeat(64),
      lineageEvidenceSha256:createHash("sha256").update(bytes).digest("hex"),
      trainingEvidence:{checkpointSha256:"c".repeat(64),optimizerSteps:1,epochs:1,onnxValidationSha256:"d".repeat(64),testEvaluationSha256:"e".repeat(64),finalUsedForSelection:false}};
    expect(validObjectQualityProfile(profile)).toBe(true);
    expect(validObjectQualityProfile({...profile,researchOnlyData:true})).toBe(false);
    expect(validObjectQualityProfile({...profile,maskForStills:true,maskQualification:"QUALIFIED_STILLS_ONLY"})).toBe(false);
    await writeFile(resolve(folder,"manifest.json"),JSON.stringify(profile));
    let result=JSON.parse((await request(handler,"/api/vision/object-quality/manifest")).body);
    expect(result.profiles.map((p:{id:string})=>p.id)).toEqual(["objects-yolox-tiny"]);
    await writeFile(resolve(folder,"yolox/LINEAGE.json"),bytes);
    result=JSON.parse((await request(handler,"/api/vision/object-quality/manifest")).body);
    expect(result.profiles.map((p:{id:string})=>p.id)).toContain("objects-basira-v3");
    const restricted=Buffer.from(JSON.stringify({...lineage,usedV1OrV2WeightsOrTeacher:true}));
    await writeFile(resolve(folder,"yolox/LINEAGE.json"),restricted);
    await writeFile(resolve(folder,"manifest.json"),JSON.stringify({...profile,lineageEvidenceSha256:createHash("sha256").update(restricted).digest("hex")}));
    result=JSON.parse((await request(handler,"/api/vision/object-quality/manifest")).body);
    expect(result.profiles.map((p:{id:string})=>p.id)).toEqual(["objects-yolox-tiny"]);
  });
  it("serves hash-bound Basira knowledge and rejects V2 without its research/knowledge evidence", async () => {
    const root = await fixture(),
      handler = objectQualityHandler({ enabled: true, root });
    const original = JSON.parse(
      await readFile(resolve(root, "manifest.json"), "utf8")
    );
    const knowledge = Buffer.from(
      JSON.stringify({ name: "معرفة بصيرة", unitFixture: true, models: [] })
    );
    const knowledgeSha256 = createHash("sha256")
      .update(knowledge)
      .digest("hex");
    const profile = {
      ...original,
      id: "objects-basira-v2",
      name: "unit V2",
      researchOnlyData: true,
      knowledgeSha256,
      trainingEvidence: {
        checkpointSha256: "b".repeat(64),
        optimizerSteps: 79,
        epochs: 1,
        onnxValidationSha256: "c".repeat(64),
        testEvaluationSha256: "d".repeat(64),
        finalUsedForSelection: false,
      },
    };
    expect(validObjectQualityProfile(profile)).toBe(true);
    expect(
      validObjectQualityProfile({ ...profile, researchOnlyData: false })
    ).toBe(false);
    expect(
      validObjectQualityProfile({ ...profile, knowledgeSha256: undefined })
    ).toBe(false);
    expect(
      validObjectQualityProfile({
        ...profile,
        maskForStills: true,
        maskQualification: "QUALIFIED_STILLS_ONLY",
      })
    ).toBe(false);
    await mkdir(resolve(root, "finetuned-v2/yolox"), { recursive: true });
    await writeFile(
      resolve(root, "finetuned-v2/manifest.json"),
      JSON.stringify(profile)
    );
    await writeFile(
      resolve(root, "finetuned-v2/basira-knowledge.json"),
      knowledge
    );
    const listed = JSON.parse(
      (await request(handler, "/api/vision/object-quality/manifest")).body
    );
    expect(listed.profiles.map((p: { id: string }) => p.id)).toEqual([
      "objects-yolox-tiny",
      "objects-basira-v2",
    ]);
    const path = "/api/vision/object-quality/knowledge";
    expect((await request(handler, path)).body).toBe(knowledge.toString());
    expect(
      (await request(handler, path, { headers: { host: "evil.example" } }))
        .status
    ).toBe(403);
    await writeFile(
      resolve(root, "finetuned-v2/basira-knowledge.json"),
      "tampered"
    );
    expect((await request(handler, path)).status).toBe(503);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(200);
  });
  it("requires actual-training evidence for the extra model, isolates its bytes, and preserves the previous profile", async () => {
    const root = await fixture(),
      handler = objectQualityHandler({ enabled: true, root });
    const original = JSON.parse(
      await readFile(resolve(root, "manifest.json"), "utf8")
    );
    const bytes = Buffer.from(
      "unit fixture for trained registry, not actual inference weights"
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    const trained = {
      ...original,
      id: "objects-basira-v1",
      name: "test trained profile",
      modelSha256: digest,
      assets: {
        "yolox/yolox_tiny.onnx": { sha256: digest, bytes: bytes.length },
      },
      trainingEvidence: {
        checkpointSha256: "b".repeat(64),
        optimizerSteps: 8,
        epochs: 2,
        onnxValidationSha256: "c".repeat(64),
        testEvaluationSha256: "d".repeat(64),
        finalUsedForSelection: false,
      },
    };
    await mkdir(resolve(root, "finetuned/yolox"), { recursive: true });
    await writeFile(
      resolve(root, "finetuned/manifest.json"),
      JSON.stringify(trained)
    );
    await writeFile(resolve(root, "finetuned/yolox/yolox_tiny.onnx"), bytes);
    expect(validObjectQualityProfile(trained)).toBe(true);
    expect(
      validObjectQualityProfile({
        ...trained,
        maskForStills: true,
        maskQualification: "QUALIFIED_STILLS_ONLY",
      })
    ).toBe(false);
    expect(
      validObjectQualityProfile({
        ...trained,
        trainingEvidence: { ...trained.trainingEvidence, optimizerSteps: 0 },
      })
    ).toBe(false);
    const listed = JSON.parse(
      (await request(handler, "/api/vision/object-quality/manifest")).body
    );
    expect(listed.profile.id).toBe("objects-yolox-tiny");
    expect(listed.profiles.map((p: { id: string }) => p.id)).toEqual([
      "objects-yolox-tiny",
      "objects-basira-v1",
    ]);
    const path =
      "/api/vision/object-quality/models/objects-basira-v1/assets/yolox/yolox_tiny.onnx";
    expect((await request(handler, path)).body).toBe(bytes.toString());
    await writeFile(
      resolve(root, "finetuned/yolox/yolox_tiny.onnx"),
      "tampered"
    );
    expect((await request(handler, path)).status).toBe(503);
    trained.trainingEvidence.optimizerSteps = 0;
    await writeFile(
      resolve(root, "finetuned/manifest.json"),
      JSON.stringify(trained)
    );
    expect(
      JSON.parse(
        (await request(handler, "/api/vision/object-quality/manifest")).body
      ).profiles
    ).toHaveLength(1);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(200);
  });
  it("is disabled by default and rejects published asset roots", async () => {
    expect(
      JSON.parse(
        (
          await request(
            objectQualityHandler(),
            "/api/vision/object-quality/manifest"
          )
        ).body
      ).enabled
    ).toBe(false);
    expect(() =>
      objectQualityHandler({ root: resolve("client/public/quality") })
    ).toThrow("cannot be published");
  });
  it("checks origin, local socket, method and model identity", async () => {
    const root = await fixture(),
      handler = objectQualityHandler({ enabled: true, root });
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          socket: { remoteAddress: "192.168.1.10" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          headers: { host: "127.0.0.1:4350", origin: "https://evil.example" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(handler, "/api/vision/object-quality/manifest", {
          method: "POST",
        })
      ).status
    ).toBe(405);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/../manifest.json"
        )
      ).status
    ).toBe(404);
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(200);
    await writeFile(resolve(root, "yolox/yolox_tiny.onnx"), "tampered");
    expect(
      (
        await request(
          handler,
          "/api/vision/object-quality/assets/yolox/yolox_tiny.onnx"
        )
      ).status
    ).toBe(503);
  });
});
