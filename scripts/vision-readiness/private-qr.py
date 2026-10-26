"""Machine-readable local pairing artifact. Payload arrives through stdin, never process arguments or stdout."""
import sys
from pathlib import Path
import cv2
from PIL import Image
payload=sys.stdin.read().strip();path=Path(sys.argv[1]).resolve();allowed=Path('../.vision-test-fixtures').resolve()
assert path.is_relative_to(allowed) and payload.startswith(('http://192.168.','https://192.168.','http://10.','https://10.'))
code=cv2.QRCodeEncoder_create().encode(payload);code=cv2.copyMakeBorder(code,6,6,6,6,cv2.BORDER_CONSTANT,value=255)
code=cv2.resize(code,None,fx=8,fy=8,interpolation=cv2.INTER_NEAREST)
decoded,_,_=cv2.QRCodeDetector().detectAndDecode(code);assert decoded==payload,'QR roundtrip failed'
assert not path.exists();Image.fromarray(code).save(path);print('Local QR written and roundtrip verified')
