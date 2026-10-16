"""CPU-only region proposals. No recognition, approval, network or image mutation."""
import sys, json, hashlib, os
import cv2
import numpy as np

cv2.setNumThreads(1)
request = json.load(sys.stdin)
with open(request['path'], 'rb') as source:
    image = cv2.imdecode(np.frombuffer(source.read(), dtype=np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
if image is None:
    raise ValueError('Cannot decode image')
h, w = image.shape[:2]
scale = min(1, 1280 / max(w, h))
image = cv2.resize(image, (round(w * scale), round(h * scale)))
gray = cv2.equalizeHist(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
sh, sw = gray.shape
regions, models = [], []
for name, kind, flip in [
    ('haarcascade_frontalface_default.xml', 'face_candidate', False),
    ('haarcascade_profileface.xml', 'face_candidate', False),
    ('haarcascade_profileface.xml', 'face_candidate', True),
    ('haarcascade_russian_plate_number.xml', 'plate_candidate_region_limited', False),
]:
    path = os.path.join(request['cascades'], name)
    with open(path, 'rb') as source:
        digest = hashlib.sha256(source.read()).hexdigest()
    if request['modelHashes'].get(name) != digest:
        raise ValueError('Local cascade SHA mismatch')
    detector = cv2.CascadeClassifier(path)
    if detector.empty():
        raise ValueError('Local cascade unavailable')
    models.append({'name': name, 'sha256': digest})
    pixels = cv2.flip(gray, 1) if flip else gray
    for x, y, bw, bh in detector.detectMultiScale(pixels, scaleFactor=1.1, minNeighbors=5, minSize=(24, 12 if 'plate' in kind else 24)):
        if flip:
            x = sw - x - bw
        # Small padding helps the human inspect context. This is not verified coverage.
        left, top = max(0, int(x - bw * .1)), max(0, int(y - bh * .1))
        right, bottom = min(sw, int(x + bw * 1.1)), min(sh, int(y + bh * 1.1))
        box = [left/sw, top/sh, (right-left)/sw, (bottom-top)/sh]
        if not any(r['reason'] == kind and sum(abs(a-b) for a,b in zip(r['box'], box)) < .05 for r in regions):
            regions.append({'box': box, 'reason': kind, 'confidence': None, 'confidenceKind': 'uncalibrated_cascade_candidate'})
print(json.dumps({'status': 'completed', 'version': cv2.__version__, 'regions': regions[:100], 'models': models,
    'limits': ['Faces and plates can be missed or falsely detected.', 'Plate cascade has region-specific training; not validated for local plates.', 'Zero regions is not privacy clearance.']}))
