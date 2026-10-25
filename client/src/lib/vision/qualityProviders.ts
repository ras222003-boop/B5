import type { VisionDetection, VisionProvider } from "@shared/vision";
import { COCO_LABELS } from "./cocoLabels";
import { normalizeObjectDetections } from "./providers";
import { boxIntersectionOverUnion } from "./objectTracking";
import * as ort from "onnxruntime-web/wasm";

const labels = Object.keys(COCO_LABELS);
export function mergeDetections(
  detections: VisionDetection[],
  iou = 0.55,
  limit = 100
) {
  const kept: VisionDetection[] = [];
  for (const d of [...detections].sort((a, b) => b.confidence - a.confidence)) {
    if (
      !kept.some(
        k =>
          k.cocoClass === d.cocoClass &&
          boxIntersectionOverUnion(k.boundingBox, d.boundingBox) > iou
      )
    )
      kept.push(d);
    if (kept.length === limit) break;
  }
  return kept;
}
/** Official YOLOX export: raw grid offsets, BGR 0..255, top-left letterbox, no normalization. */
export function decodeYoloX(
  data: Float32Array,
  width: number,
  height: number,
  timestamp: number,
  minimum = 0.01,
  size = 416
): VisionDetection[] {
  const scale = Math.min(size / width, size / height),
    raw = [];
  let row = 0;
  for (const stride of [8, 16, 32])
    for (let y = 0; y < size / stride; y++)
      for (let x = 0; x < size / stride; x++, row++) {
        const at = row * 85,
          objectness = data[at + 4];
        let score = 0,
          label = 0;
        for (let c = 0; c < 80; c++) {
          const value = objectness * data[at + 5 + c];
          if (value > score) {
            score = value;
            label = c;
          }
        }
        if (!Number.isFinite(score) || score < minimum || score > 1) continue;
        const cx = ((data[at] + x) * stride) / scale,
          cy = ((data[at + 1] + y) * stride) / scale,
          w = (Math.exp(data[at + 2]) * stride) / scale,
          h = (Math.exp(data[at + 3]) * stride) / scale;
        raw.push({
          categories: [{ categoryName: labels[label], score }],
          boundingBox: {
            originX: cx - w / 2,
            originY: cy - h / 2,
            width: w,
            height: h,
          },
        });
      }
  return normalizeObjectDetections(raw, width, height, timestamp).map(d => ({
    ...d,
    evidence: ["YOLOX_COCO_CLASSIFICATION"],
  }));
}
export class YoloXProvider implements VisionProvider {
  private closed = false;
  private constructor(
    private session: ort.InferenceSession,
    private minimum = 0.01
  ) {}
  static async open(bytes: Uint8Array, minimum = 0.01) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = "/vision/onnx/";
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    if (
      JSON.stringify(session.inputNames) !== '["images"]' ||
      JSON.stringify(session.outputNames) !== '["output"]'
    ) {
      await session.release();
      throw new Error("yolox_contract_names");
    }
    return new YoloXProvider(session, minimum);
  }
  async detect(
    frame: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
    timestamp: number
  ) {
    if (this.closed) throw new Error("yolox_closed");
    const width = "videoWidth" in frame ? frame.videoWidth : frame.width,
      height = "videoHeight" in frame ? frame.videoHeight : frame.height;
    const canvas = new OffscreenCanvas(416, 416),
      ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, 416, 416);
    const ratio = Math.min(416 / width, 416 / height);
    ctx.drawImage(
      frame,
      0,
      0,
      Math.floor(width * ratio),
      Math.floor(height * ratio)
    );
    const pixels = ctx.getImageData(0, 0, 416, 416).data,
      input = new Float32Array(3 * 416 * 416);
    for (let i = 0; i < 416 * 416; i++) {
      input[i] = pixels[i * 4 + 2];
      input[416 * 416 + i] = pixels[i * 4 + 1];
      input[2 * 416 * 416 + i] = pixels[i * 4];
    }
    const result = await this.session.run({
        images: new ort.Tensor("float32", input, [1, 3, 416, 416]),
      }),
      output = result.output;
    if (
      output.type !== "float32" ||
      JSON.stringify(output.dims) !== "[1,3549,85]"
    )
      throw new Error("yolox_contract_shape");
    return mergeDetections(
      decodeYoloX(
        output.data as Float32Array,
        width,
        height,
        timestamp,
        this.minimum
      )
    );
  }
  async close() {
    this.closed = true;
    await this.session.release();
  }
}
/** Full image plus four overlapping crops; intended for stills, benchmarked before selection. */
export async function detectTiled(
  provider: VisionProvider,
  frame: HTMLCanvasElement | OffscreenCanvas,
  timestamp: number
) {
  const detections = await provider.detect(frame, timestamp),
    w = frame.width,
    h = frame.height;
  let pass = 0;
  for (const top of [0, 0.38])
    for (const left of [0, 0.38]) {
      const x = Math.round(left * w),
        y = Math.round(top * h),
        cw = w - x < 0.62 * w ? w - x : Math.round(0.62 * w),
        ch = h - y < 0.62 * h ? h - y : Math.round(0.62 * h);
      const canvas = new OffscreenCanvas(cw, ch);
      canvas.getContext("2d")!.drawImage(frame, x, y, cw, ch, 0, 0, cw, ch);
      const found = await provider.detect(canvas, timestamp + ++pass * 0.01);
      detections.push(
        ...found
          .filter(
            d =>
              !(
                (x > 0 && d.boundingBox.x < 0.008) ||
                (y > 0 && d.boundingBox.y < 0.008) ||
                (x + cw < w && d.boundingBox.x + d.boundingBox.width > 0.992) ||
                (y + ch < h && d.boundingBox.y + d.boundingBox.height > 0.992)
              )
          )
          .map(d => ({
            ...d,
            id: `tile${pass}-${d.id}`,
            timestamp,
            boundingBox: {
              x: (x + d.boundingBox.x * cw) / w,
              y: (y + d.boundingBox.y * ch) / h,
              width: (d.boundingBox.width * cw) / w,
              height: (d.boundingBox.height * ch) / h,
            },
          }))
      );
      canvas.width = canvas.height = 0;
    }
  return mergeDetections(detections);
}
