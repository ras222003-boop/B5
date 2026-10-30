import { describe, it, expect } from "vitest";
import {
  qualifyColourSpeech,
  wilsonLowerBound,
  type ColourEvidence,
} from "./colourQualification";
import { COLOUR_SPEECH_QUALIFICATION } from "./colourAnnouncement";

const strong = (k: number, n: number) => ({ references: n, answered: n, correct: k });
describe("colour speech qualification", () => {
  it("keeps the shipped gate closed until sealed evidence passes", () => {
    expect(COLOUR_SPEECH_QUALIFICATION.status).toBe("UNQUALIFIED");
    expect(COLOUR_SPEECH_QUALIFICATION.eligibleClasses).toEqual([]);
  });
  it("is closed for the measured V4 development results (about 70% precision)", () => {
    const out = qualifyColourSpeech({
      references: 87,
      sourceGroups: 68,
      answered: 30,
      correct: 20,
      perClass: { car: strong(5, 7) },
    });
    expect(out.status).toBe("UNQUALIFIED");
    expect(out.eligibleClasses).toEqual([]);
  });
  it("needs a Wilson lower bound, so a few lucky answers never qualify a class", () => {
    expect(wilsonLowerBound(8, 8)).toBeLessThan(0.95);
    expect(wilsonLowerBound(80, 80)).toBeGreaterThan(0.95);
    const lucky: ColourEvidence = {
      references: 200,
      sourceGroups: 40,
      answered: 100,
      correct: 100,
      perClass: { car: strong(8, 8) },
    };
    expect(qualifyColourSpeech(lucky).status).toBe("UNQUALIFIED");
  });
  it("opens only the classes that individually clear the bar, never person or synthetic", () => {
    const out = qualifyColourSpeech({
      references: 400,
      sourceGroups: 60,
      answered: 300,
      correct: 296,
      perClass: {
        car: strong(100, 100),
        chair: strong(50, 60),
        person: strong(100, 100),
        synthetic: strong(100, 100),
      },
    });
    expect(out.status).toBe("PASSED");
    expect(out.eligibleClasses).toEqual(["car"]);
  });
});
