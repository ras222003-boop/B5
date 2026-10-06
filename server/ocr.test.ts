import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { OCR_JSON_SCHEMA, normalizeOcrResult, toExamLanguage, type ExamLanguage } from "../shared/ocr";
import { buildOcrPrompt, extractExamImage, prepareOcrImage, registerOcrRoute, type VisionCompletion } from "./ocr";

const dataUrl = (buffer: Buffer, format: "jpeg" | "png" = "png") =>
  "data:image/" + format + ";base64," + buffer.toString("base64");

const blankImage = async (width: number, height: number, value: number) =>
  dataUrl(await sharp({ create: { width, height, channels: 3, background: { r: value, g: value, b: value } } }).png().toBuffer());

const modelResult = (questions: Array<Record<string, unknown>>, language: ExamLanguage = "ar", quality: Record<string, unknown> = { status: "good", issues: [] }, detectedLanguages: ExamLanguage[] = [language]) => ({
  choices: [{ message: { content: JSON.stringify({ examTitle: "", language, detectedLanguages, questions, quality }) } }],
});

const question = (text: string, confidence: "high" | "medium" | "low" = "high", extra: Record<string, unknown> = {}) => ({
  id: 1, number: "١", text, type: "text", options: [], optionLabels: [], confidence, uncertainParts: [], ...extra,
});

const urlToBuffer = (url: string) => Buffer.from(url.split(",")[1]!, "base64");

