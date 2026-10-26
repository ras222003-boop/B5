"""Before inference, merge visually overlapping source blocks using ORB/RANSAC.
This reduces sequence leakage; it cannot certify unknown physical site metadata.
"""
from collections import defaultdict,Counter
import json,random
import cv2,numpy as np
from rights import ROOT,read

root=ROOT;assert not (root/'cohort-lock.json').exists()
rows=read(root/'uroac-acquisition.json');groups=sorted({r['groupId'] for r in rows});parent={g:g for g in groups}
def find(g):
    while parent[g]!=g:parent[g]=parent[parent[g]];g=parent[g]
    return g
def union(a,b):
    x,y=sorted([find(a),find(b)]);parent[y]=x
cv2.ocl.setUseOpenCL(False);cv2.setNumThreads(1)
orb=cv2.ORB_create(nfeatures=600);features=[]
for row in rows:
    image=cv2.imdecode(np.frombuffer((root/row['path']).read_bytes(),dtype=np.uint8),cv2.IMREAD_GRAYSCALE)
    assert image is not None,'Failed to decode source image'
    ratio=640/max(image.shape);image=cv2.resize(image,(round(image.shape[1]*ratio),round(image.shape[0]*ratio)))
    points,descriptor=orb.detectAndCompute(image,None);features.append((points,descriptor))
    if len(features)%20==0:print(json.dumps(dict(phase='ORB_CPU_features',images=len(features),total=len(rows))),flush=True)
matches=[];matcher=cv2.BFMatcher(cv2.NORM_HAMMING)
for i,a in enumerate(rows):
    if i%20==0:print(json.dumps(dict(phase='CPU_scene_pairs',image=i,total=len(rows))),flush=True)
    p,da=features[i]
    if da is None:continue
    for j in range(i+1,len(rows)):
        b=rows[j]
        if find(a['groupId'])==find(b['groupId']):continue
        q,db=features[j]
        if db is None:continue
        good=[m[0] for m in matcher.knnMatch(da,db,k=2) if len(m)==2 and m[0].distance<.7*m[1].distance]
        if len(good)<25:continue
        src=np.float32([p[m.queryIdx].pt for m in good]);dst=np.float32([q[m.trainIdx].pt for m in good])
        matrix,inliers=cv2.findHomography(src,dst,cv2.RANSAC,3.,maxIters=2000)
        if matrix is None or inliers.sum()<20 or inliers.mean()<.6:continue
        # Reject repeated tiny signal icons: require wide scene/background support.
        pts=src[inliers.ravel().astype(bool)]
        if cv2.contourArea(cv2.convexHull(pts))<.03*640*480:continue
        matches.append(dict(a=a['id'],b=b['id'],inliers=int(inliers.sum()),sourceBlocks=[a['groupId'],b['groupId']]))
        union(a['groupId'],b['groupId'])
components=defaultdict(list)
for group in groups:components[find(group)].append(group)
ordered=sorted(components);random.Random(20261026).shuffle(ordered);n=len(ordered)
train=max(1,int(.6*n)) if n>=3 else 0;val=max(1,(n-train)//2) if n>=2 else 0
assignment={g:'train' if i<train else 'validation' if i<train+val else 'test' for i,g in enumerate(ordered)}
for row in rows:
    row['originalSourceBlock']=row['groupId'];row['groupId']=find(row['groupId']);row['split']=assignment[row['groupId']]
(root/'uroac-grouped.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
(root/'uroac-group-audit.json').write_text(json.dumps(dict(originalGroups=len(groups),visualComponents=n,
    components=components,assignments=assignment,verifiedOverlapMatches=matches,method='ORB600/Hamming ratio.7; RANSAC>=20inliers>=.6 with background coverage; before model inference',
    physicalSiteIdentityVerified=False,counts=dict(Counter(r['split'] for r in rows))),indent=2),encoding='utf-8')
print(json.dumps(dict(images=len(rows),originalGroups=len(groups),visualComponents=n,merges=len(matches),counts=dict(Counter(r['split'] for r in rows)))))
