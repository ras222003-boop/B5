/** Lab-only adapters. This module is not imported by the application. */
import { MediaPipeVisionProvider } from '../../client/src/lib/vision/providers';
import { WorkerObjectProvider } from '../../client/src/lib/vision/workerObjectProvider';
import { DEFAULT_VISION_CONFIG } from '../../client/src/lib/vision/config';
import { imagePosition } from './stairs-position.mjs';

export async function benchmark({ variant, samples, taxonomy, contract, task }) {
  const start = performance.now();
  let detect, close, backend;
  if (variant === 'baseline' || variant === 'baseline-worker') {
    const provider = variant === 'baseline-worker'
      ? await WorkerObjectProvider.open(DEFAULT_VISION_CONFIG)
      : await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
    const byType = new Map(taxonomy.classes.filter(c => c.baselineLabels.length).map(c => [c.runtimeType, c.id]));
    detect = async canvas => (await provider.detect(canvas, performance.now())).map(d => ({ classId: byType.get(d.type) ?? -1,
      score: d.confidence, box: [d.boundingBox.x, d.boundingBox.y, d.boundingBox.width, d.boundingBox.height] }));
    close = () => provider.close(); backend = variant === 'baseline-worker' ? 'mediapipe-wasm-worker' : 'mediapipe-wasm-main';
  } else {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = '/__lab/ort/';
    const session = await ort.InferenceSession.create('/__lab/model.onnx', { executionProviders: ['wasm'] });
    const modelCanvas = document.createElement('canvas'); modelCanvas.width = modelCanvas.height = 320;
    detect = async canvas => {
      const context = modelCanvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, 320, 320);
      const rgba = context.getImageData(0, 0, 320, 320).data, tensor = new Float32Array(3 * 320 * 320);
      for (let i = 0; i < 320 * 320; i++) for (let c = 0; c < 3; c++) tensor[c * 320 * 320 + i] = rgba[i * 4 + c] / 255;
      const output = await session.run({ image: new ort.Tensor('float32', tensor, [1, 3, 320, 320]) });
      const predictions = [];
      for (let i = 0; i < output.scores.data.length; i++) {
        const classIndex = Number(output.labels.data[i]) - 1, box = output.boxes.data.slice(i * 4, i * 4 + 4);
        if (!contract.categories[classIndex]) throw new Error('candidate label outside contract');
        const [x0, y0, x1, y1] = Array.from(box, n => Math.max(0, Math.min(1, n)));
        if (x1 > x0 && y1 > y0) predictions.push({ classId: contract.categories[classIndex].id,
          score: Number(output.scores.data[i]), box: [x0, y0, x1 - x0, y1 - y0] });
      }
      return predictions;
    };
    close = () => session.release(); backend = 'onnx-wasm-main';
  }
  const loadMs = performance.now() - start;
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  const context = canvas.getContext('2d'), result = [], gaps = [];
  const draw = async id => { const image = new Image(); image.src = `/__lab/frame/${id}`; await image.decode(); context.drawImage(image, 0, 0, 640, 480); };
  let timer;
  try {
    await draw(0);
    for (let i = 0; i < 5; i++) { await detect(canvas); await new Promise(r => setTimeout(r, 25)); }
    let lastPulse = performance.now();
    timer = setInterval(() => { const now = performance.now(); gaps.push(now - lastPulse); lastPulse = now; }, 10);
    const measuredAt = performance.now();
    for (let i = 0; i < samples.length; i++) {
      await draw(i); const before = performance.now(), predictions = await detect(canvas), inferenceMs = performance.now() - before;
      const scoped = task === 'basira-stairs-v1' ? predictions.filter(p=>contract ? [2301,2302,2303].includes(p.classId) : p.classId===23)
        .map(p=>({...p,position:imagePosition(p.box)})) : predictions;
      result.push({ id: samples[i].id, imageSha256: samples[i].sha256, predictions:scoped, inferenceMs });
      await new Promise(r => setTimeout(r, 25));
    }
    return { samples: result, backend, browser: navigator.userAgent, loadMs, measurementDurationMs: performance.now() - measuredAt,
      maxMainThreadTimerGapMs: gaps.length ? Math.max(...gaps) : null };
  } finally { if (timer) clearInterval(timer); await close(); }
}
