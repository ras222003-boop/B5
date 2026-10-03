/**
 * Shared OCR contract between `/api/ocr` and the exam pages.
 * Backwards compatible with the previous shape (`examTitle`, `language`,
 * `questions[].{id,text,type,options}`) and extended with numbering,
 * option labels, per-question confidence and an image-quality report.
 */
export const EXAM_LANGUAGES = ["ar", "en", "zh-CN"] as const;
export type ExamLanguage = (typeof EXAM_LANGUAGES)[number];

export const OCR_QUALITY_ISSUES = [
  "blurry",
  "low_light",
  "skewed",
  "cropped",
  "glare",
  "low_resolution",
  "handwriting",
  "no_document",
  "no_text",
] as const;
export type OcrQualityIssue = (typeof OCR_QUALITY_ISSUES)[number];
export type OcrQualityStatus = "good" | "partial" | "insufficient";
export type OcrConfidence = "high" | "medium" | "low";

export interface OcrQuestion {
  /** Sequential position (1-based) in reading order. */
  id: number;
  /** Number/label exactly as printed (e.g. "1", "١", "Q3", "一", "3)"). Empty if unnumbered. */
  number: string;
  /** Question text in its original language, without the number prefix. */
  text: string;
  /** `multiple` when the question has answer choices, otherwise `text`. */
  type: "multiple" | "text";
  /** Option texts in printed order, without their labels. */
  options: string[];
  /** Option labels in printed order ("أ", "ب" / "A", "B" / "A", "B"), aligned with `options`. */
  optionLabels: string[];
  confidence: OcrConfidence;
  /** Words or fragments that could not be read with certainty (verbatim, may be empty). */
  uncertainParts: string[];
}

export interface OcrQuality {
  status: OcrQualityStatus;
  issues: OcrQualityIssue[];
  /** Aggregate of the readable questions; warnings about the image do not erase it. */
  confidence: OcrConfidence;
}

export interface OcrResult {
  examTitle: string;
  /** Dominant language of the exam sheet. */
  language: ExamLanguage;
  /** Every language that appears on the sheet. */
  detectedLanguages: ExamLanguage[];
  questions: OcrQuestion[];
  quality: OcrQuality;
}

export function isExamLanguage(value: unknown): value is ExamLanguage {
  return typeof value === "string" && (EXAM_LANGUAGES as readonly string[]).includes(value);
}

/** Maps loose tags ("zh", "zh-Hans", "arabic", "EN") to a supported exam language. */
export function toExamLanguage(value: unknown, fallback: ExamLanguage = "ar"): ExamLanguage {
  if (isExamLanguage(value)) return value;
  if (typeof value !== "string") return fallback;
  const tag = value.trim().toLowerCase();
  if (tag.startsWith("zh") || tag.startsWith("cmn") || tag === "chinese") return "zh-CN";
  if (tag.startsWith("en") || tag === "english") return "en";
  if (tag.startsWith("ar") || tag === "arabic") return "ar";
  return fallback;
}

/** JSON Schema used with `response_format: { type: "json_schema", strict: true }`. */
export const OCR_JSON_SCHEMA = {
  type: "object",
  properties: {
    examTitle: { type: "string", description: "Exam title exactly as printed, or empty string." },
    language: { type: "string", enum: [...EXAM_LANGUAGES], description: "Dominant language of the sheet." },
    detectedLanguages: { type: "array", items: { type: "string", enum: [...EXAM_LANGUAGES] } },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "1-based reading-order position." },
          number: { type: "string", description: "Question number/label exactly as printed, or empty string." },
          text: { type: "string", description: "Question text verbatim in the original language, without the number." },
          type: { type: "string", enum: ["multiple", "text"] },
          options: { type: "array", items: { type: "string" }, description: "Choice texts verbatim, in printed order, without labels." },
          optionLabels: { type: "array", items: { type: "string" }, description: "Choice labels exactly as printed, aligned with options." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          uncertainParts: { type: "array", items: { type: "string" } },
        },
        required: ["id", "number", "text", "type", "options", "optionLabels", "confidence", "uncertainParts"],
        additionalProperties: false,
      },
    },
    quality: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["good", "partial", "insufficient"] },
        issues: { type: "array", items: { type: "string", enum: [...OCR_QUALITY_ISSUES] } },
      },
      required: ["status", "issues"],
      additionalProperties: false,
    },
  },
  required: ["examTitle", "language", "detectedLanguages", "questions", "quality"],
  additionalProperties: false,
} as const;

