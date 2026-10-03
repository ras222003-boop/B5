export type OcrFailureKind =
  | "noDocument"
  | "noText"
  | "unreadableImage"
  | "invalidImage"
  | "timeout"
  | "network"
  | "unavailable"
  | "internal";

/** The server supplies a stable code; status remains a fallback for older deployments. */
export function classifyOcrFailure(status: number, code?: unknown): OcrFailureKind {
  switch (code) {
    case "no_document": return "noDocument";
    case "no_text": return "noText";
    case "unreadable_image": return "unreadableImage";
    case "invalid_image": return "invalidImage";
    case "timeout": return "timeout";
    case "unavailable": return "unavailable";
    case "internal": return "internal";
  }
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 413 || status === 415 || status === 422) return "invalidImage";
  if (status === 502 || status === 503) return "unavailable";
  return "internal";
}

/** Keep answers keyed to OCR question IDs and omit empty answers from the count. */
export function updateAnswer(answers: Readonly<Record<number, string>>, questionId: number, value: string): Record<number, string> {
  const next = { ...answers };
  if (value.trim()) next[questionId] = value;
  else delete next[questionId];
  return next;
}

export function countAnswers(answers: Readonly<Record<number, string>>, questionIds: readonly number[]): number {
  return questionIds.filter(id => Boolean(answers[id]?.trim())).length;
}

export type VoiceAnswerSession = { questionId: number; answerRevision: number; hasStarted: boolean };

export function beginVoiceAnswer(questionId: number, answerRevision: number): VoiceAnswerSession {
  return { questionId, answerRevision, hasStarted: false };
}

/** Return a result only after recognition ends and only if typing has not superseded it. */
export function consumeVoiceAnswer(
  session: VoiceAnswerSession | null,
  transcript: string,
  isListening: boolean,
  hasError: boolean,
  currentAnswerRevision: number,
): { session: VoiceAnswerSession | null; answer: { questionId: number; text: string } | null } {
  if (!session) return { session: null, answer: null };
  if (isListening) return { session: { ...session, hasStarted: true }, answer: null };
  if (!session.hasStarted && !hasError) return { session, answer: null };
  const text = transcript.trim();
  return {
    session: null,
    answer: !hasError && text && currentAnswerRevision === session.answerRevision
      ? { questionId: session.questionId, text }
      : null,
  };
}

type SpeechAlternative = { transcript: string; confidence?: number };
type SpeechResult = ArrayLike<SpeechAlternative> & { isFinal: boolean };

/** Web Speech's resultIndex marks the first changed segment, not the whole answer. */
export function transcriptFromSpeechResults(results: ArrayLike<SpeechResult>): string {
  const final: string[] = [];
  const interim: string[] = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    let best = result[0];
    for (let alternate = 1; alternate < result.length; alternate++) {
      if ((result[alternate]?.confidence ?? 0) > (best?.confidence ?? 0)) best = result[alternate];
    }
    const text = best?.transcript?.trim();
    if (text) (result.isFinal ? final : interim).push(text);
  }
  return [...final, ...interim].join(" ").trim();
}

/** Prevent two image preparations/requests from racing and ignore canceled results. */
export class ScanAttemptTracker {
  private generation = 0;
  private busy = false;

  begin(): number | null {
    if (this.busy) return null;
    this.busy = true;
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  finish(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.busy = false;
    return true;
  }

  cancel() {
    this.generation += 1;
    this.busy = false;
  }
}
