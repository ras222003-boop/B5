import { createReadStream, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * ONNX Runtime dynamically imports a .mjs factory using a runtime URL. In
 * Vite's development server this URL otherwise enters Vite's import pipeline
 * and triggers "This file is in /public and should not be imported from source".
 *
 * Serve only the pinned ORT files and MediaPipe ES-module worker runtime as raw HTTP assets
 * before Vite's transforms. Production builds continue using normal publicDir.
 */
const ONNX_RUNTIME_FILES = new Set([
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]);

const RUNTIME_PATH = '/vision/onnx/';
const ASSET_DIR = path.resolve(import.meta.dirname, '../client/public/vision/onnx');
const MEDIAPIPE_FILES=new Set(['vision_wasm_module_internal.js','vision_wasm_module_internal.wasm']);
const MEDIAPIPE_PATH='/vision/mediapipe/';

function authorizedForPrivatePreview(header: string | undefined) {
  const username = process.env.BASIRA_PREVIEW_ACCESS_USERNAME;
  const password = process.env.BASIRA_PREVIEW_ACCESS_PASSWORD;
  if (!username && !password) return true; // Regular app: ONNX assets are public.
  if (!username || !password || !header?.startsWith('Basic ')) return false;
  let supplied: string;
  try { supplied = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return false; }
  const expected = Buffer.from(`${username}:${password}`, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function vitePluginOnnxRuntimeRawAssets(): Plugin {
  return {
    name: 'basira-onnx-runtime-raw-static',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let filename: string;
        let directory=ASSET_DIR;
        try {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          if(pathname.startsWith(MEDIAPIPE_PATH)){
            filename=pathname.slice(MEDIAPIPE_PATH.length);
            if(!MEDIAPIPE_FILES.has(filename))return next();
            directory=path.resolve(ASSET_DIR,'../mediapipe');
          }else{
            if (!pathname.startsWith(RUNTIME_PATH)) return next();
            filename = pathname.slice(RUNTIME_PATH.length);
            if (!ONNX_RUNTIME_FILES.has(filename)) return next();
          }
        } catch { return next(); }

        // Manus private preview uses Basic Auth. Asset middleware MUST NOT
        // bypass that gate, even if plugin ordering changes across environments.
        if (!authorizedForPrivatePreview(req.headers.authorization)) {
          res.statusCode = 401;
          res.setHeader('WWW-Authenticate', 'Basic realm="Basira private preview", charset="UTF-8"');
          res.setHeader('Cache-Control', 'no-store');
          res.end('Authorization required');
          return;
        }

        const filePath = path.join(directory, filename);
        let size: number;
        try { size = statSync(filePath).size; }
        catch {
          res.statusCode = 404;
          res.end('ONNX runtime asset missing');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', filename.endsWith('.js')||filename.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'application/wasm');
        res.setHeader('Content-Length', size);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'Authorization');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = createReadStream(filePath);
        stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.destroy(); });
        stream.pipe(res);
      });
    },
  };
}
