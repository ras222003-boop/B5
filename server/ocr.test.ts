import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { OCR_JSON_SCHEMA, normalizeOcrResult, toExamLanguage } from "../shared/ocr";
import { buildOcrPrompt, extractExamImage, prepareOcrImage } from "./ocr";

const blankImage = async (width: number, height: number, value: number) => {
  const buffer = await sharp({ create: { width, height, channels: 3, background: { r: value, g: value, b: value } } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
};

describe("OCR shared contract", () => {
  it("accepts all three exam languages and normalized aliases", () => {
    expect(toExamLanguage("ar-SA")).toBe("ar");
    expect(toExamLanguage("en-US")).toBe("en");
    expect(toExamLanguage("zh-Hans")).toBe("zh-CN");
    expect(OCR_JSON_SCHEMA.properties.language.enum).toEqual(["ar", "en", "zh-CN"]);
    expect(OCR_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(OCR_JSON_SCHEMA.properties.questions.items.additionalProperties).toBe(false);
  });

  it("preserves original script, printed numbering and option order", () => {
    const raw = normalizeOcrResult({
      examTitle: "汉语测试", language: "zh-CN", detectedLanguages: ["zh-CN", "en"],
      questions: [
        { id: 31, number: "一、", text: "选择正确的答案。", type: "multiple", options: ["春天", "夏天"], optionLabels: ["A", "B"], confidence: "high", uncertainParts: [] },
        { id: 11, number: "٣", text: "ما معنى كلمة مدرسة؟", type: "text", options: [], optionLabels: [], confidence: "low", uncertainParts: ["مدرسة"] },
      ], quality: { status: "good", issues: [] },
    });
    expect(raw.language).toBe("zh-CN");
    expect(raw.questions.map(q => q.id)).toEqual([1, 2]);
    expect(raw.questions[0].number).toBe("一、");
    expect(raw.questions[0].optionLabels).toEqual(["A", "B"]);
    expect(raw.questions[0].options).toEqual(["春天", "夏天"]);
    expect(raw.questions[1].text).toBe("ما معنى كلمة مدرسة؟");
    expect(raw.quality.status).toBe("partial");
  });

  it("treats unreadable images as insufficient without invented questions", () => {
    const result = normalizeOcrResult({ examTitle: "", language: "ar", questions: [], quality: { status: "good", issues: [] } });
    expect(result.quality.status).toBe("insufficient");
    expect(result.quality.issues).toContain("no_text");
    expect(result.questions).toEqual([]);
  });

  it("prompts for original-language transcription and Arabic dots/Chinese strokes", () => {
    const prompt = buildOcrPrompt("en");
    expect(prompt).toContain("NEVER translate");
    expect(prompt).toContain("Arabic dots");
    expect(prompt).toContain("Chinese strokes");
  });
});

describe("OCR image preparation", () => {
  it("rejects unsupported and invalid base64", async () => {
    await expect(prepareOcrImage("data:image/svg+xml;base64,AAAA")).rejects.toThrow(/Unsupported/);
    await expect(prepareOcrImage("*not-base64*")).rejects.toThrow(/Invalid/);
  });

  it("sends an original and enhanced image with a low-resolution flag", async () => {
    const data = await blankImage(600, 850, 108);
    const image = await prepareOcrImage(data);
    expect(image.original).toMatch(/^data:image\/jpeg;base64,/);
    expect(image.enhanced).toMatch(/^data:image\/jpeg;base64,/);
    expect(image.lowResolution).toBe(true);
    expect(image.lowContrast).toBe(true);
    const invoke = async (messages: any[], options?: any) => {
      expect(messages[1].content).toHaveLength(3);
      expect(options.model).toBeTruthy();
      return { choices: [{ message: { content: JSON.stringify({ examTitle: "", language: "en", detectedLanguages: ["en"], questions: [], quality: { status: "insufficient", issues: ["no_text"] } }) } }] };
    };
    const result = await extractExamImage(data, "ar", invoke);
    expect(result.language).toBe("en");
    expect(result.quality.issues).toContain("low_resolution");
    expect(result.quality.issues).toContain("no_text");
  });
});
