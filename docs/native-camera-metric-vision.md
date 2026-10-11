# BASIRA — camera-frame LiDAR overlay (iPhone 14 Pro) research integration

## Current implementation (stacked on PR #17)

The app includes a second button on its offline iOS lab home screen, **الكاميرا مع أسماء الأجسام ومسافاتها (تجريبية)**, which opens the hosted BASIRA `/navigation/native-vision` screen.

- An iOS `ARSession` with `.sceneDepth` owns both rear camera and LiDAR. **No separate WebKit `getUserMedia` camera** is used for this feature.
- A trusted-main-frame `WKScriptMessageHandlerWithReply` bridge answers explicit sequential frame requests with **one atomic RGB JPEG plus depth readings from the very same `ARFrame`**, including frame identity and confidence-mask-derived coverage.
- The camera JPEG is obtained from `frame.capturedImage` in raw landscape sensor coordinates. The native LiDAR values are obtained from `frame.sceneDepth.depthMap`, restricted to ARKit HIGH-confidence pixels and downsampled to 64×48, with 0 (invalid) for excluded depth. The source frame aspect ratio must match the LiDAR map.
- Both image and depth are rotated **clockwise 90°** together by the web client: image -> portrait 480×640 canvas; depth 64×48 -> 48×64. This avoids independent crops/streams.
- Existing local EfficientDet-Lite0 object detector runs on the **same canvas**. The `metricDepthForDetection()` routine samples a matched portion of the paired depth map. Each label displays a real measured distance only when sampling yields at least 5/9 valid pixels and its map confidence is sufficient; otherwise the label says that the distance is unavailable.
- Visual preview includes detected bounding boxes and optional measured metres. A separate user-activated button reads the current, trustworthy measurements aloud. This is **not an automatic warning** and is not the navigation safety engine.
- On leaving the native screen, the ARSession pauses. During WebKit camera frame errors, missing permissions, stale frames, low confidence, backgrounding or unsupported devices, the module displays no meters. No raw images are uploaded to a BASIRA backend by this native capture bridge. The web page loads detection models from the BASIRA web origin.

## Required before cloud signing

1. Merge PR #16 and then #17 in order, or explicitly reconcile their dependencies. This PR should target #17's branch and **not** change `main` directly.
2. Publish the new React web route `https://<YOUR-BASIRA-DOMAIN>/navigation/native-vision` (the backend must actually serve the current branch). The path is **not functional in the native app** until the live site includes it and local vision model assets.
3. In Codemagic app environment variables configure `BASIRA_VISION_URL` to that exact HTTPS URL. The workflow validates this and substitutes `BasiraVisionURL` into the native iOS app's Info.plist. Placeholder/example domains intentionally fail.
4. Provide Apple signing/App Store Connect integrations as described in `docs/codemagic-testflight-lidar-iphone14pro.md`. Cloud compilation on GitHub does not sign, upload, or install on the iPhone.
5. Deploy a TestFlight research build and test on iPhone 14 Pro with the phone **stationary** and a sighted assistant in a controlled environment.

## Engineering/safety constraints

- Apple's ARDepthData docs confirm that a depth pixel maps to a region of the corresponding `capturedImage`. That is the basis of initial normalized-coordinate sampling. **Exact geometric alignment for object bounding boxes must be verified physically** using marked test targets, phone orientation and camera calibration; it is not proven by passing software tests.
- The reported distance is camera-to-visible-surface, **not foot-to-obstacle, vehicle stopping distance or a safe passage measurement**.
- Model class labels remain approximate and not safety certified. This implementation does **not** promise to detect transparent glass, holes, drop-offs, moving cars or each staircase step.
- Always measure false distance claims, false negatives, stale data, confidence loss, low lighting, motion, shiny surfaces and narrower/smaller objects. Do not activate the production acoustic walking alerts until real-device and orientation-and-mobility safety review passes.
- Test native device thermal/performance behavior and power use. Current 750-ms sequential page loop is intentionally slow and research-only; it is **not** a sufficient obstacle warning frame rate.

## Suggested testing

- `pnpm check` / `pnpm test` / `pnpm build` (React and TypeScript, GitHub Linux).
- XcodeGen + `xcodebuild` without signing (GitHub macOS), Swift compilation of ARKit capture bridge.
- Real iPhone 14 Pro: 20 or more trials at 0.5, 1, 2, 3 and 5 m and at least two conditions per distance; evaluate the identity and bounding boxes of chairs and boxes, matching separate measured target surfaces. Record percentage of withheld readings and wrong pairings.
- Only after passing device-specific studies may this experimental path be considered for merging into production vision; even then add an explicit reviewed safety gate.

Apple reference: https://developer.apple.com/documentation/arkit/ardepthdata
