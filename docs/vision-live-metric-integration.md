# Live vision and experimental metres

## Source review and reuse

| Source | Reviewed revision | Licence | Decision |
| --- | --- | --- | --- |
| [Google MediaPipe web samples](https://github.com/google-ai-edge/mediapipe-samples-web) | `c4f0f67` | [Apache-2.0](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/LICENSE) | The sample confirms drawing detections in the detector's native video coordinates. Basira already depends on `@mediapipe/tasks-vision@1.0.1`, so its existing EfficientDet provider is reused. No sample source was copied. |
| [en970/depth-realtime](https://github.com/en970/depth-realtime) | `7a01e62` | [MIT](https://github.com/en970/depth-realtime/blob/main/LICENSE) | Reviewed its single-inference-loop and browser backend choices. Its Depth Anything V2 Small checkpoint is **relative** and cannot supply metres. No source or weights were imported. The clone contains an invalid macOS cache path on Windows, so individual source files could not be checked out there; the upstream README and licence were inspected on GitHub. |
| [MDN speak-easy-synthesis](https://github.com/mdn/dom-examples/tree/main/web-speech-api/speak-easy-synthesis) | `252de78` | [CC0-1.0](https://github.com/mdn/dom-examples/blob/main/LICENSE) | Reviewed voice synthesis API usage. Basira's existing priority-aware speech engine is reused; no example source was copied. |
| [Depth Anything V2 Metric Small](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth) | Existing Basira conversion | Apache-2.0 code and Small weights; see [metric-depth.md](metric-depth.md) | Preserved the original Hypersim metric FP32 ONNX bytes and checksum. No relative weights or new model were introduced. |

The three reference repositories were cloned outside `B5` for inspection. No new runtime dependency or upstream source file was added. This keeps the existing commercial licence obligations: the metric model's Apache licence and notice remain with its distributed assets, while the installed packages retain their own notices.

## Implementation

- `VisionPipeline` continues to use one detector pass per camera frame and one non-overlapping metric inference. A metric result and its detection boxes carry the same `frameId`, source dimensions, and capture time. It never creates a `DepthReading` for AI output, so the safety fusion path cannot consume the estimate.
- The **Measure now and speak result** button requests a frame captured *after* the press. It waits for that frame's result, or reports a specific reason. Model loading, low light, stale inference, invalid or inconsistent depth, low confidence, and out-of-range values do not produce a number. Stopping measurement cancels pending requests.
- `LiveVisionOverlay` draws detector boxes over the visible camera preview. Video and SVG use the same contain geometry; the native RGB canvas has already been rotated together with native depth. Object names and directions can appear on every recent detection frame. A number is drawn only when a valid measurement matches that exact frame and object, and is at most two seconds old. It is labelled experimental. Asynchronous inference may finish too late for a moving live overlay; the separate result list and on-demand spoken result remain available in that case.
- The existing `AutoMeterSpeechPacer` and speech engine provide optional paced automatic announcements and an on-demand answer at information priority. Higher-priority safety announcements retain priority. The on-demand answer is also written to an accessible live status region.
- The interface shows model load and most recent inference times in milliseconds. Offscreen inference canvases are released after use. OCR, scene recognition, maps, and native-depth paths retain their existing providers.

The new code is limited to a small overlay renderer, frame geometry helper, fresh-request handling, and selection of a spoken result. They were needed because none of the reviewed samples provides Basira's frame identity, safety separation, and refusal diagnostics.

## Verification and limits

Run `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm build`. For browser checks, start Vite on `127.0.0.1:4174`, then run `node scripts/metric-depth/browser-smoke.mjs http://127.0.0.1:4174` and `node scripts/metric-depth/vision-browser-smoke.mjs http://127.0.0.1:4174`.

On 12 October 2026, TypeScript and the production build passed, as did **357 tests**. Desktop Chrome loaded the actual metric ONNX model and returned 19,200 finite pixels from a synthetic frame. The page-level Chrome test used a synthetic 640 × 480 camera stream, clicked the fresh measurement button, and returned an explicitly experimental centre-surface result of **1.93 m**. One run measured **5,249 ms model loading** and **900 ms inference** on this desktop host. This is a software-path check, not a physical accuracy result or an iPhone performance estimate. Synthetic imagery contained no recognisable object, so a numeric object-box overlay was not proven by this browser run; SVG rendering, geometry, frame matching, refusal, and expiry have unit tests.

The hosted Manus URL returned **HTTP 302** to `manus.im/app-auth` for unauthenticated HEAD requests to `parts.json`, `model_fp32.part-0.bin`, and `ort-wasm-simd-threaded.wasm`. Those responses contain neither model bytes nor usable Content-Type and size data. The authenticated hosted session and iPhone 14 Pro Safari could not be exercised from this Windows environment. The public redirect alone does not establish whether a signed-in phone can load the assets. The local Vite model and WASM route were exercised in Chrome.

Physical validation remains required at **0.5, 1, 1.5, 2, and 3 m** with a tape measure, varied surfaces and lighting, and a stationary phone. Export attempts from the existing trial UI and calculate mean absolute error, P95 absolute error, and unavailable-reading rate, preserving rejections in the denominator. Until an actual iPhone run records those values, no device accuracy or Safari compatibility claim is made. AI estimates remain display and speech only; they do not trigger movement commands, collision alarms, or stair guidance.
