import {
  MediaPipeVisionProvider,
  TesseractOCRProvider,
} from "../../../../client/src/lib/vision/providers";
import { DEFAULT_VISION_CONFIG } from "../../../../client/src/lib/vision/config";
import { SegFormerSceneProvider } from "../../../../client/src/lib/vision/modelProviders";
import { detectionsFromSegmentation } from "../../../../client/src/lib/vision/segmentation";
let detector,
  ocr,
  segmenter,
  timestamp = 0;
export async function analyzeLocalStairs(url) {
  segmenter ??= await SegFormerSceneProvider.open();
  const response = await fetch(url);
  if (!response.ok) throw new Error('Local stairs image unavailable');
  const grid = await segmenter.segment(await response.blob(), performance.now());
  return detectionsFromSegmentation(grid)
    .filter(d => d.type === 'STAIRS_UNCERTAIN')
    .map(d => ({ classId: 2303,
      box: [d.boundingBox.x, d.boundingBox.y, d.boundingBox.width, d.boundingBox.height],
      score: d.confidence, confidenceKind: 'region_heuristic_not_calibrated' }));
}
export async function analyzeLocalImage(
  url,
  taxonomy,
  { withOCR = true } = {}
) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / image.naturalWidth);
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const detections = [],
    text = [],
    failures = [];
  try {
    detector ??= await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
    timestamp = Math.max(timestamp + 1, performance.now());
    const mapping = new Map(
      taxonomy.classes
        .filter(c => c.baselineLabels?.length)
        .map(c => [c.runtimeType, c.id])
    );
    for (const d of await detector.detect(canvas, timestamp)) {
      const classId = mapping.get(d.type);
      if (classId)
        detections.push({
          classId,
          score: d.confidence,
          box: [
            d.boundingBox.x,
            d.boundingBox.y,
            d.boundingBox.width,
            d.boundingBox.height,
          ],
        });
    }
  } catch (e) {
    failures.push({
      capability: "objectDetector",
      error: String(e.message).slice(0, 300),
    });
  }
  if (withOCR)
    try {
      ocr ??= new TesseractOCRProvider();
      const blob = await new Promise(ok => canvas.toBlob(ok, "image/png"));
      for (const line of await ocr.recognize(
        { blob, width: canvas.width, height: canvas.height },
        performance.now()
      )) {
        const b = line.boundingBox;
        if (b.width <= 0 || b.height <= 0 || b.x >= 1 || b.y >= 1) continue;
        text.push({
          text: line.text,
          score: line.confidence,
          box: [
            b.x,
            b.y,
            Math.min(b.width, 1 - b.x),
            Math.min(b.height, 1 - b.y),
          ],
        });
      }
    } catch (e) {
      failures.push({
        capability: "ocr",
        error: String(e.message).slice(0, 300),
      });
    }
  return { detections, text, failures };
}
export async function closeLocalModels() {
  await detector?.close();
  await ocr?.close();
  await segmenter?.close();
  detector = ocr = segmenter = null;
}
