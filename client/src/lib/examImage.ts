const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_DIRECT_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 34_000_000;
const MAX_OUTPUT_WIDTH = 2600;
const MAX_OUTPUT_HEIGHT = 3600;

export type ExamImageError = "unsupported" | "tooLarge" | "unreadable";

export class ExamImagePreparationError extends Error {
  constructor(public readonly kind: ExamImageError) {
    super(kind);
  }
}

export function ocrImageDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ExamImagePreparationError("unreadable");
  }
  const scale = Math.min(1, MAX_OUTPUT_WIDTH / width, MAX_OUTPUT_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new ExamImagePreparationError("unreadable"));
    reader.onerror = () => reject(new ExamImagePreparationError("unreadable"));
    reader.readAsDataURL(blob);
  });
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older browsers may not support the orientation option; use their image decoder.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new ExamImagePreparationError("unreadable"));
      image.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new ExamImagePreparationError("unreadable");
  }
}

/** Preserve ordinary uploads and their EXIF orientation. Resize only files the server would reject. */
export async function prepareExamUpload(file: File): Promise<string> {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) throw new ExamImagePreparationError("unsupported");
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new ExamImagePreparationError("tooLarge");

  const decoded = await decodeImage(file);

  try {
    if (file.size <= MAX_DIRECT_BYTES && decoded.width * decoded.height <= MAX_INPUT_PIXELS) {
      return await readDataUrl(file);
    }

    const size = ocrImageDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ExamImagePreparationError("unreadable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, size.width, size.height);
    const result = canvas.toDataURL("image/jpeg", 0.9);
    if (!result.startsWith("data:image/jpeg;base64,")) throw new ExamImagePreparationError("unreadable");
    // The server accepts up to 14 MiB of decoded image data.
    if (result.length > MAX_DIRECT_BYTES * 1.38) throw new ExamImagePreparationError("tooLarge");
    return result;
  } finally {
    decoded.release();
  }
}
