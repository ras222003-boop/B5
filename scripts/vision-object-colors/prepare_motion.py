"""Extract bounded actual CC0 video frames; never label a rendered sequence as real capture."""
from pathlib import Path
import json,hashlib
import cv2
from PIL import Image
def prepare(root):
    root=Path(root).resolve();output=root/'motion';output.mkdir(exist_ok=True);clips=[]
    for name,start,end in [('waiting-for-bus',12,18),('london-bus-2014',2,8)]:
        source=root/(name+'.webm');rights=root/('video-rights.json' if name=='waiting-for-bus' else name+'.rights.json');metadata=json.loads(rights.read_text())
        if hashlib.sha256(source.read_bytes()).hexdigest()!=metadata['sha256']:raise ValueError('Licensed source hash changed')
        cap=cv2.VideoCapture(str(source));fps=cap.get(cv2.CAP_PROP_FPS);frames=[]
        for i in range(int((end-start)*2)+1):
            second=start+i*.5;cap.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,bgr=cap.read()
            if not ok:raise ValueError('Video frame decode failed')
            image=Image.fromarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB));image.thumbnail((640,640));path=output/f'{name}-{i:03d}.png';image.save(path)
            frames.append(dict(id=f'{name}-{i:03d}',path='motion/'+path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),mediaTimeMs=cap.get(cv2.CAP_PROP_POS_MSEC),sourceFrameIndex=round(second*fps),sceneId=name))
        cap.release();clips.append(dict(id=name,sourceSha256=metadata['sha256'],license=metadata['license'],frames=frames,
            referenceStatus='independent_frame_boxes_and_identities_pending',kind='actual_CC0_video_not_synthetic_motion'))
    (root/'motion-manifest.json').write_text(json.dumps(dict(schemaVersion=1,clips=clips,trainingUse='forbidden',purpose='descriptive_temporal_stability_not_accuracy_without_reference'),indent=2),encoding='utf-8')
    print(json.dumps({'realClips':len(clips),'frames':sum(len(c['frames']) for c in clips)}))
if __name__=='__main__':
    import sys;prepare(sys.argv[1])
