import { describe, expect, it } from 'vitest';
import type { SceneDescription, VisionDetection } from '@shared/vision';
import { describeSceneForMobility, findVisibleObject } from './sceneQueries';

const detection=(type:VisionDetection['type'],direction:VisionDetection['horizontalDirection'],confidence=.85):VisionDetection=>({
  id:type,type,confidence,boundingBox:{x:.4,y:.3,width:.2,height:.3},horizontalDirection:direction,verticalPosition:'MIDDLE',approximateDistance:null,timestamp:1000,source:'OBJECT_DETECTOR',
});
const scene=(objects:VisionDetection[]):SceneDescription=>({shortText:'',detailedText:'',riskLevel:null,objects,recognizedPlace:null,capturedAt:1000});

describe('on-demand scene queries',()=>{
  it('answers with a practical object and relative position',()=>{
    expect(findVisibleObject(scene([detection('DOOR','RIGHT')]),'باب','ar',2000)).toContain('باب على يمينك');
    expect(describeSceneForMobility(scene([detection('CHAIR','FRONT_RIGHT')]),'AHEAD','ar',2000)).toContain('كرسي أمامك إلى اليمين');
  });
  it('rejects stale or low-confidence evidence and never calls an unseen path clear',()=>{
    expect(describeSceneForMobility(scene([]),'AHEAD','ar',2000)).toContain('لا يعني أن الطريق خالٍ');
    expect(findVisibleObject(scene([detection('DOOR','FRONT',.4)]),'door','en',2000)).toContain('not reliably visible');
    expect(findVisibleObject(scene([detection('DOOR','FRONT')]),'door','en',5000)).toContain('recent reliable');
  });
  it('limits on-demand detail without suppressing safety-relevant uncertainty',()=>{
    const current=scene([detection('CHAIR','FRONT'),detection('DOOR','RIGHT'),detection('PERSON','LEFT'),detection('TABLE','FRONT_RIGHT'),detection('COLUMN','FRONT_LEFT')]);
    expect(describeSceneForMobility(current,'AROUND','ar',2000,1)).toBe('كرسي أمامك.');
    expect(describeSceneForMobility(current,'AROUND','ar',2000,5)).toContain('عمود أمامك إلى اليسار');
    expect(describeSceneForMobility(scene([]),'AHEAD','ar',2000,1)).toContain('لا يعني أن الطريق خالٍ');
  });
});
