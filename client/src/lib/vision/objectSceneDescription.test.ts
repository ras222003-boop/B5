import {describe,it,expect} from 'vitest';
import type {VisionDetection} from '@shared/vision';
import {describeObjectScene} from './objectSceneDescription';
const d=(id:string,cocoClass:string,x=.1):VisionDetection=>({id,cocoClass,type:'UNKNOWN_OBSTACLE',confidence:.8,boundingBox:{x,y:.2,width:.2,height:.4},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:100,source:'OBJECT_DETECTOR'});
describe('local grounded Arabic object descriptions',()=>{
 it('describes actual supported objects and image positions without inventing contents',()=>{
  const text=describeObjectScene([d('a','bottle'),d('b','dining table',.7)],{now:100,colors:true,relations:true});
   expect(text).toContain('زجاجة');expect(text).toContain('طاولة');expect(text).toContain('إلى يسار');expect(text).not.toContain('اللون غير واضح');
  expect(text).not.toMatch(/ماء|عليها|امش|آمن|اصطدام/);
 });
 it('rejects stale, unknown, low-score, invalid and research stairs outputs',()=>{
  const a=d('x','chair');expect(describeObjectScene([a],{now:2000})).toContain('لا يثبت');
  for(const b of [{...a,confidence:NaN},{...a,cocoClass:'unknown-widget'},{...a,confidence:.2},{...a,type:'STAIRS_UP'},{...a,boundingBox:{x:-1,y:0,width:1,height:1}}])
   expect(describeObjectScene([b as VisionDetection],{now:100})).toContain('لا يثبت');
 });
 it('does not infer support from overlapping boxes or water from a bottle class',()=>{
  const text=describeObjectScene([d('a','bottle'),d('b','dining table')],{now:100,relations:true});expect(text).not.toMatch(/عليها|فوق|إلى يمين|إلى يسار|ماء/);
 });
 it('honours separate object/colour settings and refuses stale colour',()=>{
  const a=d('a','chair');a.color={name:'red',status:'ESTIMATED',reason:'BOX_ESTIMATE',samples:100,supportFraction:.9,timestamp:90,stableFrames:3,calibrated:false};
  expect(describeObjectScene([a],{now:100,colors:true})).not.toContain('أحمر');
  a.color.timestamp=100;expect(describeObjectScene([a],{now:100,objects:false,colors:true})).toBe('');
  expect(describeObjectScene([a],{now:100,colors:false})).not.toContain('أحمر');
  expect(describeObjectScene([a],{now:100,objects:false,colors:false})).toBe('');
 });
 it('preserves distinct same-class instances, with no ambiguous pair relation',()=>{
  const text=describeObjectScene([d('a','chair'),d('b','chair',.7)],{now:100,relations:true});expect(text.match(/كرسي/g)).toHaveLength(2);expect(text).not.toContain('إلى يسار');
 });
});
