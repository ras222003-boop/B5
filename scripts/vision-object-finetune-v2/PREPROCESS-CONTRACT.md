# Exact development preprocessing

`preprocess.mjs ROOT http://127.0.0.1:4350` requires `cohort-lock.json` and exports only `train` and `validation`. An explicit test split is rejected before opening its pixels. Source/group IDs must be unique across splits, and the image and code hashes are bound to every output. Existing outputs are verified, not overwritten when their identity changes.

Outputs are `preprocessed/<id>.rgba`, deterministic per-image JSON, and `preprocessed/index.json`. Each file has 692,224 bytes: `uint8`, 416×416×4, HWC RGBA. Convert with:

```python
rgba = np.fromfile(path, dtype=np.uint8).reshape(416, 416, 4)
bgr_chw = rgba[:, :, :3][:, :, ::-1].transpose(2, 0, 1).copy().astype(np.float32)
```

Do not divide by 255. The deployed YOLOX decoder uses the nominal `ratio` stored in the metadata; the exported `resizedWidth` and `resizedHeight` are floored. Original reference boxes remain independent and unchanged.

The exporter first materializes the decoded original image as a native-size canvas, then follows `YoloXProvider.detect` with an OffscreenCanvas 2D context, top-left letterbox RGB114, and default Canvas smoothing. Direct `Image -> 416` rendering produced different pixels in the initial contract test, so it is deliberately not used. No crops or new synthetic scenes are generated.

The contract test spies on the deployed detector's input tensor for OffscreenCanvas, HTML photo canvas and ImageBitmap worker transport. Its generated high-frequency fixture is a software unit test, not a training image or a measured model-accuracy example. The real export contains only the frozen dataset's original development images. The byte parity is specific to the tested Chrome implementation; iPhone/Safari parity and actual camera capture require their own tests. Camera downsampling before this stage can also change pixels.

`audit_v1.py V1_ROOT V2_ROOT` separately examines V1 train/validation only. It checks source category/box equality, scene groups, image hashes and crop visibility, and records validation learning curves and a paired scene-bootstrap diagnostic. It does not inspect final predictions or final pixels, manufacture human reference approvals, or claim one proven cause for the V1 regression.
