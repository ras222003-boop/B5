import { describe, expect, it } from "vitest";
import { beginVoiceAnswer, classifyOcrFailure, consumeVoiceAnswer, countAnswers, ScanAttemptTracker, transcriptFromSpeechResults, updateAnswer } from "./examFlow";

describe("exam answers", () => {
  it("keeps independent answers when navigating, editing and clearing questions", () => {
    const first = updateAnswer({}, 1, "الإجابة الأولى");
    const second = updateAnswer(first, 2, "Answer two");
    const edited = updateAnswer(second, 1, "答案已修改");
    expect(first).toEqual({ 1: "الإجابة الأولى" });
    expect(second).toEqual({ 1: "الإجابة الأولى", 2: "Answer two" });
    expect(edited).toEqual({ 1: "答案已修改", 2: "Answer two" });
    expect(updateAnswer(edited, 2, "  ")).toEqual({ 1: "答案已修改" });
    expect(countAnswers(edited, [1, 2, 3])).toBe(2);
    expect(countAnswers({ 1: " ", 2: "Answer two", 99: "stale" }, [1, 2, 3])).toBe(1);
  });

  it("waits for final speech and consumes it once for the recorded question after navigation", () => {
    const session = beginVoiceAnswer(1, 0);
    const beforeStart = consumeVoiceAnswer(session, "", false, false, 0);
    expect(beforeStart).toEqual({ session, answer: null });
    const interim = consumeVoiceAnswer(beforeStart.session, "إجابة مؤقتة", true, false, 0);
    expect(interim.answer).toBeNull();
    expect(interim.session?.hasStarted).toBe(true);

    // The visible question has changed to 2 by the time recognition ends.
    const final = consumeVoiceAnswer(interim.session, "إجابة صوتية", false, false, 0);
    expect(final.answer).toEqual({ questionId: 1, text: "إجابة صوتية" });
    const answers = updateAnswer({ 2: "Existing answer" }, final.answer!.questionId, final.answer!.text);
    expect(answers).toEqual({ 1: "إجابة صوتية", 2: "Existing answer" });
    expect(consumeVoiceAnswer(final.session, "Late duplicate", false, false, 1).answer).toBeNull();
  });

  it("does not overwrite a manual edit made while recording or apply failed recognition", () => {
    const session = consumeVoiceAnswer(beginVoiceAnswer(1, 2), "interim", true, false, 2).session;
    expect(consumeVoiceAnswer(session, "late voice result", false, false, 3)).toEqual({ session: null, answer: null });
    expect(consumeVoiceAnswer(session, "interim", false, true, 2)).toEqual({ session: null, answer: null });
  });

  it("keeps prior finalized speech when the browser updates a later result index", () => {
    const first = Object.assign([{ transcript: "الإجابة", confidence: 0.8 }], { isFinal: true });
    const second = Object.assign([
      { transcript: "الصحيحة", confidence: 0.9 },
      { transcript: "خاطئة", confidence: 0.1 },
    ], { isFinal: true });
    expect(transcriptFromSpeechResults([first, second])).toBe("الإجابة الصحيحة");
  });
});

describe("OCR error classification", () => {
  it("uses server codes and supports older status-only responses", () => {
    expect(classifyOcrFailure(503, "unreadable_image")).toBe("unreadableImage");
    expect(classifyOcrFailure(200, "no_document")).toBe("noDocument");
    expect(classifyOcrFailure(504)).toBe("timeout");
    expect(classifyOcrFailure(413)).toBe("invalidImage");
    expect(classifyOcrFailure(503)).toBe("unavailable");
    expect(classifyOcrFailure(500)).toBe("internal");
  });
});

describe("image scan attempt tracking", () => {
  it("blocks overlap and prevents an old OCR response from replacing a later scan", () => {
    const tracker = new ScanAttemptTracker();
    const first = tracker.begin()!;
    expect(tracker.begin()).toBeNull(); // upload preparation and OCR share one lock
    tracker.cancel();
    const second = tracker.begin()!;
    expect(second).toBeGreaterThan(first);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.finish(first)).toBe(false);
    expect(tracker.begin()).toBeNull(); // stale cleanup did not unlock the new scan
    expect(tracker.finish(second)).toBe(true);
    expect(tracker.begin()).not.toBeNull();
  });
});
