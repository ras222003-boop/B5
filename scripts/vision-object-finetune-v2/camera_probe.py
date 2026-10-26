"""Bounded REAL Windows capture + native CPU ONNX probe. Never saves raw camera pixels.

This is an operational/performance trial, not accuracy or navigation qualification.
The outer process terminates a stuck capture child after the explicit deadline.
"""
from pathlib import Path
import argparse, hashlib, json, math, os, re, subprocess, sys, time

os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def capture_status(opened, frames):
    if not opened or not frames:
        return 'CAMERA_UNAVAILABLE'
    if not any(f['visibleSceneEvidence'] for f in frames):
        return 'LOW_OR_UNIFORM_CAPTURE'
    settled = frames[3:] if len(frames) > 6 else frames
    if len(settled) >= 4 and len({f['frameHash'] for f in settled}) <= 1:
        return 'DEVICE_OUTPUT_STATIC_SCENE_UNVERIFIED'
    return 'VISIBLE_CHANGING_FRAME_CAPTURE'


def decode_output(raw, names, width, height, threshold=.5):
    """Match the deployed raw-grid contract, class-aware .6 then .55 NMS."""
    import numpy as np
    values = raw[0]
    if values.shape != (3549, 85) or not np.isfinite(values).all():
        raise ValueError('unexpected ONNX output contract')
    grids, strides = [], []
    for stride in [8, 16, 32]:
        y, x = np.meshgrid(np.arange(416//stride), np.arange(416//stride), indexing='ij')
        grids.append(np.stack([x, y], -1).reshape(-1, 2))
        strides.append(np.full(((416//stride)**2, 1), stride))
    grid, stride = np.concatenate(grids), np.concatenate(strides)
    scores = values[:, 4:5] * values[:, 5:]
    classes = scores.argmax(1)
    confidence = scores[np.arange(len(scores)), classes]
    selected = (confidence >= threshold) & (confidence <= 1)
    values, grid, stride = values[selected], grid[selected], stride[selected]
    classes, confidence = classes[selected], confidence[selected]
    scale = min(416/width, 416/height)
    centres = (values[:, :2]+grid)*stride/scale
    sizes = np.exp(values[:, 2:4])*stride/scale
    boxes = np.concatenate([centres-sizes/2, centres+sizes/2], 1)
    boxes[:, [0, 2]] = np.clip(boxes[:, [0, 2]]/width, 0, 1)
    boxes[:, [1, 3]] = np.clip(boxes[:, [1, 3]]/height, 0, 1)
    valid = (boxes[:, 2] > boxes[:, 0]) & (boxes[:, 3] > boxes[:, 1])
    boxes, classes, confidence = boxes[valid], classes[valid], confidence[valid]
    order = sorted(range(len(boxes)), key=lambda i: -float(confidence[i]))
    for nms_threshold in [.6, .55]:
        kept = []
        for i in order:
            duplicate = False
            for j in kept:
                if classes[i] != classes[j]:
                    continue
                a, b = boxes[i], boxes[j]
                inter = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
                area = (a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter
                if area > 0 and inter/area > nms_threshold:
                    duplicate = True
                    break
            if not duplicate:
                kept.append(i)
        order = kept
    return [dict(cocoClass=names[int(classes[i])], score=float(confidence[i]),
                 box=[float(boxes[i, 0]), float(boxes[i, 1]), float(boxes[i, 2]-boxes[i, 0]), float(boxes[i, 3]-boxes[i, 1])],
                 calibrated=False) for i in order[:100]]


def capture(args):
    import cv2
    import numpy as np
    import onnxruntime as ort
    import psutil
    cv2.setNumThreads(2)
    names = re.findall(r'^  \["([^"]+)",', Path('client/src/lib/vision/cocoLabels.ts').read_text(encoding='utf-8'), re.M)
    if len(names) != 80:
        raise ValueError('COCO label contract mismatch')
    process = psutil.Process()
    baseline_memory = process.memory_info().rss / 2**20
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    models, model_info = {}, {}
    for item in args.model:
        name, value = item.split('=', 1)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', name):
            raise ValueError('invalid model identifier')
        path = Path(value).resolve()
        if path.stat().st_size > 25_000_000:
            raise ValueError('model resource bound')
        started = time.perf_counter()
        session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
        if session.get_inputs()[0].shape != [1, 3, 416, 416] or session.get_outputs()[0].shape != [1, 3549, 85]:
            raise ValueError('model shape contract')
        models[name] = session
        model_info[name] = dict(sha256=digest(path), modelBytes=path.stat().st_size, loadMs=(time.perf_counter()-started)*1000)
    inventory_path = args.output.parent/'windows-camera-devices.json'
    inventory = json.loads(inventory_path.read_text(encoding='utf-8-sig')) if inventory_path.exists() else None
    report = dict(schemaVersion=1, scope='real_OpenCV_Windows_camera_native_CPU_ORT_not_Basira_browser',
                  cameraIndex=args.index, requestedBackend=args.backend, noFakeCaptureSource=True,
                  rawFramesSaved=False, audioRequested=False, mediaUploaded=False,
                  physicalDeviceTested=False, iphoneTested=False, referenceAccuracy=None,
                  baselineRssMiB=baseline_memory, loadedRssMiB=process.memory_info().rss/2**20,
                  cpuThreadsPerSession=2, models=model_info, frames=[], inventory=inventory,
                  pnpNameIndexMappingVerified=False, maskInference=False, navigationEligible=False)
    backend = cv2.CAP_DSHOW if args.backend == 'dshow' else cv2.CAP_MSMF
    camera = cv2.VideoCapture(args.index, backend)
    report['cameraOpened'] = camera.isOpened()
    started, cpu_started = time.perf_counter(), time.process_time()
    try:
        if camera.isOpened():
            report['actualBackend'] = camera.getBackendName()
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            last_hash = None
            while time.perf_counter()-started < args.seconds and len(report['frames']) < args.max_frames:
                read_started = time.perf_counter()
                ok, frame = camera.read()
                if not ok or frame is None:
                    report.setdefault('readFailures', 0)
                    report['readFailures'] += 1
                    if report['readFailures'] >= 3:
                        break
                    continue
                height, width = frame.shape[:2]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                frame_hash = hashlib.sha256(frame.tobytes()).hexdigest()
                visible = bool(float(np.percentile(gray, 99)) >= 8 and float(gray.std()) >= 2)
                row = dict(index=len(report['frames']), capturedAfterMs=(time.perf_counter()-started)*1000,
                           width=width, height=height, captureReadMs=(time.perf_counter()-read_started)*1000,
                           frameHash=frame_hash, unchangedFromPrevious=frame_hash == last_hash,
                           meanLuminance=float(gray.mean()), luminanceStd=float(gray.std()),
                           visibleSceneEvidence=visible, models={})
                last_hash = frame_hash
                ratio = min(416/width, 416/height)
                resized = cv2.resize(frame, (int(width*ratio), int(height*ratio)), interpolation=cv2.INTER_LINEAR)
                pixels = np.full((416, 416, 3), 114, np.float32)
                pixels[:resized.shape[0], :resized.shape[1]] = resized
                tensor = pixels.transpose(2, 0, 1).copy()[None]
                for name, session in models.items():
                    inference_started = time.perf_counter()
                    raw = session.run(['output'], {'images': tensor})[0]
                    inference_ms = (time.perf_counter()-inference_started)*1000
                    detections = decode_output(raw, names, width, height)
                    row['models'][name] = dict(inferenceMs=inference_ms, detections=detections)
                row['rssMiB'] = process.memory_info().rss/2**20
                report['frames'].append(row)
                if row['rssMiB'] > 2048:
                    report['stopReason'] = 'native_process_memory_budget'
                    break
                time.sleep(.1)
    finally:
        camera.release()
        report['cameraReleaseCalled'] = True
    report['elapsedSeconds'] = time.perf_counter()-started
    report['cpuSeconds'] = time.process_time()-cpu_started
    report['framesRead'] = len(report['frames'])
    report['visibleFrames'] = sum(f['visibleSceneEvidence'] for f in report['frames'])
    report['distinctFrameHashes'] = len({f['frameHash'] for f in report['frames']})
    report['actualLiveFrameRead'] = bool(report['frames'])
    report['physicalDeviceTested'] = bool(report['frames']) and bool(inventory and any(d.get('HardwareBus') == 'USB' for d in inventory['devices']))
    report['physicalProofLimit'] = 'Live DirectShow read with USB camera inventory; exact index-to-friendly-name mapping requires browser/device verification.'
    report['status'] = capture_status(report['cameraOpened'], report['frames'])
    report['sceneVariationObserved'] = report['status'] == 'VISIBLE_CHANGING_FRAME_CAPTURE'
    report['preprocess'] = 'Native OpenCV INTER_LINEAR BGR; not pixel-identical to deployed Canvas. Native timings are not browser/iPhone timings.'
    for name in models:
        times = sorted(f['models'][name]['inferenceMs'] for f in report['frames'])
        model_info[name].update(inferenceMedianMs=float(np.median(times)) if times else None,
                                inferenceP95Ms=times[math.ceil(.95*len(times))-1] if times else None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    print(json.dumps({k: report[k] for k in ['status', 'cameraOpened', 'framesRead', 'visibleFrames', 'elapsedSeconds', 'physicalDeviceTested']}))
    return 0 if report['sceneVariationObserved'] else 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', action='append', required=True, help='id=local_onnx_path')
    parser.add_argument('--index', type=int, default=0)
    parser.add_argument('--backend', choices=['dshow', 'msmf'], default='dshow')
    parser.add_argument('--seconds', type=float, default=12)
    parser.add_argument('--max-frames', type=int, default=24)
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 15 or not 1 <= args.max_frames <= 32 or not 0 <= args.index <= 2:
        parser.error('capture budget exceeded')
    args.output = args.output.resolve()
    if args.output.exists():
        parser.error('evidence already exists; choose a new output name')
    if args.worker:
        return capture(args)
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--worker'], timeout=args.seconds+30)
        return result.returncode
    except subprocess.TimeoutExpired:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as f:
            json.dump(dict(status='CAPTURE_WORKER_TIMEOUT', physicalDeviceTested=False, iphoneTested=False,
                           workerTerminated=True, rawFramesSaved=False, mediaUploaded=False,
                           cameraIndex=args.index, backend=args.backend), f, indent=2)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
