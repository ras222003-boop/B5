import type {VisionDetection} from '@shared/vision';
import {COCO_LABELS} from './cocoLabels';
import {colourForSpeech} from './colourAnnouncement';
import {validNormalizedBox} from './objectTracking';
export function imagePosition(d: Pick<VisionDetection,'boundingBox'>) {
  const x=d.boundingBox.x+d.boundingBox.width/2;
  return x<1/3?'في يسار الصورة':x>2/3?'في يمين الصورة':'في وسط الصورة';
}
/** Grounded 2D statements only. A box cannot prove physical support, contents, depth or a safe path. */
export function describeObjectScene(detections: readonly VisionDetection[], options: {
  now:number;objects?:boolean;colors?:boolean;relations?:boolean;minimumScore?:number;
}) {
  const objects=options.objects!==false,colors=options.colors===true;
  if(!objects&&!colors)return '';
  const seen=new Set<string>();
  const rows=detections.filter(d=>{
    const key=d.trackId??d.id;
    if(seen.has(key)||!d.cocoClass||!COCO_LABELS[d.cocoClass]||d.experimental||d.source!=='OBJECT_DETECTOR'||
      d.type.startsWith('STAIRS')||d.type.startsWith('DROP_OFF')||!validNormalizedBox(d.boundingBox)||
      !Number.isFinite(d.confidence)||d.confidence<(options.minimumScore??.5)||d.confidence>1||
      !Number.isFinite(options.now)||!Number.isFinite(d.timestamp)||options.now-d.timestamp>1500||d.timestamp>options.now+5)return false;
    seen.add(key);return true;
  }).sort((a,b)=>b.confidence-a.confidence).slice(0,5);
  if(!rows.length)return 'لم يُكتشف جسم بدرجة كافية؛ لا يثبت ذلك خلو المشهد.';
  const noun=(d:VisionDetection)=>COCO_LABELS[d.cocoClass!].ar;
  const phrases=rows.map(d=>{
    const name=noun(d);
    const color=colors?colourForSpeech(d,{now:options.now,live:false}):'';
    return objects?`${name}${color?` ${color}`:''} ${imagePosition(d)}`:color?`لون ${name}: ${color}`:'';
  }).filter(Boolean);
  if(!phrases.length)return '';
  let relation='';
  if(objects&&options.relations){
    const [a,b]=rows;
    if(a&&b&&a.cocoClass!==b.cocoClass){
      const x=a.boundingBox,y=b.boundingBox;
      if(x.x>=y.x+y.width+.04)relation=`${noun(a)} إلى يمين ${noun(b)} في الصورة.`;
      else if(y.x>=x.x+x.width+.04)relation=`${noun(a)} إلى يسار ${noun(b)} في الصورة.`;
      // Overlap is ambiguous: never infer "on the table", containment or liquid contents.
    }
  }
  return `${objects?'أرى: ':''}${phrases.join('؛ ')}.${relation?' '+relation:''}`;
}
