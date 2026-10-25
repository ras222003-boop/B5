import type { VisionDetection } from "@shared/vision";
import type { AlignedObjectMask, ColorPixels } from "./objectColors";
export interface ProposedMask {
  objectId: string;
  data: Uint8Array;
  score: number;
  accepted: boolean;
  reason: string;
  mask: AlignedObjectMask;
}
/** Installed decoder accepts point labels 0/1 only. These heuristic points are NOT native box prompts. */
export function pointPromptsForBox(
  frame: Pick<ColorPixels, "width" | "height">,
  d: VisionDetection
) {
  const b = d.boundingBox,
    px = (x: number) => Math.max(0, Math.min(frame.width - 1, x * frame.width)),
    py = (y: number) =>
      Math.max(0, Math.min(frame.height - 1, y * frame.height));
  return {
    points: [
      [px(b.x + b.width / 2), py(b.y + b.height / 2)],
      [px(b.x - 0.08 * b.width), py(b.y - 0.08 * b.height)],
      [px(b.x + 1.08 * b.width), py(b.y - 0.08 * b.height)],
      [px(b.x - 0.08 * b.width), py(b.y + 1.08 * b.height)],
      [px(b.x + 1.08 * b.width), py(b.y + 1.08 * b.height)],
    ],
    labels: [1, 0, 0, 0, 0],
  };
}
/** Geometric checks and a model score are rejection heuristics, not calibrated mask accuracy. */
export function qualifyObjectMask(
  frame: ColorPixels,
  d: VisionDetection,
  data: Uint8Array,
  score: number
): ProposedMask {
  let total = 0,
    inside = 0;
  const b = d.boundingBox;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++)
      if (data[y * frame.width + x]) {
        total++;
        if (
          (x + 0.5) / frame.width >= b.x &&
          (x + 0.5) / frame.width <= b.x + b.width &&
          (y + 0.5) / frame.height >= b.y &&
          (y + 0.5) / frame.height <= b.y + b.height
        )
          inside++;
      }
  const coverage = inside / (b.width * b.height * frame.width * frame.height),
    accepted =
      data.length === frame.width * frame.height &&
      score >= 0.9 &&
      total >= 24 &&
      inside / total >= 0.92 &&
      coverage >= 0.08 &&
      coverage <= 0.95;
  return {
    objectId: d.trackId ?? d.id,
    data,
    score,
    accepted,
    reason: accepted ? "MODEL_SCORE_AND_GEOMETRY" : "MASK_UNCERTAIN",
    mask: {
      objectId: d.trackId ?? d.id,
      frameId: frame.frameId,
      width: frame.width,
      height: frame.height,
      data,
      alignmentVerified: true,
      source: "INSTANCE_SEGMENTATION",
    },
  };
}
/** Local SlimSAM q8. One embedding per exact frame; no cache can cross camera frames. */
export class SlimSamObjectMasks {
  private constructor(
    private model: import("@huggingface/transformers").SamModel,
    private processor: import("@huggingface/transformers").SamProcessor,
    private library: typeof import("@huggingface/transformers")
  ) {}
  static async open() {
    const lib = await import("@huggingface/transformers");
    lib.env.allowLocalModels = true;
    lib.env.allowRemoteModels = false;
    // Absolute same-origin model path; no mutation of the existing scene-model local root.
    lib.env.backends.onnx.wasm!.wasmPaths = "/vision/onnx/";
    lib.env.backends.onnx.wasm!.numThreads = 1;
    const path = "/api/vision/object-quality/assets/slimsam/";
    const [model, processor] = await Promise.all([
      lib.SamModel.from_pretrained(path, {
        device: "wasm",
        dtype: "q8",
        local_files_only: true,
      }),
      lib.AutoProcessor.from_pretrained(path, { local_files_only: true }),
    ]);
    return new SlimSamObjectMasks(
      model as import("@huggingface/transformers").SamModel,
      processor as import("@huggingface/transformers").SamProcessor,
      lib
    );
  }
  async segment(
    frame: ColorPixels,
    detections: readonly VisionDetection[]
  ): Promise<ProposedMask[]> {
    const objects = detections
      .filter(d => d.cocoClass !== "person")
      .slice(0, 3);
    if (!objects.length) return [];
    const image = new this.library.RawImage(
        frame.data,
        frame.width,
        frame.height,
        4
      ),
      prompts = objects.map(d => pointPromptsForBox(frame, d));
    // This export has no input_boxes and no label-2/3 corner embeddings.
    // A hollow/occluded object may have a background centre; this mode remains research-only.
    const inputs = await this.processor(image, {
      input_points: prompts.map(p => p.points),
      input_labels: prompts.map(p => p.labels),
    });
    const output = await this.model(inputs),
      processed = await this.processor.post_process_masks(
        output.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes
      );
    const masks = processed[0],
      scores = output.iou_scores.data as Float32Array,
      size = frame.width * frame.height,
      result: ProposedMask[] = [];
    if (
      masks.dims[0] !== objects.length ||
      masks.dims[1] !== 3 ||
      masks.dims[2] !== frame.height ||
      masks.dims[3] !== frame.width
    )
      throw new Error("slimsam_mask_contract");
    for (let i = 0; i < objects.length; i++) {
      let best = 0;
      for (let c = 1; c < 3; c++)
        if (scores[i * 3 + c] > scores[i * 3 + best]) best = c;
      result.push(
        qualifyObjectMask(
          frame,
          objects[i],
          new Uint8Array(
            masks.data.slice(
              (i * 3 + best) * size,
              (i * 3 + best + 1) * size
            ) as Uint8Array
          ),
          scores[i * 3 + best]
        )
      );
    }
    // WASM tensors are owned by Transformers.js on CPU; release device-backed values when present.
    for (const value of Object.values(output))
      if (value && typeof value === "object" && "dispose" in value)
        (value as { dispose: () => void }).dispose();
    return result;
  }
  async close() {
    await this.model.dispose();
  }
}
