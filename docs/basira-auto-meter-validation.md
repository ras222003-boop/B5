# Basira Auto Meter — device validation protocol

**Status: no real-device accuracy result has been recorded in this repository.** Build and unit tests cannot measure physical accuracy. The Auto Meter display is experimental until this protocol is completed on actual supported phones. No distance-triggered collision alert or stair direction may be enabled from these readings by this feature.

## Measurement setup

Use the existing Basira Vision screen (`/navigation/vision`) in a stationary, supervised indoor setup. On iPhone use a rear LiDAR model supported by ARKit scene depth for native-depth trials. On Android confirm ARCore Depth support at runtime. An ordinary browser can now run the separate indoor AI model, labelled `MONOCULAR_METRIC`; its results are experimental and must be analyzed separately from sensor depth. If the model cannot run or a reading fails validation, show *distance unavailable*. See [camera-only metric depth](metric-depth.md).

Measure the reference distance with a tape or laser reference from the **rear camera lens plane to the visible surface of the identified object**, not from the user's feet or the phone body. Use a stable chair, box, wall, and at least one narrow or open object whose bounding box can include background. Mark 0.5, 1, 1.5, 2, and 3 metres. Optional 4 and 5 metre stations test extension only; the initial target range is 0.5–3 m. Do not change a scale or place markers for everyday use; the reference exists only for validation.

At each distance and on each phone, record at least 30 independent frame/object attempts across repeated runs. Include normal and dim light, reflective and low-texture surfaces, and slow phone movement with a sighted operator. A failed or withheld reading is an **attempt** with `readingMeters:null` and `rejectionReason`; it must remain in the rejection-rate denominator. Record detector misses separately as rejections. Avoid selecting only successful readings. Record device model, OS version, source, frame ID, recognized object, condition, timestamp, and reference distance. Do not collect camera images, video, faces, or location for this report.

## Result file and calculations

One UTF-8 JSON object per line, using these fields:

| Field | Meaning |
| --- | --- |
| `sessionId`, `deviceModel`, `osVersion` | A local test session and exact phone/software identity. |
| `source` | `ARKIT_DEPTH`, `LIDAR`, `ARCORE_DEPTH`, `DEPTH_SENSOR`, or separately `MONOCULAR_METRIC`. |
| `frameId`, `objectType`, `capturedAt` | The paired native frame or copied browser frame, detected object, and ISO timestamp. |
| `referenceMeters` | One of `0.5`, `1`, `1.5`, `2`, `3`, `4`, `5`. |
| `readingMeters` | Observed result, or `null` if withheld. |
| `rawMeters` | Optional hidden sensor observation only for rejected 4 or 5 metre attempts; never a displayed Auto Meter result. |
| `rejectionReason` | `null` for an accepted result, otherwise a nonempty reason. |
| `condition` | Lighting, material, motion, and other circumstances. |

Run `node scripts/auto-meter-report.mjs device-trials.jsonl auto-meter-report.md`. The script rejects malformed and duplicate rows; it reports attempts, accepted/unavailable counts, unavailable percentage, mean absolute error, mean signed error, and P95 absolute error for each device, source, and distance. P95 uses the nearest-rank percentile. Optional `rawMeters` values have a separate exploratory error table and remain unavailable in the user-facing range. Keep the collected JSONL and report as review evidence after removing personal data. An empty report explicitly says accuracy is unverified.

## Functional and safety checks

- With Auto Meter initially off, Vision object detection, OCR, and manual scene description still work. Restart the app and confirm the saved user preference and explicit activation behaviour.
- Toggle Auto Meter on and off repeatedly. After off, clear displayed numbers immediately, stop native depth processing, and keep the other Vision functions working. Backgrounding or leaving the page stops camera resources.
- For each displayed object, verify the RGB image and depth came from one native frame and use the same image orientation and crop. Deliberately test a stale frame, low depth coverage, object with mixed foreground/background, transparent/reflective surface, and missing depth; all must withhold metres.
- Check automatic readings while moving the phone slowly, status/source/reliability labels, optional speech, cooldown, Arabic metre/centimetre pronunciation, and screen-reader output with VoiceOver and TalkBack. Confirm speech does not repeat every frame.
- Record processing rate, dropped frames, initial model load time, battery start/end for a fixed 15-minute session, phone temperature/thermal warnings, and whether disabling depth reduces resource use.
- Verify that Auto Meter readings never trigger collision warnings, haptic emergency signals, or stair directions. Those pathways need a separate safety validation with measured misses and false alarms before activation.

References: [Apple ARKit scene depth](https://developer.apple.com/documentation/arkit/arframe/scenedepth), [Apple ARDepthData alignment and confidence](https://developer.apple.com/documentation/arkit/ardepthdata), and [Google ARCore Depth and coordinate mapping](https://developers.google.com/ar/develop/java/depth/developer-guide).

## Camera-only metric model

The original relative Depth Anything V2 Small model remains for scene geometry;
it never supplies metre values. Basira now also ships the separate indoor metric
Small checkpoint for opt-in camera-only estimates. Its conversion, browser
implementation, test evidence, and iPhone trial requirements are documented in
[metric-depth.md](metric-depth.md). Camera-only output remains an experimental
estimate and cannot feed collision or stair alerts or movement commands.
