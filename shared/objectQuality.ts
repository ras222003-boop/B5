/** Local experimental object recognition. This contract never grants navigation eligibility. */
export interface ObjectQualityProfile {
  id: "objects-yolox-tiny";
  name: string;
  model: "yolox-tiny";
  modelSha256: string;
  threshold: number;
  navigationEligible: false;
  productionEligible: false;
  humanApproval: false;
  maskForStills: boolean;
  maskModel: "slimsam-q8";
  validationSha256: string;
  maskQualification: "REJECTED_FINAL" | "QUALIFIED_STILLS_ONLY";
  colorStatus: "UNPROVEN";
  assets: Record<string, { sha256: string; bytes: number }>;
}
export function validObjectQualityProfile(
  value: unknown
): value is ObjectQualityProfile {
  const p = value as ObjectQualityProfile | undefined;
  return Boolean(
    p &&
      p.id === "objects-yolox-tiny" &&
      p.model === "yolox-tiny" &&
      p.navigationEligible === false &&
      p.productionEligible === false &&
      p.humanApproval === false &&
      typeof p.name === "string" &&
      p.name.length > 0 &&
      p.name.length <= 100 &&
      /^[a-f0-9]{64}$/.test(p.validationSha256) &&
      p.colorStatus === "UNPROVEN" &&
      typeof p.maskForStills === "boolean" &&
      p.maskModel === "slimsam-q8" &&
      (p.maskForStills
        ? p.maskQualification === "QUALIFIED_STILLS_ONLY"
        : p.maskQualification === "REJECTED_FINAL") &&
      p.threshold === 0.5 &&
      /^[a-f0-9]{64}$/.test(p.modelSha256) &&
      p.assets?.["yolox/yolox_tiny.onnx"]?.sha256 === p.modelSha256
  );
}
