import type { Express, Request } from "express";
import sharp from "sharp";
import { OCR_JSON_SCHEMA, normalizeOcrResult, toExamLanguage, type ExamLanguage, type OcrResult } from "../shared/ocr";

export type VisionCompletion = (messages: Array<{ role: string; content: unknown }>, options?: { response_format?: unknown; model?: string }) => Promise<any>;

const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const MAX_PIXELS = 34_000_000;
const MIME_RE = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export type PreparedOcrImage = {
  original: string;
  enhanced: string;
  width: number;
  height: number;
  lowResolution: boolean;
  lowContrast: boolean;
};

/** Decode only supported image data. Correct EXIF orientation, normalize low light,
 * and send both the original and mildly enhanced copies: sharpening can remove
 * Arabic dots, accents or thin Chinese strokes, so the original remains authoritative. */
export async function prepareOcrImage(value: unknown): Promise<PreparedOcrImage> {
  if (typeof value !== "string" || !value.trim()) throw new Error("imageBase64 is required");
  const encoded = value.replace(MIME_RE, "");
  if (encoded === value && /^data:/i.test(value)) throw new Error("Unsupported image type; use JPEG, PNG or WebP");
  if (encoded.length > MAX_IMAGE_BYTES * 1.38) throw new Error("Image is too large");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid base64 image");
  const image = Buffer.from(encoded, "base64");
  if (image.length < 128 || image.length > MAX_IMAGE_BYTES) throw new Error("Image is too small or too large");
  const src = sharp(image, { failOn: "error", limitInputPixels: MAX_PIXELS });
  const meta = await src.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw new Error("Unsupported image type; use JPEG, PNG or WebP");
  if (!meta.width || !meta.height) throw new Error("Cannot read image dimensions");
  const originalBuffer = await sharp(image, { limitInputPixels: MAX_PIXELS })
    .rotate() // EXIF orientation, not an arbitrary guessed deskew angle
    .flatten({ background: "#ffffff" })
    .resize({ width: 2600, height: 3600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 89, mozjpeg: true })
    .toBuffer();
  const rotated = sharp(originalBuffer);
  const actual = await rotated.metadata();
  const stats = await rotated.stats();
  // A clean white sheet is naturally low-variance; only flag it if it is
  // genuinely dark or both dim and nearly contrast-free.
  const lightness = stats.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  const lowContrast = lightness < 165 || (lightness < 215 && stats.channels.slice(0, 3).every(c => c.stdev < 15));
  const enhancedBuffer = await sharp(originalBuffer)
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.55, m1: 0.5, m2: 1 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return {
    original: `data:image/jpeg;base64,${originalBuffer.toString("base64")}`,
    enhanced: `data:image/jpeg;base64,${enhancedBuffer.toString("base64")}`,
    width: actual.width ?? meta.width,
    height: actual.height ?? meta.height,
    lowResolution: Math.min(actual.width ?? meta.width, actual.height ?? meta.height) < 800,
    lowContrast,
  };
}

export function buildOcrPrompt(uiLanguage: ExamLanguage) {
  return `You are a meticulous, multilingual OCR transcription assistant for printed school exam sheets. Supported languages: Arabic (ar), English (en), Simplified Chinese (zh-CN). The UI hint is ${uiLanguage}; DETECT the actual sheet language from the image, regardless of that hint. Transcribe the sheet in its ORIGINAL language; NEVER translate, paraphrase, solve, complete or invent text.

Two images of the SAME page are provided: the first is the original (after safe EXIF rotation only), the second is an enhanced-contrast reference. The FIRST image is authoritative, especially for Arabic dots and hamza/diacritics, Chinese strokes, numbers and punctuation. Use the second only to confirm faint text. If the image is slightly tilted, follow the printed baselines instead of reordering columns. Reading order follows the script: RTL for Arabic, LTR for English/Chinese; respect columns, page title, headings and the printed sequence. Keep question number/label exactly as printed in number; keep each choice label exactly in optionLabels, with optionTexts in options in the same order. id is the SEQUENTIAL reading-order index, not the printed question number. Preserve Arabic dot count and hamza variants (أ إ آ ؤ ئ ء), English capitalization, Chinese characters, decimal digits (Arabic-Indic/Western), math symbols and punctuation as visible. Do not fill missing characters with plausible words. Mark unreadable fragments in uncertainParts; leave a field empty if unreadable; omit a question only when its question text cannot be read at all. If glare, skew, darkness, crop, blur, low resolution, handwriting or no text prevents accurate extraction, use quality.status partial/insufficient and list the matching quality.issues; mark affected question confidence low. If everything is legible use quality.status good and high confidence. A low-quality image with unreadable text must produce an explicit insufficient status, not fabricated questions. Return ONLY the exact JSON schema.`.replaceAll("\u0019", "`");
}

export async function extractExamImage(value: unknown, uiLanguage: ExamLanguage, invoke: VisionCompletion): Promise<OcrResult> {
  const image = await prepareOcrImage(value);
  const response = await invoke(
    [
      { role: "system", content: buildOcrPrompt(uiLanguage) },
      { role: "user", content: [
        { type: "text", text: "Transcribe this exam sheet exactly. Return the structured JSON only. The first image is authoritative; the second is contrast-enhanced. Do not translate." },
        { type: "image_url", image_url: { url: image.original, detail: "high" } },
        { type: "image_url", image_url: { url: image.enhanced, detail: "high" } },
      ] },
    ],
    { model: process.env.BASIRA_OCR_MODEL || "gemini-3.1-pro-preview", response_format: { type: "json_schema", json_schema: { name: "basira_exam_ocr_v2", strict: true, schema: OCR_JSON_SCHEMA } } },
  );
  const raw = response?.choices?.[0]?.message?.content;
  const content = Array.isArray(raw) ? raw.find(part => part?.type === "text")?.text : raw;
  if (typeof content !== "string" || !content.trim()) throw new Error("OCR returned no text");
  const parsed = JSON.parse(content);
  const result = normalizeOcrResult(parsed, uiLanguage);
  if (image.lowResolution) {
    result.quality.issues = Array.from(new Set([...result.quality.issues, "low_resolution" as const]));
    if (result.quality.status === "good") result.quality.status = "partial";
  }
  if (image.lowContrast) {
    result.quality.issues = Array.from(new Set([...result.quality.issues, "low_light" as const]));
    if (result.quality.status === "good") result.quality.status = "partial";
  }
  return result;
}

export function registerOcrRoute(app: Express, invoke: VisionCompletion) {
  app.post("/api/ocr", async (req: Request, res) => {
    const requested = toExamLanguage(req.body?.language, "ar");
    try {
      if (!req.body?.imageBase64) return res.status(400).json({ error: "imageBase64 is required" });
      const result = await extractExamImage(req.body.imageBase64, requested, invoke);
      res.set("Cache-Control", "no-store");
      return res.json(result);
    } catch (error: any) {
      const invalid = /^(imageBase64|Unsupported image|Image is|Invalid base64|Cannot read image)/.test(error?.message || "");
      if (!invalid) console.error("OCR failed", error instanceof Error ? error.message : "unknown");
      return res.status(invalid ? 400 : 503).json({ error: invalid ? error.message : "OCR is temporarily unavailable. Please try again." });
    }
  });
}
