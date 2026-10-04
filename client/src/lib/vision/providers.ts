import type { DepthProvider, OCRDetection, OCRProvider, VisionDetection, VisionObjectType, VisionProvider } from '@shared/vision';
import type { VisionConfig } from './config';
import { classifyDirection, classifyVertical } from './safety';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const cocoTypes: Record<string, VisionObjectType> = {
  person: 'PERSON', chair: 'CHAIR', 'dining table': 'TABLE', bicycle: 'BICYCLE',
  car: 'VEHICLE', bus: 'VEHICLE', truck: 'VEHICLE', motorcycle: 'VEHICLE',
  'stop sign': 'SIGN', 'traffic light': 'SIGN',
};

/** EfficientDet-Lite0/COCO: only labels actually represented by the model are mapped. */
export class MediaPipeVisionProvider implements VisionProvider {
  private constructor(private readonly detector: import('@mediapipe/tasks-vision').ObjectDetector) {}
  static async open(config: VisionConfig): Promise<MediaPipeVisionProvider> {
    const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/vision/mediapipe');
    const detector = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/vision/efficientdet_lite0_int8.tflite' },
      runningMode: 'VIDEO', scoreThreshold: config.detectionThreshold, maxResults: 12,
    });
    return new MediaPipeVisionProvider(detector);
  }
  async detect(frame: HTMLVideoElement | HTMLCanvasElement, timestamp: number): Promise<VisionDetection[]> {
    const width=frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
    const height=frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
    if (!width || !height) return [];
    const result=this.detector.detectForVideo(frame,timestamp);
    return result.detections.flatMap((entry,index) => {
      const category=entry.categories[0], box=entry.boundingBox;
      if (!category || !box || !category.categoryName) return [];
      const boundingBox={x:clamp(box.originX/width),y:clamp(box.originY/height),width:clamp(box.width/width),height:clamp(box.height/height)};
      const mapped=cocoTypes[category.categoryName.toLowerCase()];
      const center=boundingBox.x+boundingBox.width/2;
      const type=mapped ?? (boundingBox.width*boundingBox.height>=0.1 && center>=0.3 && center<=0.7 ? 'UNKNOWN_OBSTACLE' : null);
      if (!type) return [];
      return [{
        id:`${timestamp}-${index}`,type,confidence:clamp(category.score),boundingBox,
        horizontalDirection:classifyDirection(boundingBox),verticalPosition:classifyVertical(boundingBox),
        approximateDistance:null,timestamp,source:'OBJECT_DETECTOR' as const,
        trackId:`${type}:${Math.round(center*5)}:${Math.round((boundingBox.y+boundingBox.height/2)*3)}`,
      }];
    });
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
