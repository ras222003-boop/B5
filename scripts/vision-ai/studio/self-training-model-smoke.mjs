/** Offline model-load smoke on generated pixels. No dataset images or network. */
import { resolve } from 'node:path';
import sharp from 'sharp';
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = resolve('client/public/vision/models') + '/';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dddddd"/><path d="M20 220v-40h60v-40h60v-40h60v-40h100v160z" fill="#888888"/></svg>';
const pixels = await sharp(Buffer.from(svg)).png().toBuffer();
const model = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512',
  { device: 'cpu', dtype: 'q8' });
try {
  const output = await model(new Blob([pixels], { type: 'image/png' }));
  if (!Array.isArray(output) || !output.length) throw new Error('No segmentation output');
  console.log(JSON.stringify({ offlineModelLoaded: true, syntheticImageAnalyzed: true,
    labels: output.length, stairsDetected: output.some(x => x.label === 'stairs') }));
} finally { await model.dispose(); }
