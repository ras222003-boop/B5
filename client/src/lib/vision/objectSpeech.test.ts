import {describe,expect,it,vi} from 'vitest';
import type {VisionDetection} from '@shared/vision';
import {visionMessages} from '@/i18n/locales/vision';
import {ObjectSpeechTracker} from './objectSpeech';

const detection=(type:VisionDetection['type'],x:number,area=.08):VisionDetection=>({
  id:`${type}-${x}`,type,confidence:.9,boundingBox:{x,y:.3,width:area/.4,height:.4},
  horizontalDirection:x<.2?'LEFT':x<.4?'FRONT_LEFT':x<.6?'FRONT':x<.8?'FRONT_RIGHT':'RIGHT',
  verticalPosition:'MIDDLE',approximateDistance:null,timestamp:0,source:'OBJECT_DETECTOR',
});

describe('automatic object speech without metres',()=>{
  it('announces a stable object even when depth is absent or the meter is off',()=>{
    const tracker=new ObjectSpeechTracker(visionMessages.ar),announce=vi.fn(()=>true);
    expect(tracker.observe([detection('CHAIR',.44)],1000,announce)).toBeNull();
    expect(tracker.observe([detection('CHAIR',.45)],2000,announce)).toContain('كرسي أمامك');
    expect(announce.mock.calls[0][0]).not.toContain('متر');
    expect(tracker.observe([detection('CHAIR',.45)],8000,announce)).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
  it('prioritizes the center, groups two objects, and announces a meaningful direction change',()=>{
    const tracker=new ObjectSpeechTracker(visionMessages.ar,1000),announce=vi.fn(()=>true);
    const objects=[detection('PERSON',.05),detection('CHAIR',.44)];
    tracker.observe(objects,1000,announce);
    const first=tracker.observe(objects,2000,announce);
    expect(first?.indexOf('كرسي')).toBe(0);
    expect(first).toContain('شخص على اليسار');
    tracker.observe([detection('CHAIR',.57)],3000,announce);
    tracker.observe([detection('CHAIR',.68)],4000,announce);
    tracker.observe([detection('CHAIR',.76)],6000,announce);
    tracker.observe([detection('CHAIR',.76)],8000,announce);
    tracker.observe([detection('CHAIR',.76)],10000,announce);
    expect(tracker.observe([detection('CHAIR',.76)],12000,announce)).toContain('كرسي أمامك إلى اليمين');
  });
  it('never treats box growth as a measured collision warning',()=>{
    const tracker=new ObjectSpeechTracker(visionMessages.ar,1000),announce=vi.fn(()=>true);
    tracker.observe([detection('CHAIR',.44,.04)],1000,announce);
    tracker.observe([detection('CHAIR',.44,.04)],2000,announce);
    const cue=tracker.observe([detection('CHAIR',.44,.09)],3000,announce);
    expect(cue).toContain('قد تكون تقترب');
    expect(cue).not.toContain('متر');
    expect(cue).not.toContain('اصطدام');
  });
});