const asString = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const asStringArray = (v: unknown) => (Array.isArray(v) ? v.map(asString).filter(Boolean) : []);

/**
 * Validates and normalizes a raw model result. Never invents content: it only
 * trims, re-sequences ids, aligns labels with options and derives quality.
 */
export function normalizeOcrResult(raw: unknown, fallbackLanguage: ExamLanguage = "ar"): OcrResult {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const language = toExamLanguage(data.language, fallbackLanguage);
  const detected = Array.from(new Set([language, ...(Array.isArray(data.detectedLanguages) ? data.detectedLanguages.map(l => toExamLanguage(l, language)) : [])]));

  const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
  const questions: OcrQuestion[] = [];
  for (const item of rawQuestions) {
    const q = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const text = asString(q.text);
    if (!text) continue;
    // Keep empty option slots so labels and texts remain aligned when a choice
    // is present but its text is unreadable. Removing one would shift every
    // later answer label onto the wrong answer.
    const options = Array.isArray(q.options) ? q.options.map(asString) : [];
    const rawLabels = Array.isArray(q.optionLabels) ? q.optionLabels.map(asString) : [];
    const choiceCount = Math.max(options.length, rawLabels.length);
    const alignedOptions = Array.from({ length: choiceCount }, (_, i) => options[i] ?? "");
    const optionLabels = Array.from({ length: choiceCount }, (_, i) => rawLabels[i] ?? "");
    const uncertainParts = asStringArray(q.uncertainParts);
    const reportedConfidence: OcrConfidence = q.confidence === "high" || q.confidence === "medium" || q.confidence === "low" ? q.confidence : "medium";
    const confidence: OcrConfidence = uncertainParts.length && reportedConfidence === "high" ? "medium" : reportedConfidence;
    const multiple = q.type === "multiple" || choiceCount >= 2;
    questions.push({
      id: questions.length + 1,
      number: asString(q.number),
      text,
      type: multiple && choiceCount ? "multiple" : "text",
      options: multiple ? alignedOptions : [],
      optionLabels: multiple ? optionLabels : [],
      confidence,
      uncertainParts,
    });
  }

  // The model can omit a secondary script on a mixed-language page. Infer
  // substantial script presence from transcribed text, without letting a lone
  // Latin math variable or Arabic-Indic question number count as a language.
  const transcribed = [asString(data.examTitle), ...questions.flatMap(q => [q.text, ...q.options])].join(" ");
  if ((transcribed.match(/[\u0621-\u064A\u0671-\u06D3]/g) || []).length >= 4 && !detected.includes("ar")) detected.push("ar");
  if ((transcribed.match(/[A-Za-z]/g) || []).length >= 8 && !detected.includes("en")) detected.push("en");
  if ((transcribed.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length >= 2 && !detected.includes("zh-CN")) detected.push("zh-CN");

  const rawQuality = (data.quality && typeof data.quality === "object" ? data.quality : {}) as Record<string, unknown>;
  const issues = (Array.isArray(rawQuality.issues) ? rawQuality.issues : []).filter((i): i is OcrQualityIssue => (OCR_QUALITY_ISSUES as readonly string[]).includes(i as string));
  let status: OcrQualityStatus = rawQuality.status === "good" || rawQuality.status === "partial" || rawQuality.status === "insufficient" ? rawQuality.status : "good";
  if (!questions.length) {
    status = "insufficient";
    if (!issues.includes("no_text") && !issues.includes("no_document")) issues.push("no_text");
  } else {
    // An uncertain fragment should not suppress the readable questions. The
    // client only treats `insufficient` as a page-level failure.
    status = status === "insufficient" || questions.some(q => q.confidence === "low" || q.uncertainParts.length) ? "partial" : status;
    for (const issue of ["no_text", "no_document"] as const) {
      const index = issues.indexOf(issue);
      if (index >= 0) issues.splice(index, 1);
    }
  }

  const high = questions.filter(q => q.confidence === "high").length;
  const low = questions.filter(q => q.confidence === "low").length;
  const confidence: OcrConfidence = !questions.length || low >= Math.ceil(questions.length / 2)
    ? "low"
    : high === questions.length ? "high" : "medium";

  return {
    examTitle: asString(data.examTitle),
    language,
    detectedLanguages: detected,
    questions,
    quality: { status, issues: Array.from(new Set(issues)), confidence },
  };
}
