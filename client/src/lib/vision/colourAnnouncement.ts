import type { VisionDetection } from "@shared/vision";
import { colorDescription } from "./objectColors";
/** A release gate, not a preference or a detector-confidence threshold.
 * No shipped artifact yet passes independent, diverse real-colour qualification. */
export const COLOUR_SPEECH_QUALIFICATION = Object.freeze({
  status: "UNQUALIFIED" as "UNQUALIFIED" | "PASSED",
  policyId: "colour-v3-inset-grid-v2",
  targetSelectiveAccuracy: 0.95,
  independentTestReferences: 0,
  eligibleClasses: Object.freeze([]) as readonly string[],
  numericScoreCalibrated: false,
});
export function colourForSpeech(
  d: VisionDetection,
  options: { now?: number; live?: boolean } = {}
): string {
  const c = d.color,
    now = options.now ?? d.timestamp;
  if (
    COLOUR_SPEECH_QUALIFICATION.status !== "PASSED" ||
    !d.cocoClass ||
    !COLOUR_SPEECH_QUALIFICATION.eligibleClasses.includes(d.cocoClass) ||
    d.cocoClass === "person" ||
    !c?.name ||
    c.timestamp !== d.timestamp ||
    !Number.isFinite(now) ||
    now < c.timestamp ||
    now - c.timestamp > 1250 ||
    !c.quality ||
    c.quality.score < 0.8 ||
    ((options.live ?? true) &&
      (!c.temporal ||
        c.temporal.agreement < 0.75 ||
        c.temporal.agreeingSamples < 3))
  )
    return "";
  return colorDescription(d).replace(
    / \((?:تقدير من الصورة|من قناع آلي تجريبي)\)/g,
    ""
  );
}
