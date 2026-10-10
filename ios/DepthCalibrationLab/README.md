# BASIRA iPhone LiDAR calibration companion — research prototype

This is a real **Swift/ARKit native sensor capture implementation**, not a web camera distance estimate. It is **not yet compiled on macOS or tested on an iPhone**. The web calibration lab is at `/navigation/depth-lab` and was added by this branch earlier.

## Supported prototype device

iPhone 14 Pro (LiDAR); must pass `ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)` at runtime. iOS 16+ is the project deployment minimum. Other devices are rejected if scene depth is unsupported.

## Build in Xcode on a Mac (or CI for compiler validation)

1. Install current Xcode and XcodeGen (`brew install xcodegen`).
2. Set `BasiraLabURL` in `DepthCalibrationLab/Info.plist` to the **actual deployed HTTPS** BASIRA URL ending with `/navigation/depth-lab`. The template `.example` host intentionally does not load.
3. From `ios/DepthCalibrationLab`, run `xcodegen generate`.
4. Open `BasiraDepthCalibrationLab.xcodeproj`, choose your development team and an available bundle ID for signing, select the connected iPhone 14 Pro and Run.
5. Grant permission for the camera. Keep the device **stationary** in a safe controlled environment.
6. On the lab web page select a ground-truth distance, measured independently lens-to-target, then tap **سجّل قراءة من المستشعر**. The native ARSCNView preview opens, with a crosshair at the center. Aim at a flat visible target and tap **التقاط قراءة LiDAR**.
7. Repeat at 0.5, 1, 2, 3 and 5 meters in multiple conditions (at least 20 trials per distance), export CSV and assess results. Keep all physical testing supervised and never walk while viewing this prototype.

## Native architecture / guarantees

- Only a native ARKit ARSession obtains the rear camera preview and `frame.sceneDepth`; **the web `getUserMedia` camera is not involved**.
- The native capture modal samples a 9×9 **central ROI** of `ARDepthData.depthMap` (Float32 meters), restricted to pixels whose `confidenceMap` equals `ARConfidenceLevel.high`. It requires >=70% valid high-confidence pixels and uses their median.
- The native ARSession callback and `session.currentFrame` timestamps must match; the frame must have arrived within 250 ms and AR camera tracking must be normal. Capture/permission errors return no metric sample.
- The confidence number reported to the JS lab is the proportion of HIGH-confidence valid pixels, **not an undocumented numeric conversion** of Apple's ordinal confidence levels.
- The viewfinder and the depth map belong to the same native ARSession. Calibration concerns the **central camera ray only**, which stays central under portrait orientation. No promise of pixelwise alignment of arbitrary objects, body-space foot clearance, or outdoor walking safety.
- The bridge is injected only into the trusted HTTPS origin's main frame and only used at `/navigation/depth-lab`. It is a one-shot sample interface, separate from the production `BasiraNativeDepth` provider.
- `ARSCNView` starts only when the modal is shown and pauses when it closes; depth frames are not uploaded or stored by native code. CSV generation happens in the web page only on an explicit action.

## Known limitations

- Requires compiling and signing the native iOS app in Xcode before physical testing. GitHub macOS CI can validate the compilation, but not LiDAR hardware behavior.
- Sensor behavior and error rates for the user's iPhone 14 Pro have not been measured.
- Crosshair central ROI can cover a different surface than the intended reference if the device moves, target is narrow, or the preview/AR rendering has a geometric mismatch. Verify alignment physically.
- Running the native app does **not** turn on BASIRA metric alerts or stair guidance. It never sends full depth maps into production detection.
- An Xcode installation on Windows is not provided by Apple; use a Mac or an authorized macOS CI/build environment.

Official docs: [Apple iPhone 14 Pro LiDAR](https://support.apple.com/en-us/111849), [ARKit scene depth](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth), [ARDepthData](https://developer.apple.com/documentation/arkit/ardepthdata).

## Next engineering milestone

Compile with the macOS workflow, fix compile errors and then measure on an iPhone 14 Pro. After lab benchmarks and manual inspection, implement an **atomic native video-frame + depth-frame pipeline** with pixelwise alignment before using depth in object warnings; keep the safety gating separate and off by default.
