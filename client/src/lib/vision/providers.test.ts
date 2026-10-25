import {describe,it,expect} from 'vitest';
import {normalizeObjectDetections,cocoTypes} from './providers';
import {objectLabel} from './cocoLabels';
import {visionMessages} from '@/i18n/locales/vision';
const raw=(name:string,x=10,score=.9)=>({categories:[{categoryName:name,score}],boundingBox:{originX:x,originY:10,width:50,height:50}});
describe('truthful detector postprocessing',()=>{
 it('maps only supported COCO labels and preserves small unnamed detections without inventing a class',()=>{
  for(const [name,type] of Object.entries(cocoTypes))expect(normalizeObjectDetections([raw(name)],100,100,1)[0].type).toBe(type);
  expect(normalizeObjectDetections([{...raw('unmapped COCO class'),boundingBox:{originX:3,originY:80,width:3,height:4}}],100,100,1)[0].type).toBe('UNKNOWN_OBSTACLE');
 });
 it('clips borders correctly and rejects invalid scores or geometry',()=>{
  const values=normalizeObjectDetections([raw('chair',-10),raw('chair',110),raw('chair',20,NaN),{...raw('car'),boundingBox:{originX:0,originY:0,width:-5,height:10}}],100,100,1);
  expect(values).toHaveLength(1);expect(values[0].boundingBox).toEqual({x:0,y:.1,width:.4,height:.5});
  expect(values[0].trackId).toBeUndefined();expect(normalizeObjectDetections([raw('chair')],0,100,1)).toEqual([]);
 });
 it('NMS suppresses against accepted boxes only, preserving overlapping separate objects',()=>{
  const result=normalizeObjectDetections([raw('chair',0,.95),raw('chair',10,.9),raw('chair',20,.85),raw('person',0,.8)],100,100,1);
  expect(result.map(item=>item.type)).toEqual(['CHAIR','CHAIR','PERSON']);
 });
 it('names supported classes without merging distinct unknown types or inventing classes',()=>{
  const result=normalizeObjectDetections([raw('cup',0,.95),raw('cup',40,.9),raw('fork',0,.85),raw('untrained widget',0,.8)],100,100,1);
  expect(result.map(d=>d.cocoClass)).toEqual(['cup','cup','fork',undefined]);
  expect(result.map(d=>objectLabel(d,visionMessages.ar))).toEqual(['كوب','كوب','شوكة',visionMessages.ar.object.UNKNOWN_OBSTACLE]);
  expect(result.every(d=>d.type==='UNKNOWN_OBSTACLE')).toBe(true); // Presentation never changes safety types.
 });
});
