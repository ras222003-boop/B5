import {describe,expect,it,vi} from 'vitest';
import type {VisionDetection} from '@shared/vision';
import {visionMessages} from '@/i18n/locales/vision';
import {DEFAULT_VISION_CONFIG} from './config';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';

describe('vision pipeline audio isolation',()=>{
  it('speaks detected objects without depth and ignores an unrelated geometry publication',()=>{
    const speech=vi.fn(()=>true);
    const frame:VisionDetection={id:'chair',type:'CHAIR',confidence:.9,boundingBox:{x:.4,y:.3,width:.2,height:.3},
      horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:1,source:'OBJECT_DETECTOR',trackId:'one',
      tracking:{state:'TENTATIVE',observations:1,firstSeenAt:1,lastSeenAt:1,gapMs:0}};
    const pipeline=new VisionPipeline({autoMeterEnabled:false,video:{} as HTMLVideoElement,
      vision:{close:async()=>{}},ocr:{close:async()=>{}},depth:{close:async()=>{}},
      config:DEFAULT_VISION_CONFIG,copy:visionMessages.ar,mode:'EXPLORATION',buildingId:null,floorId:null,
      announcement:{announce:()=>null,reset:()=>{}},callbacks:{scene:()=>{},objectSpeech:speech},
    } as unknown as VisionPipelineOptions);
    const internals=pipeline as unknown as {latestObjects:VisionDetection[];publish:(now:number,fromDetection?:boolean)=>void};
    internals.latestObjects=[frame];
    internals.publish(1,true);internals.publish(2);
    expect(speech).not.toHaveBeenCalled();
    internals.latestObjects=[{...frame,timestamp:500,tracking:{state:'TRACKED',observations:2,firstSeenAt:1,lastSeenAt:500,gapMs:499}}];
    internals.publish(500,true);
    expect(speech).toHaveBeenCalledWith(`كرسي ${visionMessages.ar.direction.FRONT}.`);
    internals.publish(600,true);internals.publish(700); // Neither a replay nor geometry is a new observation.
    internals.publish(6000,true); // An old object must never reappear through a late publication.
    pipeline.setObjectSpeechEnabled(false);
    internals.publish(6001,true);internals.publish(6002,true);
    expect(speech).toHaveBeenCalledTimes(1);
  });
});
