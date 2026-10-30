import type { ObjectColorObservation, VisionDetection } from "@shared/vision";
import { analyzeObjectColor } from "./objectColorEstimator";
import { analyzeObjectColorV4 } from "./objectColorV4";
import type { AlignedObjectMask, ColorPixels } from "./objectColors";

/** Which colour engine the live and photo paths use. V3 stays the default; V4 is an opt-in research trial.
 * Neither engine can reach speech: `COLOUR_SPEECH_QUALIFICATION` stays UNQUALIFIED until sealed independent
 * evidence passes `qualifyColourSpeech`, so V4 estimates are shown on screen only and recorded in trial logs. */
export type ColourEngineId = "v3" | "v4-experimental";
const key = "basira-colour-engine-v1";
let current: ColourEngineId | null = null;

export function getColourEngine(): ColourEngineId {
  if (current) return current;
  try {
    current = localStorage.getItem(key) === "v4-experimental" ? "v4-experimental" : "v3";
  } catch {
    current = "v3";
  }
  return current;
}
export function saveColourEngine(id: ColourEngineId): ColourEngineId {
  current = id;
  try {
    localStorage.setItem(key, id);
  } catch {
    /* private mode: the choice still applies for this session */
  }
  return id;
}
export const colourEngineLabel = (id: ColourEngineId) =>
  id === "v4-experimental" ? "V4 تجريبي (للعرض فقط)" : "V3 الحالي";

/** One entry point for every caller, so the engine choice cannot differ between camera, photo and trial paths. */
export function analyzeColour(
  frame: ColorPixels,
  detection: VisionDetection,
  others: readonly VisionDetection[] = [],
  mask?: AlignedObjectMask,
  engine: ColourEngineId = getColourEngine()
): ObjectColorObservation {
  return engine === "v4-experimental"
    ? analyzeObjectColorV4(frame, detection, others, mask)
    : analyzeObjectColor(frame, detection, others, mask);
}
