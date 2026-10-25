export interface ResearchContract {
  schemaVersion:number; name:string; adapter:'separated-v3'|'single-v2';
  input:{name:'image';shape:[1,3,number,number];color:'RGB';range:number[]}; outputs:string[];
  preprocessing:{mode:'letterbox'|'stretch';padValue:number};
  thresholds:{presence:number;directionConfidence:number;directionMargin:number};
  sha256:string;confidenceCalibrated:boolean;researchOnly:true;productionEnabled:false;
}
export interface ResearchTransform {width:number;height:number;size:number;drawWidth:number;drawHeight:number;left:number;top:number}
export interface ResearchResult {classId:number|null;score:number;box:number[]|null;directionConfidence?:number|null;directionAbstained:boolean}
export const LABELS:Readonly<Record<number,string>>;
export function normalizeEntry(entry:unknown):ResearchContract;
export function makeInput(source:HTMLVideoElement|HTMLCanvasElement|OffscreenCanvas,contract:ResearchContract,canvas:HTMLCanvasElement):{data:Float32Array;transform:ResearchTransform};
export function decodeOutputs(output:Record<string,{dims:number[];data:ArrayLike<number>}>,contract:ResearchContract,transform:ResearchTransform):ResearchResult;
