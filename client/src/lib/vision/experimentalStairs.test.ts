import {describe,it,expect} from 'vitest';
import type {ExperimentalModel} from '@shared/experimentalModels';
import {researchDetections} from './experimentalStairs';
import {VisionPipeline} from './pipeline';
import {BasiraSafetyEngine} from './safety';
import {DEFAULT_VISION_CONFIG} from './config';
const model={id:'test-model',modelSha256:'a'.repeat(64)} as ExperimentalModel;
describe('research adapters never become navigation decisions or reference labels',()=>{
  it('maps up/down/uncertain geometry into the existing detection contract with immutable provenance',()=>{
    for(const[classId,type]of[[2301,'STAIRS_UP'],[2302,'STAIRS_DOWN'],[2303,'STAIRS_UNCERTAIN']] as const){
      const [detection]=researchDetections({classId,score:.8,box:[.1,.2,.3,.4],directionAbstained:classId===2303},model,100);
      expect(detection.type).toBe(type);expect(detection.boundingBox).toEqual({x:.1,y:.2,width:.3,height:.4});
      expect(detection.experimental).toMatchObject({modelId:'test-model',navigationEligible:false,referenceLabel:false});expect(detection.approximateDistance).toBeNull();
      expect(()=>new BasiraSafetyEngine(DEFAULT_VISION_CONFIG).classify(detection)).toThrow(/display-only/);
    }
    expect(researchDetections({classId:null,score:.9,box:null,directionAbstained:false},model,100)).toEqual([]);
  });
  it('rejects the research provider at the existing safety-pipeline boundary before initialization',()=>{
    expect(()=>new VisionPipeline({vision:{usagePolicy:'EXPERIMENTAL_DISPLAY_ONLY'}} as never)).toThrow(/cannot enter guidance/);
  });
  it('does not relabel escalators as fixed stairs',()=>{
    const [detection]=researchDetections({classId:2304,score:.9,box:[0,0,.5,.5],directionAbstained:false},model,1);
    expect(detection.type).toBe('UNKNOWN_OBSTACLE');expect(detection.experimental?.classId).toBe(2304);
  });
});
