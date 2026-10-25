import type { DepthProvider, OCRDetection, OCRProvider, VisionDetection, VisionObjectType, VisionProvider } from '@shared/vision';
import type { VisionConfig } from './config';
import { classifyDirection, classifyVertical } from './safety';
import {COCO_LABELS} from './cocoLabels';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const cocoTypes: Readonly<Record<string, VisionObjectType>> = {
  person: 'PERSON', chair: 'CHAIR', 'dining table': 'TABLE', bicycle: 'BICYCLE',
  car: 'CAR', bus: 'BUS', truck: 'TRUCK', motorcycle: 'MOTORCYCLE',
  'stop sign': 'SIGN', 'traffic light': 'SIGN',
  couch: 'SOFA', bed: 'BED', backpack: 'BACKPACK', handbag: 'HANDBAG',
  suitcase: 'SUITCASE', bottle: 'BOTTLE', dog: 'DOG', cat: 'CAT',
};

interface RawDetection {
  categories: { categoryName?: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}
/** Validates pixel geometry before clipping. Unknown COCO classes remain unnamed objects. */
export function normalizeObjectDetections(entries: readonly RawDetection[], width: number, height: number, timestamp: number): VisionDetection[] {
  if (![width, height, timestamp].every(Number.isFinite) || width <= 0 || height <= 0) return [];
  const candidates: VisionDetection[] = [];
  for (const [index, entry] of Array.from(entries.entries())) {
    const category = entry.categories?.[0], box = entry.boundingBox;
    if (!category?.categoryName || !Number.isFinite(category.score) || category.score < 0 || category.score > 1 || !box) continue;
    if (![box.originX, box.originY, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) continue;
    const x = clamp(box.originX / width), y = clamp(box.originY / height);
    const right = clamp((box.originX + box.width) / width), bottom = clamp((box.originY + box.height) / height);
    if (right <= x || bottom <= y) continue;
    const boundingBox = { x, y, width: right - x, height: bottom - y };
    const name=category.categoryName.toLowerCase(),type = cocoTypes[name] ?? 'UNKNOWN_OBSTACLE';
    candidates.push({
      id: `${timestamp}-${index}`, type, confidence: category.score, boundingBox,
      horizontalDirection: classifyDirection(boundingBox), verticalPosition: classifyVertical(boundingBox),
      approximateDistance: null, timestamp, source: 'OBJECT_DETECTOR', confidenceKind: 'MODEL_SCORE',
      evidence: ['EFFICIENTDET_COCO_CLASSIFICATION'],
      ...(COCO_LABELS[name]?{cocoClass:name}:{}),
    });
  }
  // Class-aware NMS prevents duplicate names while preserving overlapping different objects.
  const kept:VisionDetection[]=[];
  for(const candidate of candidates.sort((a,b)=>b.confidence-a.confidence))
    if(!kept.some(other=>(other.cocoClass??other.type)===(candidate.cocoClass??candidate.type)&&boxIoU(other.boundingBox,candidate.boundingBox)>.6))kept.push(candidate);
  return kept;
}

function boxIoU(a: VisionDetection['boundingBox'], b: VisionDetection['boundingBox']): number {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/** EfficientDet-Lite0/COCO: only labels actually represented by the model are mapped. */
export class MediaPipeVisionProvider implements VisionProvider {
  private constructor(private readonly detector: import('@mediapipe/tasks-vision').ObjectDetector) {}
  static async open(config: VisionConfig,benchmarkModelBytes?:Uint8Array,maxResults=12): Promise<MediaPipeVisionProvider> {
    const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/vision/mediapipe',typeof document==='undefined');
    const detector = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: benchmarkModelBytes?{modelAssetBuffer:benchmarkModelBytes}:{ modelAssetPath: '/vision/efficientdet_lite0_int8.tflite' },
      runningMode: 'VIDEO', scoreThreshold: config.detectionThreshold, maxResults,
    });
    return new MediaPipeVisionProvider(detector);
  }
  async detect(frame: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas, timestamp: number): Promise<VisionDetection[]> {
    const width='videoWidth' in frame ? frame.videoWidth : frame.width;
    const height='videoHeight' in frame ? frame.videoHeight : frame.height;
    if (!width || !height) return [];
    const result=this.detector.detectForVideo(frame,timestamp);
    return normalizeObjectDetections(result.detections, width, height, timestamp);
  }
  async close() { this.detector.close(); }
}

/** A web page has no portable metric depth stream; native wrappers can replace this provider. */
export class UnavailableDepthProvider implements DepthProvider {
  async read(_detection: VisionDetection) { return null; }
  async close() { /* no resources */ }
}

function languageOf(text: string): OCRDetection['language'] {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  return /[A-Za-z]/.test(text) ? 'en' : 'unknown';
}

/** Tesseract worker and all three trained-data files are served locally. */
export class TesseractOCRProvider implements OCRProvider {
  private worker: import('tesseract.js').Worker | null = null;
  private init: Promise<import('tesseract.js').Worker> | null = null;
  private disposed = false;
  private async ready() {
    if (this.disposed) throw new Error('ocr_closed');
    this.init ??= (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const worker = await createWorker(['ara','eng','chi_sim'], OEM.LSTM_ONLY, {
        workerPath:'/vision/tesseract/worker.min.js',
        corePath:'/vision/tesseract/core', langPath:'/vision/tesseract/lang',
        workerBlobURL:false,
      });
      if (this.disposed) { await worker.terminate(); throw new Error('ocr_closed'); }
      this.worker=worker;
      return worker;
    })().catch(error => { this.init=null; throw error; });
    return this.init;
  }
  async recognize(frame: {blob:Blob;width:number;height:number}, timestamp: number): Promise<OCRDetection[]> {
    const worker=await this.ready();
    const result=await worker.recognize(frame.blob, {}, {text:true,blocks:true});
    const lines=result.data.blocks?.flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines))??[];
    return lines.map(line=>({
      text:line.text.trim().slice(0,160),confidence:clamp(line.confidence/100),
      boundingBox:{x:clamp(line.bbox.x0/frame.width),y:clamp(line.bbox.y0/frame.height),width:clamp((line.bbox.x1-line.bbox.x0)/frame.width),height:clamp((line.bbox.y1-line.bbox.y0)/frame.height)},
      timestamp,language:languageOf(line.text),
    })).filter(line=>line.text.length>=2 && line.confidence>=0.35);
  }
  async close() { this.disposed=true; if(this.worker) await this.worker.terminate(); else if(this.init) await this.init.catch(()=>{}); this.worker=null; }
}
