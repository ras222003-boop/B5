import {describe, expect, it} from 'vitest';
import type {MetricDepthMap, VisionDetection} from '@shared/vision';
import {metricDepthForDetection,VisionFusionEngine} from './fusion';
import {BasiraSafetyEngine} from './safety';
import {DEFAULT_VISION_CONFIG} from './config';
import {SceneUnderstandingService} from './scene';
import {visionMessages} from '@/i18n/locales/vision';

const detection=(timestamp=100):VisionDetection=>({
 id:'chair',type:'CHAIR',confidence:.92,source:'OBJECT_DETECTOR',
 boundingBox:{x:.25,y:.25,width:.5,height:.5},
 horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
 approximateDistance:null,timestamp,
});
const map=(values=new Float32Array(32*24).fill(1.42)):MetricDepthMap=>({
 width:32,height:24,values,source:'ARKIT_DEPTH',confidence:.92,
 timestamp:100,alignmentVerified:true,
});

describe('verified metric object association',()=>{
 it('exposes a coherent same-frame camera depth patch in metres',()=>{
   expect(metricDepthForDetection(detection(),map())).toMatchObject({distanceMeters:1.42,source:'ARKIT_DEPTH'});
 });
 it('rejects depth from another frame, unchecked maps and low-confidence detections',()=>{
   expect(metricDepthForDetection(detection(301),map())).toBeNull();
   expect(metricDepthForDetection(detection(),{...map(),alignmentVerified:false})).toBeNull();
   expect(metricDepthForDetection({...detection(),confidence:.5},map())).toBeNull();
   expect(metricDepthForDetection({...detection(),source:'SEGMENTATION'},map())).toBeNull();
 });
 it('rejects mixed object/background depths and missing center',()=>{
   const mixed=new Float32Array(32*24).fill(1);
   for(let i=0;i<mixed.length;i++)if(i%2)mixed[i]=4;
   expect(metricDepthForDetection(detection(),map(mixed))).toBeNull();
   const missing=new Float32Array(32*24).fill(NaN);
   expect(metricDepthForDetection(detection(),map(missing))).toBeNull();
 });
 it('keeps monocular and world-pose guesses from producing metres in scene summary',()=>{
   const fusion=new VisionFusionEngine(new BasiraSafetyEngine(DEFAULT_VISION_CONFIG));
   const frame=fusion.fuse({objects:[detection()],segmentation:null,metricDepth:map(),relativeDepth:null,signs:[]});
   expect(frame.detections[0].approximateDistance?.distanceMeters).toBeCloseTo(1.42);
   expect(new SceneUnderstandingService(visionMessages.ar).summarize(frame.events,null,100).shortText).toContain('متر');
   const noMap=fusion.fuse({objects:[detection()],segmentation:null,metricDepth:null,relativeDepth:null,signs:[]});
   expect(noMap.detections[0].approximateDistance).toBeNull();
   expect(new SceneUnderstandingService(visionMessages.ar).summarize(noMap.events,null,100).shortText).not.toContain('متر');
 });
});
