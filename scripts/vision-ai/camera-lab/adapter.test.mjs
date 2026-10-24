import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEntry,frameTransform,decodeOutputs} from './adapter.mjs';

const hash='a'.repeat(64);
const entry=(separated=false)=>({researchOnly:true,productionEnabled:false,name:'test',sha256:hash,
  input:{name:'image',shape:[1,3,separated?160:128,separated?160:128],range:[0,1],color:'RGB'},
  outputs:separated?['presence_logits','direction_logits','box_xywh']:['class_logits','box_xywh'],
  classIds:[null,2301,2302,2303,2304],preprocessing:separated?{mode:'letterbox',padValue:127/255}:{mode:'stretch'},
  thresholds:{presence:.5,directionConfidence:.7,directionMargin:.2}});
const tensor=(data)=>({data:new Float32Array(data),dims:[1,data.length]});
test('V3 letterbox output box is mapped back to original image',()=>{
  const contract=normalizeEntry(entry(true)),transform=frameTransform(320,240,160,'letterbox');
  const out={presence_logits:tensor([-5,5,-5]),direction_logits:tensor([5,-5,-5]),box_xywh:tensor([.1,.2,.8,.6])};
  const value=decodeOutputs(out,contract,transform);
  assert.equal(value.classId,2301);assert.equal(value.directionAbstained,false);
  assert.ok(Math.abs(value.box[0]-.1)<1e-6);assert.ok(Math.abs(value.box[1]-.1)<1e-6);assert.ok(Math.abs(value.box[3]-.8)<1e-6);
});
test('V3 separates presence, escalator, and uncertain direction',()=>{
  const c=normalizeEntry(entry(true)),t=frameTransform(320,240,160,'letterbox'),box_xywh=tensor([.1,.2,.8,.6]);
  assert.equal(decodeOutputs({presence_logits:tensor([6,-2,-3]),direction_logits:tensor([6,0,0]),box_xywh},c,t).classId,null);
  assert.equal(decodeOutputs({presence_logits:tensor([-2,-3,6]),direction_logits:tensor([6,0,0]),box_xywh},c,t).classId,2304);
  const uncertain=decodeOutputs({presence_logits:tensor([-3,6,-3]),direction_logits:tensor([.1,.09,0]),box_xywh},c,t);
  assert.equal(uncertain.classId,2303);assert.equal(uncertain.directionAbstained,true);
});
test('V2 contract retains its actual original decision rule',()=>{
  const c=normalizeEntry(entry()),t=frameTransform(320,240,128,'stretch');
  assert.equal(decodeOutputs({class_logits:tensor([-4,1,6,-4,-4]),box_xywh:tensor([.1,.2,.5,.5])},c,t).classId,2302);
});
test('shape, finite-value and production contract failures stop inference',()=>{
  assert.throws(()=>normalizeEntry({...entry(),productionEnabled:true}),/Research/);
  assert.throws(()=>normalizeEntry({...entry(true),preprocessing:undefined}),/preprocessing/);
  const c=normalizeEntry(entry()),t=frameTransform(320,240,128,'stretch');
  assert.throws(()=>decodeOutputs({class_logits:tensor([1,2]),box_xywh:tensor([0,0,1,1])},c,t),/shape/);
  assert.throws(()=>decodeOutputs({class_logits:tensor([NaN,0,0,0,0]),box_xywh:tensor([0,0,1,1])},c,t),/Nonfinite/);
});
