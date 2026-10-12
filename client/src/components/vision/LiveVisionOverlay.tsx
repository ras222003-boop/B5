import * as React from 'react';
import type {AutoMeterSnapshot} from '@/lib/vision/autoMeter';
import {overlayMeters} from '@/lib/vision/liveOverlay';
import type {LiveDetectionFrame} from '@/lib/vision/pipeline';
import type {HorizontalDirection,VisionObjectType} from '@shared/vision';

interface Props {
  frame:LiveDetectionFrame|null;
  snapshot:AutoMeterSnapshot|null;
  now?:number;
  names:Record<VisionObjectType,string>;
  directions:Record<HorizontalDirection,string>;
  metersLabel:string;
  experimentalLabel:string;
  rtl:boolean;
  /** A captured still may remain visible for six seconds; live video keeps the short limit. */
  pinned?:boolean;
}

/** Boxes use the exact source-frame dimensions used by MediaPipe and the metric model. */
export function LiveVisionOverlay({frame,snapshot,now,names,directions,metersLabel,experimentalLabel,rtl,pinned=false}:Props){
  const [clock,setClock]=React.useState(()=>Date.now());
  React.useEffect(()=>{
    if(now!==undefined||!frame)return;
    const timer=window.setInterval(()=>setClock(Date.now()),500);
    return()=>window.clearInterval(timer);
  },[frame?.frameId,now]);
  const visibleAt=Math.max(now??clock,frame?.capturedAt??0);
  const maxAgeMs=pinned?6000:2000;
  if(!frame||!frame.width||!frame.height||visibleAt-frame.capturedAt>maxAgeMs)return null;
  return <svg className="pointer-events-none absolute inset-0 size-full" data-frame-id={frame.frameId} viewBox={`0 0 ${frame.width} ${frame.height}`}
    preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {frame.detections.filter(item=>item.source==='OBJECT_DETECTOR').slice(0,8).map(item=>{
      const box=item.boundingBox;
      if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)return null;
      const x=box.x*frame.width,y=box.y*frame.height,w=box.width*frame.width,h=box.height*frame.height;
      const distance=overlayMeters(item,frame,snapshot,visibleAt,maxAgeMs);
      const label=`${names[item.type]} ${directions[item.horizontalDirection]}${distance===null?'':` · ≈${distance.toFixed(2)} ${metersLabel} (${experimentalLabel})`}`;
      const fontSize=Math.max(13,Math.min(20,frame.width/30));
      const labelWidth=Math.min(frame.width,Math.max(80,label.length*fontSize*.58));
      const labelX=Math.max(0,Math.min(x,frame.width-labelWidth));
      const labelY=Math.max(0,y-fontSize-8);
      return <g key={item.id}>
        <rect x={x} y={y} width={w} height={h} rx="3" fill="none" stroke="#fbbf24" strokeWidth="3" />
        <rect x={labelX} y={labelY} width={labelWidth} height={fontSize+8} rx="3" fill="#1c1917" fillOpacity=".92" />
        <text x={rtl?labelX+labelWidth-4:labelX+4} y={labelY+fontSize+1} fill="white" fontSize={fontSize} fontWeight="700" direction={rtl?'rtl':'ltr'} textAnchor={rtl?'end':'start'}>{label}</text>
      </g>;
    })}
  </svg>;
}
