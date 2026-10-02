/*
 * Run manually with the project's injected BUILT_IN_FORGE_API_* credentials:
 *   pnpm exec tsx scripts/ocr-benchmark.ts /path/to/ar.jpg /path/to/en.jpg /path/to/zh-CN.jpg
 * Never log tokens or full image payloads. This script uses the same OCR path as production.
 */
import { readFile } from "node:fs/promises";
import { extractExamImage, type VisionCompletion } from "../server/ocr";
import { type ExamLanguage } from "../shared/ocr";

const endpoint = `${(process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "")}/v1/chat/completions`;
const key = process.env.BUILT_IN_FORGE_API_KEY;
if (!key || !process.env.BUILT_IN_FORGE_API_URL) throw new Error("BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY are required");

const invoke: VisionCompletion = async (messages, options) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: options?.model, response_format: options?.response_format, max_tokens: 8192 }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw new Error(`Vision API HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
};

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Pass one or more image file paths");
  for (const file of files) {
    const label: ExamLanguage = /zh/i.test(file) ? "zh-CN" : /en/i.test(file) ? "en" : "ar";
    const bytes = await readFile(file);
    const start = Date.now();
    const result = await extractExamImage(`data:image/jpeg;base64,${bytes.toString("base64")}`, label, invoke);
    console.log(JSON.stringify({ file, durationMs: Date.now() - start, result }, null, 2));
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
