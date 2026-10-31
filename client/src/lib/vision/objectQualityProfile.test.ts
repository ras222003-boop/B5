import { describe, it, expect } from "vitest";
import { validObjectQualityProfile } from "@shared/objectQuality";

const sha = (c: string) => c.repeat(64);
const base = {
  navigationEligible: false,
  productionEligible: false,
  humanApproval: false,
  maskForStills: false,
  maskModel: "slimsam-q8",
  maskQualification: "REJECTED_FINAL",
  colorStatus: "UNPROVEN",
  validationSha256: sha("a"),
};
const small = {
  ...base,
  id: "objects-yolox-s",
  name: "YOLOX-S 640 — كشف أدق وأبطأ (تجريبي)",
  model: "yolox-s",
  modelSha256: sha("b"),
  threshold: 0.5,
  inputSize: 640,
  assets: { "yolox/yolox_s.onnx": { sha256: sha("b"), bytes: 35858002 } },
};
describe("YOLOX-S experimental profile contract", () => {
  it("accepts the evaluation-only YOLOX-S profile at 640", () => {
    expect(validObjectQualityProfile(small)).toBe(true);
    expect(validObjectQualityProfile({ ...small, threshold: 0.35 })).toBe(true);
  });
  it("never grants navigation, production or human approval", () => {
    for (const key of ["navigationEligible", "productionEligible", "humanApproval"])
      expect(validObjectQualityProfile({ ...small, [key]: true })).toBe(false);
  });
  it("rejects a wrong input size, threshold, model name or mismatched asset hash", () => {
    expect(validObjectQualityProfile({ ...small, inputSize: 416 })).toBe(false);
    expect(validObjectQualityProfile({ ...small, threshold: 0.65 })).toBe(false);
    expect(validObjectQualityProfile({ ...small, model: "yolox-tiny" })).toBe(false);
    expect(
      validObjectQualityProfile({ ...small, assets: { "yolox/yolox_s.onnx": { sha256: sha("c"), bytes: 1 } } })
    ).toBe(false);
    expect(
      validObjectQualityProfile({ ...small, assets: { "yolox/yolox_tiny.onnx": { sha256: sha("b"), bytes: 1 } } })
    ).toBe(false);
  });
  it("still validates the original Tiny profile unchanged", () => {
    const tiny = {
      ...base,
      id: "objects-yolox-tiny",
      name: "YOLOX-Tiny",
      model: "yolox-tiny",
      modelSha256: sha("d"),
      threshold: 0.5,
      assets: { "yolox/yolox_tiny.onnx": { sha256: sha("d"), bytes: 20219662 } },
    };
    expect(validObjectQualityProfile(tiny)).toBe(true);
  });
});
