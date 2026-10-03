import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamImagePreparationError, ocrImageDimensions, prepareExamUpload } from "./examImage";

afterEach(() => vi.unstubAllGlobals());

describe("OCR image bounds", () => {
  it("keeps readable phone-paper dimensions and limits oversized portrait or landscape captures", () => {
    expect(ocrImageDimensions(1800, 2400)).toEqual({ width: 1800, height: 2400 });
    expect(ocrImageDimensions(4000, 6000)).toEqual({ width: 2400, height: 3600 });
    expect(ocrImageDimensions(6000, 4000)).toEqual({ width: 2600, height: 1733 });
  });

  it("rejects unusable dimensions before allocating a canvas", () => {
    expect(() => ocrImageDimensions(0, 2400)).toThrow(ExamImagePreparationError);
    expect(() => ocrImageDimensions(Number.NaN, 2400)).toThrow(ExamImagePreparationError);
  });

  it("preserves a valid upload and its EXIF metadata for the server", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1800, height: 2400, close }));
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() { this.result = "data:image/jpeg;base64,ORIGINAL"; this.onload?.(); }
    });
    const result = await prepareExamUpload({ type: "image/jpeg", size: 2_000_000 } as File);
    expect(result).toBe("data:image/jpeg;base64,ORIGINAL");
    expect(close).toHaveBeenCalledOnce();
  });

  it("resizes an oversized phone photo before upload", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: "low", drawImage }),
      toDataURL: () => "data:image/jpeg;base64,RESIZED",
    };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 6000, close }));
    vi.stubGlobal("document", { createElement: () => canvas });
    const result = await prepareExamUpload({ type: "image/png", size: 16_000_000 } as File);
    expect(result).toBe("data:image/jpeg;base64,RESIZED");
    expect([canvas.width, canvas.height]).toEqual([2400, 3600]);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
