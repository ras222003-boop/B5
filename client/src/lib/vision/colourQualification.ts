/** Data-driven colour-speech release gate. It replaces a hand-edited empty class list with a rule that can be
 * re-run on sealed independent evidence. The bar is NOT lowered: a class becomes eligible only when its own
 * selective accuracy has a Wilson lower bound at or above the target on enough independent references. */
export interface ColourEvidenceClass {
  references: number;
  answered: number;
  correct: number;
}
export interface ColourEvidence {
  /** Independent references from a sealed, never-tuned test split. */
  references: number;
  sourceGroups: number;
  answered: number;
  correct: number;
  perClass: Record<string, ColourEvidenceClass>;
}
export interface ColourQualificationPolicy {
  minReferences: number;
  minSourceGroups: number;
  minClassReferences: number;
  minClassAnswered: number;
  targetLowerBound: number;
}
export const COLOUR_QUALIFICATION_POLICY: ColourQualificationPolicy =
  Object.freeze({
    minReferences: 100,
    minSourceGroups: 20,
    minClassReferences: 10,
    minClassAnswered: 8,
    targetLowerBound: 0.95,
  });
export interface ColourQualification {
  status: "UNQUALIFIED" | "PASSED";
  eligibleClasses: readonly string[];
  reasons: readonly string[];
}
export function wilsonLowerBound(correct: number, answered: number): number {
  if (!answered) return 0;
  const z = 1.96,
    p = correct / answered,
    d = 1 + (z * z) / answered,
    c = p + (z * z) / (2 * answered),
    m = z * Math.sqrt((p * (1 - p)) / answered + (z * z) / (4 * answered * answered));
  return (c - m) / d;
}
export function qualifyColourSpeech(
  evidence: ColourEvidence,
  policy: ColourQualificationPolicy = COLOUR_QUALIFICATION_POLICY
): ColourQualification {
  const reasons: string[] = [];
  if (evidence.references < policy.minReferences)
    reasons.push(`references ${evidence.references} < ${policy.minReferences}`);
  if (evidence.sourceGroups < policy.minSourceGroups)
    reasons.push(`source groups ${evidence.sourceGroups} < ${policy.minSourceGroups}`);
  const overall = wilsonLowerBound(evidence.correct, evidence.answered);
  if (overall < policy.targetLowerBound)
    reasons.push(
      `overall selective accuracy lower bound ${overall.toFixed(2)} < ${policy.targetLowerBound}`
    );
  const eligible = Object.entries(evidence.perClass)
    .filter(
      ([name, c]) =>
        name !== "person" &&
        name !== "synthetic" &&
        c.references >= policy.minClassReferences &&
        c.answered >= policy.minClassAnswered &&
        wilsonLowerBound(c.correct, c.answered) >= policy.targetLowerBound
    )
    .map(([name]) => name)
    .sort();
  if (!eligible.length) reasons.push("no class meets its own lower bound");
  return reasons.length
    ? { status: "UNQUALIFIED", eligibleClasses: [], reasons }
    : { status: "PASSED", eligibleClasses: eligible, reasons: [] };
}
