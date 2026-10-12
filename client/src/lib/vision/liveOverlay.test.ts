import {describe,expect,it} from 'vitest';
import type {VisionDetection} from '@shared/vision';
import {mapBoxToPreview,overlayMeters} from './liveOverlay';

const detection={id:'same',boundingBox:{x:.25,y:.25,width:.5,height:.5},source:'OBJECT_DETECTOR'} as VisionDetection;
const frame={frameId:'frame-1',capturedAt:1000,width:640,height:480,detections:[detection]};
const snapshot={frameId:'frame-1',capturedAt:1000,nativeSource:'MONOCULAR_METRIC',measurements:[
  {id:'same',frameId:'frame-1',distanceMeters:1.25},
]} as Parameters<typeof overlayMeters>[2];

describe('live camera overlay',()=>{
  it('aligns boxes for letterboxed portrait previews and covered previews',()=>{
    expect(mapBoxToPreview(detection.boundingBox,{width:640,height:480},{width:320,height:320}))
      .toEqual({x:80,y:100,width:160,height:120});
    expect(mapBoxToPreview(detection.boundingBox,{width:640,height:480},{width:320,height:320},'cover'))
      .toEqual({x:53.33333333333334,y:80,width:213.33333333333331,height:160});
    expect(mapBoxToPreview(detection.boundingBox,{width:480,height:640},{width:240,height:320}))
      .toEqual({x:60,y:80,width:120,height:160});
  });
  it('rejects measurements from a different frame, object, or expired frame',()=>{
    expect(overlayMeters(detection,frame,snapshot,1500)).toBe(1.25);
    expect(overlayMeters(detection,{...frame,frameId:'frame-2'},snapshot,1500)).toBeNull();
    expect(overlayMeters({...detection,id:'another'},frame,snapshot,1500)).toBeNull();
    expect(overlayMeters(detection,frame,snapshot,3001)).toBeNull();
  });
});
