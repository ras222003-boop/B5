import type {PerceptionSnapshot} from './perception';
import type {ColorPixels} from './objectColors';
/** Compare sampled pixels locally. The digest itself is never exported; changes prove pixel variation, not correct recognition. */
export function sourcePixelSignature(frame:ColorPixels){
  let hash=(2166136261^frame.width^frame.height)>>>0;
  const step=Math.max(4,Math.floor(frame.data.length/(768*4))*4);
  for(let i=0;i<frame.data.length;i+=step)for(let c=0;c<3;c++)hash=Math.imul(hash^frame.data[i+c],16777619)>>>0;
  return hash;
}
export type BatterySample={level:number;charging:boolean};
/** Explicit, bounded metadata allowlist. Never serialise the surrounding perception/ground/location object. */
export class ObjectTrialRecorder {
  readonly sceneId=crypto.randomUUID();
  readonly startedAtUtc=new Date().toISOString();
  private frames:{frameId:string;inferenceMs:number;tracking:string;objects:{class:string;score:number;trackId:string|null;box:{x:number;y:number;width:number;height:number};colour:string|null;colourStatus:string}[]}[]=[];
  private processed=0;private lastFrame='';private timings:number[]=[];private ended:number|null=null;
  private speechRequests=0;private initialBattery:BatterySample|null=null;
  private cameraSize:{width:number;height:number}|null=null;
  private states:Record<string,number>={};private tracksEnded:boolean|null=null;
  private sourceSamples=0;private sourceChanges=0;private previousSignature:number|null=null;
  constructor(readonly modelId:string,readonly modelSha256:string,private started:number){}
  battery(sample:BatterySample){this.initialBattery??=sample;}
  camera(size:{width:number;height:number}){this.cameraSize={width:size.width,height:size.height};}
  speech(){this.speechRequests++;}
  state(value:string){if(this.ended===null&&['WAITING','LIVE','STALE','PAUSED','SLOW','ERROR'].includes(value))this.states[value]=(this.states[value]??0)+1;}
  source(signature:number){if(this.ended!==null)return;this.sourceSamples++;if(this.previousSignature!==null&&signature!==this.previousSignature)this.sourceChanges++;this.previousSignature=signature;}
  record(snapshot:PerceptionSnapshot|null){
    if(!snapshot||snapshot.frameId===this.lastFrame||this.ended!==null)return;
    this.lastFrame=snapshot.frameId;this.processed++;
    const ms=snapshot.performance.inferenceMs;if(Number.isFinite(ms)&&ms>=0){this.timings.push(ms);if(this.timings.length>600)this.timings.shift();}
    this.frames.push({frameId:snapshot.frameId,inferenceMs:ms,tracking:snapshot.tracking,
      objects:snapshot.observations.slice(0,30).map(({detection:d})=>({class:d.cocoClass??'unknown',score:d.confidence,trackId:d.trackId??null,
        box:{x:d.boundingBox.x,y:d.boundingBox.y,width:d.boundingBox.width,height:d.boundingBox.height},colour:d.color?.name??null,colourStatus:d.color?.status??'UNCLEAR'}))});
    if(this.frames.length>300)this.frames.shift();
  }
  finish(at:number,tracksEnded?:boolean){if(this.ended===null){this.ended=at;this.tracksEnded=tracksEnded??null;}}
  export(at:number,measurements:{battery?:BatterySample|null;jsHeapBytes?:number|null;playback?:{total:number;dropped:number}|null;camera?:{width:number;height:number}|null;speech?:{mode:string;error:string|null};browser?:{userAgent:string;secureContext:boolean}}={}){
    const sorted=[...this.timings].sort((a,b)=>a-b),duration=Math.max(0,(this.ended??at)-this.started);
    return {schemaVersion:1,status:'RECORDED_UNREVIEWED',sceneId:this.sceneId,startedAtUtc:this.startedAtUtc,
      modelId:this.modelId,modelSha256:this.modelSha256,modelScoresCalibrated:false,referenceLabels:false,
      durationMs:duration,processedFrames:this.processed,effectiveAnalysesPerSecond:duration?this.processed*1000/duration:null,
      inferenceMedianMs:sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null,p95InferenceMs:sorted.length?sorted[Math.ceil(.95*sorted.length)-1]:null,
      timingWindowSamples:sorted.length,savedFrameSummaries:this.frames.length,truncatedFrameSummaries:Math.max(0,this.processed-this.frames.length),
      timingWindowMeaning:'Accepted perception snapshots only; discarded inference durations are not measured here',discardedInferenceCount:null,
      analysisStateEvents:this.states,cameraTracksEnded:this.tracksEnded,
      sourcePixelVariation:this.sourceSamples<2?'INSUFFICIENT_SAMPLES':this.sourceChanges?'OBSERVED':'NOT_OBSERVED',sourceSignatureSamples:this.sourceSamples,sourcePixelChanges:this.sourceChanges,
      sourceVariationMeaning:'Local sampled-pixel changes only; does not attest hardware, multiple objects or accurate detections',playback:measurements.playback??null,camera:measurements.camera??this.cameraSize,
      jsHeapBytes:measurements.jsHeapBytes??null,memoryMeaning:'Optional browser JS heap snapshot; not total process, ORT or GPU memory',
      batteryStart:this.initialBattery,batteryEnd:measurements.battery??null,
      reportedBatteryLevelChange:this.initialBattery&&measurements.battery?this.initialBattery.level-measurements.battery.level:null,
      batteryLifeEstimate:null,temperature:null,speechRequests:this.speechRequests,speechStatus:measurements.speech??null,
      browser:measurements.browser??null,browserIdentityMeaning:'Browser-reported identity, not hardware attestation',
      detectionAccuracy:null,trackIdentityAccuracy:null,colourAccuracy:null,frames:this.frames,
      mediaSaved:false,mediaUploaded:false,navigationEligible:false,productionEligible:false};
  }
}
export async function reportedBattery():Promise<BatterySample|null>{
  const n=navigator as Navigator&{getBattery?:()=>Promise<BatterySample>};
  try{if(!n.getBattery)return null;const b=await n.getBattery();return {level:b.level,charging:b.charging};}catch{return null;}
}
