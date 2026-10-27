import {describe,expect,it,vi} from 'vitest';
import type {VisionDetection} from '@shared/vision';
import {DEFAULT_VISION_CONFIG} from './config';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';
import {visionMessages} from '@/i18n/locales/vision';

describe('Vision approach alert integration',()=>{
  it('keeps a centered detected wall descriptive without creating an automatic safety warning',()=>{
    const now=1000, announce=vi.fn(()=>null), scene=vi.fn(), alert=vi.fn();
    const wall:VisionDetection={id:'wall',type:'WALL',confidence:.9,
      boundingBox:{x:.35,y:.2,width:.3,height:.7},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
      approximateDistance:null,timestamp:now,source:'OBJECT_DETECTOR'};
    const options={video:{paused:false,ended:false,srcObject:null},
      vision:{detect:async()=>[],close:async()=>{}},ocr:{recognize:async()=>[],close:async()=>{}},
      depth:{read:async()=>null,close:async()=>{}},
      config:DEFAULT_VISION_CONFIG,copy:visionMessages.ar,mode:'EXPLORATION',buildingId:null,floorId:null,
      announcement:{announce,reset:vi.fn()},callbacks:{scene,alert,candidate:vi.fn(),recognized:vi.fn(),
        OCRFailure:vi.fn(),segmentationFailure:vi.fn(),depthFailure:vi.fn(),fatal:vi.fn()},
    } as unknown as VisionPipelineOptions;
    const pipeline=new VisionPipeline(options);
    const internals=pipeline as unknown as {latestObjects:VisionDetection[];lastCapturedAt:number;
      lastCaptureWallTime:number;publish:(at:number,fromDetection:boolean)=>void};
    internals.latestObjects=[wall];internals.lastCapturedAt=now;internals.lastCaptureWallTime=Date.now();
    internals.publish(now,true);
    expect(scene.mock.lastCall?.[0].riskLevel).toBe('INFORMATION');
    expect(announce).toHaveBeenCalledWith([],expect.any(Number));
    expect(alert).not.toHaveBeenCalled();
  });
});
