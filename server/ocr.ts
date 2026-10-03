import type { Express, Request } from "express";
import sharp from "sharp";
import { OCR_JSON_SCHEMA, normalizeOcrResult, toExamLanguage, type ExamLanguage, type OcrResult } from "../shared/ocr";

export type VisionCompletion = (messages: Array<{ role: string; content: unknown }>, options?: { response_format?: unknown; model?: string }) => Promise<any>;

const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
// Includes current 48 MP phone cameras while retaining a decompression guard.
// Sharp shrinks JPEGs during decode before the bounded 2600 x 3600 output.
const MAX_PIXELS = 64_000_000;
const MIME_RE = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export type OcrErrorCode = "invalid_image" | "unreadable_image" | "timeout" | "unavailable" | "internal";

export class OcrFailure extends Error {
  constructor(
    public readonly code: OcrErrorCode,
    public readonly status: number,
    message: string,
    public readonly retryWithAlternate = false,
  ) {
    super(message);
    this.name = "OcrFailure";
  }
}

export type PreparedOcrImage = {
  original: string;
  enhanced: string;
  width: number;
  height: number;
  lowResolution: boolean;
  lowContrast: boolean;
};

/** Decode supported image data, correct EXIF orientation and prepare a bounded
 * original plus a gentler alternate for weak OCR only. The original is always
 * authoritative: contrast operations can remove Arabic dots or Chinese strokes. */