describe("OCR shared contract", () => {
  it("accepts all three exam languages and normalized aliases", () => {
    expect(toExamLanguage("ar-SA")).toBe("ar");
    expect(toExamLanguage("en-US")).toBe("en");
    expect(toExamLanguage("zh-Hans")).toBe("zh-CN");
    expect(OCR_JSON_SCHEMA.properties.language.enum).toEqual(["ar", "en", "zh-CN"]);
    expect(OCR_JSON_SCHEMA.properties.quality.properties.issues.items.enum).toContain("no_document");
    expect(OCR_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(OCR_JSON_SCHEMA.properties.questions.items.additionalProperties).toBe(false);
  });

  it("preserves printed numbering, option alignment, scripts and per-page confidence", () => {
    const result = normalizeOcrResult({
      examTitle: "汉语测试", language: "zh-CN", detectedLanguages: ["zh-CN", "en", "ar"],
      questions: [
        { id: 31, number: "一、", text: "选择正确的答案。", type: "multiple", options: ["", "夏天"], optionLabels: ["A", "B"], confidence: "high", uncertainParts: [] },
        { id: 11, number: "٣", text: "ما معنى كلمة مدرسة؟", type: "text", options: [], optionLabels: [], confidence: "low", uncertainParts: ["مدرسة"] },
        { id: 8, number: "3)", text: "What is the answer?", type: "text", options: [], optionLabels: [], confidence: "high", uncertainParts: [] },
      ], quality: { status: "good", issues: [] },
    });
    expect(result.questions.map(q => q.id)).toEqual([1, 2, 3]);
    expect(result.questions[0].number).toBe("一、");
    expect(result.questions[0].optionLabels).toEqual(["A", "B"]);
    expect(result.questions[0].options).toEqual(["", "夏天"]);
    expect(result.questions[1].number).toBe("٣");
    expect(result.questions[1].text).toBe("ما معنى كلمة مدرسة؟");
    expect(result.questions[2].text).toBe("What is the answer?");
    expect(result.detectedLanguages).toEqual(["zh-CN", "en", "ar"]);
    expect(result.quality.status).toBe("partial");
    expect(result.quality.confidence).toBe("medium");
  });

  it("never rejects a page with readable questions just because the model marked it insufficient", () => {
    const result = normalizeOcrResult({
      language: "ar", questions: [question("ما الإجابة؟")],
      quality: { status: "insufficient", issues: ["no_text", "cropped"] },
    });
    expect(result.quality.status).toBe("partial");
    expect(result.quality.confidence).toBe("high");
    expect(result.quality.issues).toEqual(["cropped"]);
  });

  it("recovers an omitted secondary language from substantial mixed-script text", () => {
    const result = normalizeOcrResult({
      language: "ar", detectedLanguages: ["ar"], questions: [question("اختر the correct answer")],
      quality: { status: "good", issues: [] },
    });
    expect(result.detectedLanguages).toEqual(["ar", "en"]);
  });

  it("distinguishes absent document from unreadable text without inventing questions", () => {
    const noDocument = normalizeOcrResult({ questions: [], quality: { status: "insufficient", issues: ["no_document"] } });
    const noText = normalizeOcrResult({ questions: [], quality: { status: "good", issues: [] } });
    expect(noDocument.quality.issues).toEqual(["no_document"]);
    expect(noText.quality.issues).toEqual(["no_text"]);
    expect(noDocument.quality.status).toBe("insufficient");
    expect(noText.questions).toEqual([]);
  });

  it("asks for mixed-language verbatim reading and question order", () => {
    const prompt = buildOcrPrompt("en");
    expect(prompt).toContain("NEVER translate");
    expect(prompt).toContain("Arabic dots");
    expect(prompt).toContain("Chinese strokes");
    expect(prompt).toContain("Arabic + English");
    expect(prompt).toContain("Keep each distinct question separate");
  });
});

describe("real Sharp image preparation", () => {
  it("rejects unsupported, corrupt and invalid image data", async () => {
    await expect(prepareOcrImage("data:image/svg+xml;base64,AAAA")).rejects.toMatchObject({ code: "invalid_image" });
    await expect(prepareOcrImage("*not-base64*")).rejects.toMatchObject({ code: "invalid_image" });
    await expect(prepareOcrImage(dataUrl(Buffer.alloc(200, 42)))).rejects.toMatchObject({ code: "unreadable_image" });
  });

  it("honors real EXIF orientation", async () => {
    const rotatedJpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#ffffff" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const rotated = await prepareOcrImage(dataUrl(rotatedJpeg, "jpeg"));
    expect(rotated.width).toBe(800);
    expect(rotated.height).toBe(1200);
  });

  it("downsizes a large camera image", async () => {
    // Exceed both output limits without allocating a 20 MP image during parallel test runs.
    const large = await sharp({ create: { width: 3000, height: 3800, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const resized = await prepareOcrImage(dataUrl(large, "jpeg"));
    expect(resized.width).toBeLessThanOrEqual(2600);
    expect(resized.height).toBeLessThanOrEqual(3600);
    expect(resized.lowResolution).toBe(false);
  }, 15_000);

  it("makes a low-contrast alternate while retaining the original", async () => {
    const faintBars = Buffer.from('<svg width="900" height="1200"><rect x="200" y="200" width="500" height="8" fill="#cacaca"/><rect x="200" y="300" width="430" height="8" fill="#cacaca"/></svg>');
    const input = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#d6d6d6" } })
      .composite([{ input: faintBars }]).png().toBuffer();
    const prepared = await prepareOcrImage(dataUrl(input));
    expect(prepared.lowContrast).toBe(true);
    const originalStats = await sharp(urlToBuffer(prepared.original)).stats();
    const alternateStats = await sharp(urlToBuffer(prepared.enhanced)).stats();
    expect(alternateStats.channels[0].stdev).toBeGreaterThan(originalStats.channels[0].stdev);
  });

  it("does not mark a bright page with sparse dark print as low light", async () => {
    const print = Buffer.from('<svg width="1000" height="1400"><rect x="250" y="300" width="500" height="15" fill="#111111"/><rect x="250" y="500" width="500" height="15" fill="#111111"/></svg>');
    const input = await sharp({ create: { width: 1000, height: 1400, channels: 3, background: "#ffffff" } })
      .composite([{ input: print }]).png().toBuffer();
    const prepared = await prepareOcrImage(dataUrl(input));
    expect(prepared.lowContrast).toBe(false);
  });

  it("preserves a skewed full view and removes obvious extra border only in the alternate", async () => {
    const page = await sharp({ create: { width: 1000, height: 1400, channels: 3, background: "#ffffff" } })
      .rotate(7, { background: "#202020" }).png().toBuffer();
    const prepared = await prepareOcrImage(dataUrl(page));
    expect(prepared.original).toMatch(/^data:image\/jpeg;base64,/);
    expect(prepared.width).toBeGreaterThan(1000);
    expect(prepared.height).toBeGreaterThan(1400);

    const bordered = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#202020" } })
      .composite([{ input: await sharp({ create: { width: 900, height: 1300, channels: 3, background: "#ffffff" } }).png().toBuffer(), left: 350, top: 350 }])
      .png().toBuffer();
    const withBorder = await prepareOcrImage(dataUrl(bordered));
    const alternateMeta = await sharp(urlToBuffer(withBorder.enhanced)).metadata();
    expect(withBorder.width).toBe(1600);
    expect(alternateMeta.width).toBeLessThan(withBorder.width);
  });
});

describe("bounded multilingual OCR attempts", () => {
  it.each([
    ["ar", "ما عاصمة المملكة؟", ["ar"]],
    ["en", "What is the capital?", ["en"]],
    ["zh-CN", "首都是哪里？", ["zh-CN"]],
    ["ar", "اختر the correct answer", ["ar", "en"]],
  ] as const)("retains %s and its mixed-language model report", async (language, text, languages) => {
    const image = await blankImage(1000, 1400, 255);
    let calls = 0;
    const invoke: VisionCompletion = async messages => {
      calls++;
      expect((messages[1].content as any[]).filter(p => p.type === "image_url")).toHaveLength(1);
      return modelResult([question(text)], language, { status: "good", issues: [] }, [...languages]);
    };
    const result = await extractExamImage(image, language, invoke);
    expect(result.questions[0].text).toBe(text);
    expect(result.detectedLanguages).toEqual([...languages]);
    expect(result.quality.status).toBe("good");
    expect(calls).toBe(1);
  });

  it("keeps a readable medium-resolution page even with an image warning", async () => {
    const image = await blankImage(600, 850, 108);
    let calls = 0;
    const result = await extractExamImage(image, "ar", async () => {
      calls++;
      return modelResult([question("السؤال ١: ما الإجابة؟")]);
    });
    expect(result.questions).toHaveLength(1);
    expect(result.quality.status).toBe("partial");
    expect(result.quality.issues).toContain("low_resolution");
    expect(calls).toBe(1);
  });

  it("retries weak text once, compares results and selects the stronger alternate", async () => {
    const image = await blankImage(900, 1200, 180);
    const images: string[] = [];
    const first = modelResult([question("سؤال غير واضح", "low", { uncertainParts: ["غير واضح"] })], "ar", { status: "partial", issues: ["blurry"] });
    const second = modelResult([question("ما ناتج ٢ + ٢؟", "high")]);
    let calls = 0;
    const result = await extractExamImage(image, "ar", async messages => {
      images.push((messages[1].content as any[]).find(p => p.type === "image_url").image_url.url);
      return calls++ === 0 ? first : second;
    });
    expect(calls).toBe(2);
    expect(images[0]).not.toBe(images[1]);
    expect(result.questions[0].text).toBe("ما ناتج ٢ + ٢؟");
    expect(result.quality.confidence).toBe("high");
  });

  it("does not lose readable numbered questions when the alternate rates a smaller subset higher", async () => {
    const image = await blankImage(900, 1200, 180);
    const firstQuestions = [1, 2, 3].map(number => question("Readable question " + number, "low", { number: String(number) }));
    const alternateQuestions = [1, 2].map(number => question("Clear question " + number, "high", { number: String(number) }));
    let calls = 0;
    const result = await extractExamImage(image, "en", async () =>
      calls++ === 0 ? modelResult(firstQuestions, "en", { status: "partial", issues: ["blurry"] }) : modelResult(alternateQuestions, "en"));
    expect(calls).toBe(2);
    expect(result.questions.map(q => q.number)).toEqual(["1", "2", "3"]);
  });

  it("reports no text only after both attempts, and preserves a partial first read if retry fails", async () => {
    const image = await blankImage(1000, 1400, 255);
    let calls = 0;
    const empty = modelResult([], "ar", { status: "insufficient", issues: ["no_text"] });
    const noText = await extractExamImage(image, "ar", async () => { calls++; return empty; });
    expect(calls).toBe(2);
    expect(noText.quality.status).toBe("insufficient");
    expect(noText.quality.issues).toContain("no_text");

    calls = 0;
    const partial = await extractExamImage(image, "ar", async () => {
      if (calls++ === 0) return modelResult([question("سؤال مقروء جزئيًا", "low")], "ar", { status: "partial", issues: ["blurry"] });
      throw new Error("fetch failed");
    });
    expect(calls).toBe(2);
    expect(partial.questions[0].text).toBe("سؤال مقروء جزئيًا");
  });

  it("uses the alternate after malformed model JSON, but not after a transport failure", async () => {
    const image = await blankImage(1000, 1400, 255);
    let calls = 0;
    const recovered = await extractExamImage(image, "en", async () => {
      return calls++ === 0 ? { choices: [{ message: { content: "not JSON" } }] } : modelResult([question("Recovered")], "en");
    });
    expect(calls).toBe(2);
    expect(recovered.questions[0].text).toBe("Recovered");
    calls = 0;
    await expect(extractExamImage(image, "en", async () => { calls++; throw new Error("fetch failed"); })).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });
});

describe("OCR route failure taxonomy", () => {
  const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });

  async function postOcr(invoke: VisionCompletion, imageBase64: unknown) {
    const app = express();
    app.use(express.json({ limit: "20mb" }));
    registerOcrRoute(app, invoke);
    const server = app.listen(0);
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const response = await fetch("http://127.0.0.1:" + port + "/api/ocr", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, language: "ar" }),
    });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as any };
  }

  it("returns safe input errors with a stable code", async () => {
    const response = await postOcr(async () => { throw new Error("must not invoke"); }, "*bad*");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_image");
    expect(response.cache).toBe("no-store");
  });

  it.each([
    [Object.assign(new Error("aborted"), { name: "TimeoutError" }), 504, "timeout"],
    [new Error("fetch failed"), 503, "unavailable"],
    [new Error("unexpected secret internal detail"), 500, "internal"],
  ] as const)("maps provider failure without exposing details", async (failure, status, code) => {
    const image = await blankImage(1000, 1400, 255);
    const response = await postOcr(async () => { throw failure; }, image);
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain("secret internal detail");
  });
});
