# Basira native depth integration — calibration phase (2026-10-11)

## Status and hard boundary

This branch adds an **isolated research calibration lab**, its native sample contract and tests. It **does not** install ARKit/ARCore SDKs, include an iOS/Android native host, claim a working sensor, or turn on metric navigation alerts. Native work needs Xcode on macOS for iOS and Android Studio/device testing for Android. Access at `/navigation/depth-lab` after deployment; in a normal browser it correctly reports that native depth is unavailable.

This is deliberately based on PR #16's branch head, while PR #16 remains unmerged. The new branch must be merged after that prerequisite, or rebased safely.

## Actual device integration tasks

### iOS / ARKit host

1. Set up a separate iOS app target using ARKit with `ARWorldTrackingConfiguration`. Verify `supportsFrameSemantics(.sceneDepth)` or `.smoothedSceneDepth`; explain unsupported devices without guessing meters.
2. Obtain `ARFrame.capturedImage` and `ARFrame.sceneDepth` (or smoothed depth) **from the same ARFrame**. Depth is in meters. Apply orientation and the appropriate camera-to-depth projection/UV transform. Test alignment against visually marked targets, not by assuming that depth pixels and RGB pixels share coordinates.
3. For each native camera frame, attach a stable frame ID, monotonic native timestamp, aligned native preview frame, and aligned depth with confidence map. Confidence-map quantization must be interpreted according to ARKit docs, not guessed from the sample contract.
4. Run a native capture channel that explicitly owns the camera preview: do **not** start a separate web `getUserMedia` capture and declare it aligned. Bridge frame and depth as an atomic pair to a shared surface/video-frame adapter.
5. Implement a lab-only adapter `window.BasiraDepthLab.captureSample()` to sample a target surface ROI after calibration and compute quality. Populate `capturedWithNativeSession`, `alignedToCameraFrame`, `rawDepthFresh` truthfully. The lab's 0.7 normalized confidence is a normalized *application* metric only after documented mapping.
6. Respect camera permissions, stop/background lifecycle, battery/thermal throttling, and memory; never export frames without explicit consent.

### Android / ARCore host

1. Add an Android host app using a current supported ARCore SDK. Check `session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)`; disable metric functionality when unsupported.
2. Enable depth through the session configuration; retrieve camera frame and `Frame.acquireDepthImage16Bits()`, and optionally raw depth and confidence image, with exact API checks on the targeted ARCore version. Convert 16-bit depth in **millimeters to meters** and respect image row/pixel strides, validity/missing pixels, and coordinate transformations between the depth image and camera image.
3. Use ARCore frame time and coordinate transforms to prove correspondence. Do not combine `getUserMedia` frames from an independent browser camera session with ARCore depth. Raw depth can be sparse or stale, and may not update every frame: mark the raw-depth freshness appropriately or reject.
4. Normalize confidence only with documented semantics; invalid depth and unsupported devices must return `null`.
5. Implement the same lab-only `window.BasiraDepthLab.captureSample()` contract; use an atomic native image-plus-depth capture and fail closed when frame synchronization cannot be proven.

## Lab protocol

- Place a flat, visible target perpendicular to the camera in a safe, stationary environment. Measure the **camera lens-to-target** ground-truth range independently using a calibrated tape or rangefinder.
- For 0.5, 1, 2, 3, 5 meters, collect >=20 trials per distance spanning >=2 conditions (bright, dim, outdoor). Include motion and difficult surfaces as **separate** stress experiments.
- Export CSV from `/navigation/depth-lab`. Report rejected samples, coverage, median absolute error and P95 absolute error **for each device and depth mode**. Lab initial thresholds: >=90% coverage, >=18 valid points/target, median error <=max(0.15m, 10% distance), P95 <=max(0.25m, 15% distance). These are research acceptance criteria **not** validated safety requirements.
- An individual model must pass the complete test battery; a pass never turns on field alerts. Next phases require paired camera-frame ingestion into vision detection, body/foot reference compensation, hazard-specific false-negative audits, latency testing, trial supervision by orientation-and-mobility specialists, and a separate documented safety review.
- Never interpret `safetyCertified:false` as a warning that can be suppressed for automatic activation. Until these gates pass, keep navigation depth disabled on ordinary browsers and stairs step cues disabled everywhere.

## Refs

- Apple ARKit Scene Depth: https://developer.apple.com/documentation/arkit/arframe/scenedepth
- Google ARCore Depth: https://developers.google.com/ar/develop/depth
- Google ARCore Depth Developer Guide: https://developers.google.com/ar/develop/java/depth/developer-guide

## Verification

`pnpm check`, `pnpm test`, `pnpm build` from repo root. Native SDK builds and physical device measurement remain outstanding.