export async function prepareOcrImage(value: unknown): Promise<PreparedOcrImage> {
  if (typeof value !== "string" || !value.trim()) throw new OcrFailure("invalid_image", 400, "imageBase64 is required");
  const encoded = value.replace(MIME_RE, "");
  if (encoded === value && /^data:/i.test(value)) throw new OcrFailure("invalid_image", 400, "Unsupported image type; use JPEG, PNG or WebP");
  if (encoded.length > MAX_IMAGE_BYTES * 1.38) throw new OcrFailure("invalid_image", 413, "Image is too large");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new OcrFailure("invalid_image", 400, "Invalid base64 image");
  const image = Buffer.from(encoded, "base64");
  if (image.length < 128 || image.length > MAX_IMAGE_BYTES) throw new OcrFailure("invalid_image", 400, "Image is too small or too large");
  try {
    const meta = await sharp(image, { failOn: "error", limitInputPixels: MAX_PIXELS }).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw new OcrFailure("invalid_image", 400, "Unsupported image type; use JPEG, PNG or WebP");
    if (!meta.width || !meta.height) throw new OcrFailure("unreadable_image", 422, "Cannot read image dimensions");

    const originalBuffer = await sharp(image, { failOn: "error", limitInputPixels: MAX_PIXELS })
      .rotate() // EXIF orientation; unknown arbitrary angles are left to vision.
      .flatten({ background: "#ffffff" })
      .resize({ width: 2600, height: 3600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    const actual = await sharp(originalBuffer).metadata();
    const width = actual.width ?? meta.width;
    const height = actual.height ?? meta.height;

    // Judge the central page rather than dark table/background around it.
    // This is only a warning, never a reason to suppress OCR.
    const center = {
      left: Math.floor(width * 0.2), top: Math.floor(height * 0.2),
      width: Math.max(1, Math.floor(width * 0.6)), height: Math.max(1, Math.floor(height * 0.6)),
    };
    const stats = await sharp(originalBuffer).extract(center).stats();
    const channels = stats.channels.slice(0, 3);
    const lightness = channels.reduce((sum, c) => sum + c.mean, 0) / channels.length;
    const lowContrast = lightness < 135 || (lightness < 225 && channels.every(c => c.stdev < 10));

    // Trim only the alternate: preserving the full page on the first pass
    // avoids losing an edge question if the border detector is mistaken.
    let alternateBase = originalBuffer;
    try {
      const trimmed = await sharp(originalBuffer).trim({ threshold: 12 }).toBuffer();
      const trimmedMeta = await sharp(trimmed).metadata();
      if (trimmedMeta.width && trimmedMeta.height &&
          trimmedMeta.width >= 300 && trimmedMeta.height >= 300 &&
          trimmedMeta.width * trimmedMeta.height < width * height * 0.88) {
        alternateBase = trimmed;
      }
    } catch { /* A uniform/irregular border need not be trimmed. */ }

    const alternateMeta = await sharp(alternateBase).metadata();
    const alternateWidth = alternateMeta.width ?? width;
    const alternateHeight = alternateMeta.height ?? height;
    const scale = Math.min(1.5, Math.max(1, 1700 / Math.max(alternateWidth, alternateHeight)));
    const enhancedBuffer = await sharp(alternateBase)
      .resize({ width: Math.round(alternateWidth * scale), height: Math.round(alternateHeight * scale), fit: "fill", kernel: "lanczos3" })
      .normalise({ lower: 1, upper: 99 })
      .sharpen({ sigma: 0.5, m1: 0.5, m2: 1 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return {
      original: `data:image/jpeg;base64,${originalBuffer.toString("base64")}`,
      enhanced: `data:image/jpeg;base64,${enhancedBuffer.toString("base64")}`,
      width, height,
      lowResolution: Math.min(width, height) < 800,
      lowContrast,
    };
  } catch (error) {
    if (error instanceof OcrFailure) throw error;
    throw new OcrFailure("unreadable_image", 422, "The image could not be decoded safely");
  }
}

export function buildOcrPrompt(uiLanguage: ExamLanguage) {
  return `You are a meticulous multilingual OCR transcription assistant for printed school exam sheets. Read Arabic (ar), English (en), and Simplified Chinese (zh-CN), including Arabic + English or other mixed-language lines. The UI hint is ${uiLanguage}; DETECT the actual languages from the page, regardless of the hint. List every substantial language in detectedLanguages. Transcribe text in its ORIGINAL language; NEVER translate, paraphrase, solve, complete or invent text.

This may be a phone photo with shadows, non-white background, margins, mild blur, skew, perspective or 90/180/270-degree rotation without EXIF. Follow the printed baselines and mentally correct orientation/perspective before reading. Image defects are warnings, not proof that text is unreadable: attempt to read every visible question first. Reading order follows the layout and script (RTL for Arabic, LTR for English/Chinese). Respect columns, line breaks within a question, headings and the printed question sequence. Keep each distinct question separate. Keep its printed number/label exactly in number; keep each choice label exactly in optionLabels and its text at the same array index in options. id is the sequential reading-order index, not the printed number. Preserve Arabic dots and hamza variants (أ إ آ ؤ ئ ء), Chinese strokes, English capitalization, Arabic-Indic/Western digits, math symbols and punctuation. Do not merge adjacent questions or move an option to another question.

For each question, assign confidence based on its readable text; mark only uncertain fragments in uncertainParts. A weak part of the page must not make readable questions disappear. If at least one question is readable, use quality.status partial rather than insufficient, even if the rest is cropped or blurry. Use insufficient only when no question text can be read after careful examination. Use quality.issues no_document if no sheet/document is visible, no_text if a document is visible but has no readable exam text, and other issues only when visible. If the page is wholly legible, use good and high confidence. Do not fabricate words for unreadable portions. Return ONLY the exact JSON schema.`;
}

function parseVisionResponse(response: any, uiLanguage: ExamLanguage): OcrResult {
  const raw = response?.choices?.[0]?.message?.content;
  const content = Array.isArray(raw) ? raw.filter(part => part?.type === "text").map(part => part.text || "").join("") : raw;
  if (typeof content !== "string" || !content.trim()) {
    throw new OcrFailure("unavailable", 502, "OCR returned no usable result", true);
  }
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON root");
    return normalizeOcrResult(parsed, uiLanguage);
  } catch {
    throw new OcrFailure("unavailable", 502, "OCR returned an invalid result", true);
  }
}

async function readExamImage(image: string, uiLanguage: ExamLanguage, invoke: VisionCompletion, alternate: boolean): Promise<OcrResult> {
  const response = await invoke(
    [
      { role: "system", content: buildOcrPrompt(uiLanguage) },
      { role: "user", content: [
        { type: "text", text: alternate
          ? "Read this alternate, contrast-adjusted and possibly margin-cropped view of the same exam sheet. Check faint writing carefully. Return structured JSON only; do not translate or invent text."
          : "Read this exam sheet exactly, including any Arabic, English and Chinese on the same page. Check all visible questions before judging quality. Return structured JSON only; do not translate or invent text." },
        { type: "image_url", image_url: { url: image, detail: "high" } },
      ] },
    ],
    { model: process.env.BASIRA_OCR_MODEL || "gemini-3.1-pro-preview", response_format: { type: "json_schema", json_schema: { name: "basira_exam_ocr_v2", strict: true, schema: OCR_JSON_SCHEMA } } },
  );
  return parseVisionResponse(response, uiLanguage);
}

function needsAlternate(result: OcrResult): boolean {
  if (!result.questions.length) return true;
  const low = result.questions.filter(question => question.confidence === "low").length;
  const uncertain = result.questions.filter(question => question.uncertainParts.length).length;
  return low >= Math.ceil(result.questions.length / 2) || uncertain === result.questions.length;
}

function resultScore(result: OcrResult): number {
  return result.questions.reduce((score, question) => score +
    (question.confidence === "high" ? 3 : question.confidence === "medium" ? 2 : 1) +
    Math.min(question.text.length, 160) / 160 +
    Math.min(question.options.filter(Boolean).length, 4) * 0.15, 0);
}

function chooseBetterResult(first: OcrResult, alternate: OcrResult): OcrResult {
  // Confidence is subjective model output. Never trade away an already-read
  // question just because the alternate rates its smaller subset higher.
  if (alternate.questions.length < first.questions.length) return first;
  const alternateNumbers = new Set(alternate.questions.map(question => question.number).filter(Boolean));
  if (first.questions.some(question => question.number && !alternateNumbers.has(question.number))) return first;
  return resultScore(alternate) > resultScore(first) ? alternate : first;
}

export async function extractExamImage(value: unknown, uiLanguage: ExamLanguage, invoke: VisionCompletion): Promise<OcrResult> {
  const image = await prepareOcrImage(value);
  let first: OcrResult | undefined;
  try {
    first = await readExamImage(image.original, uiLanguage, invoke, false);
  } catch (error) {
    // Retry only malformed/empty model output; network and timeout failures
    // need a distinct response and must not double the external request.
    if (!(error instanceof OcrFailure && error.retryWithAlternate)) throw error;
  }
  let result = first;
  if (!result || needsAlternate(result)) {
    try {
      const alternate = await readExamImage(image.enhanced, uiLanguage, invoke, true);
      result = result ? chooseBetterResult(result, alternate) : alternate;
    } catch (error) {
      if (!result?.questions.length) throw error;
      // Keep already-read questions if the optional second pass fails.
    }
  }
  if (!result) throw new OcrFailure("unavailable", 502, "OCR returned no usable result");
  if (image.lowResolution) {
    result.quality.issues = Array.from(new Set([...result.quality.issues, "low_resolution" as const]));
  }
  if (image.lowContrast) {
    result.quality.issues = Array.from(new Set([...result.quality.issues, "low_light" as const]));
  }
  if (result.questions.length && result.quality.status === "good" && (image.lowResolution || image.lowContrast)) {
    result.quality.status = "partial";
  }
  return result;
}

function classifyOcrFailure(error: unknown): OcrFailure {
  if (error instanceof OcrFailure) return error;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError" || name === "TimeoutError" || /\b(timeout|timed out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b/i.test(message)) {
    return new OcrFailure("timeout", 504, "OCR processing timed out. Please try again.");
  }
  if (/\b(fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|LLM API error|Vision API HTTP)\b/i.test(message) || error instanceof TypeError) {
    return new OcrFailure("unavailable", 503, "OCR is temporarily unavailable. Please try again.");
  }
  return new OcrFailure("internal", 500, "The image could not be processed. Please try again.");
}

export function registerOcrRoute(app: Express, invoke: VisionCompletion) {
  app.post("/api/ocr", async (req: Request, res) => {
    const requested = toExamLanguage(req.body?.language, "ar");
    try {
      const result = await extractExamImage(req.body?.imageBase64, requested, invoke);
      res.set("Cache-Control", "no-store");
      return res.json(result);
    } catch (error) {
      const failure = classifyOcrFailure(error);
      if (failure.code === "internal") console.error("OCR internal failure", error instanceof Error ? error.name : "unknown");
      res.set("Cache-Control", "no-store");
      return res.status(failure.status).json({ code: failure.code, error: failure.message });
    }
  });
}
