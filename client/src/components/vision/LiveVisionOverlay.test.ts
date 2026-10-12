import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {HorizontalDirection,VisionDetection,VisionObjectType} from '@shared/vision';
import type {AutoMeterSnapshot} from '@/lib/vision/autoMeter';
import {LiveVisionOverlay} from './LiveVisionOverlay';

const detection={id:'one',type:'CHAIR',horizontalDirection:'FRONT',source:'OBJECT_DETECTOR',
  boundingBox:{x:.2,y:.2,width:.3,height:.4}} as VisionDetection;
const frame={frameId:'f1',capturedAt:1000,width:640,height:480,detections:[detection]};
const snapshot={frameId:'f1',capturedAt:1000,nativeSource:'MONOCULAR_METRIC',measurements:[
  {id:'one',frameId:'f1',distanceMeters:1.2},
]} as AutoMeterSnapshot;
const props={frame,snapshot,now:1500,names:{CHAIR:'كرسي'} as Record<VisionObjectType,string>,
  directions:{FRONT:'أمامك'} as Record<HorizontalDirection,string>,metersLabel:'متر',experimentalLabel:'تقدير تجريبي',rtl:true};

describe('SVG camera overlay',()=>{
  it('renders object, direction, and only a same-frame experimental distance',()=>{
    const visible=renderToStaticMarkup(createElement(LiveVisionOverlay,props));
    expect(visible).toContain('كرسي أمامك');
    expect(visible).toContain('1.20');
    expect(visible).toContain('تقدير تجريبي');
    expect(visible).toContain('viewBox="0 0 640 480"');
    const mismatched=renderToStaticMarkup(createElement(LiveVisionOverlay,{...props,snapshot:{...snapshot,frameId:'f2'}}));
    expect(mismatched).toContain('كرسي أمامك');
    expect(mismatched).not.toContain('1.20');
  });
});
