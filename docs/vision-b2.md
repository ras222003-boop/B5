# B2 — Basira Vision

## Runtime

`/navigation/vision` starts an exploration-only session after a user gesture. `CameraService` requests the camera at that point, prefers the rear camera, and stops every track when vision stops, the page unmounts or the tab becomes hidden. Analysis is bounded to two object frames per second and one OCR frame per eight seconds. It never queues camera frames; the temporary OCR blob is released after recognition.

The pipeline is `CameraService → MediaPipeVisionProvider → BasiraSafetyEngine → SceneUnderstandingService → VisionAnnouncementService`, with a parallel sparse `TesseractOCRProvider → VisualPlaceRecognitionService` path. B1's `/api/navigation/search` is used for matching; no second map is created. Unmatched navigation text becomes a `PlaceCandidate` with `PENDING` review status in the current page's private memory. It is not published or persisted. B3/B5 can attach a reviewed repository to the typed contract later.

## Models and assets

- Local object detection: Google MediaPipe Tasks Vision 1.0.1 and EfficientDet-Lite0 int8 (COCO, 320×320 model input). The model is sourced from [Google's published model](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite); SHA-256 `0720BF247BD76E6594EA28FA9C6F7C5242BE774818997DBBEFFC4DA460C723BB`.
- Local OCR: Tesseract.js 6.0.1 with local `ara`, `eng` and `chi_sim` trained-data packages. The worker, WASM runtime and language data are served under `/vision/tesseract`.
- All image processing stays in the browser. No frame is sent to the Basira server or a cloud vision service. Only navigation-relevant OCR text is sent to B1 search for place matching. If B1 is offline, the text remains a local pending candidate and the UI says matching could not be checked.
- Public assets under `client/public/vision` total about 77 MB before HTTP compression. They are copied into the production build. A fresh offline page load is not supported because this project has no service worker; an already loaded session continues object detection when network access drops. OCR continues only if its worker and language files have already loaded.

## Safety limits

EfficientDet-Lite0's COCO labels support persons, chairs, dining tables, bicycles, vehicles and some road signs. It **does not** reliably identify doors, walls, columns, stairs, holes, elevators, carts, boxes, corridors, entrances or exits from appearance. Those categories exist in the typed provider contract for a validated future native/custom model; B2 does not fabricate detections for them. An unrecognized large central COCO object may be reported as an unidentified obstacle.

The web app has no portable ARKit/ARCore/LiDAR metric depth stream. `UnavailableDepthProvider` therefore returns `null`; no distance in metres is inferred from bounding-box size, and the safety engine does not escalate a detection to `CRITICAL` without reliable measured depth. Stairs or drop-offs can be missed. The screen explicitly warns that Basira Vision is exploratory assistance and is not a sole mobility aid. `DepthProvider` and source-tagged `DepthReading` allow a native or evaluated monocular provider later without changing the safety or UI contracts.

Battery awareness halves the analysis rate on supported devices at 20% battery or below. Browsers do not expose a portable thermal sensor, so no thermal adaptation is implemented. Telemetry is local, aggregate session logging only: frame count, detection count and average inference time, without frames, recognized text or precise location.

## Verification

Unit tests cover risk classification, the critical-depth gate, direction buckets, alert cooldown/escalation, B1 room matching, pending candidates and camera permission error mapping. The camera, model accuracy and screen reader flow still require validation on target phones before treating B2 as a field-ready safety feature. No B3/B4 navigation, voice commands or route calculation is implemented.
