/** Research availability is never production/navigation approval. */
export interface ExperimentalModel {
  schemaVersion:1;scope:'basira-experimental-display-only';id:string;name:string;
  modelSha256:string;entrySha256:string;evaluationScope:'development_validation'|'independent_synthetic_test'|'independent_real_test';
  evaluation:{images:number;scenes:number|null;confidenceCalibrated:false;realEvaluation:string;fixedDetection:unknown};
  researchOnly:true;productionEligible:false;navigationEnabled:false;registeredAt:string;
}
export const experimentalDisplayOnly=(model:ExperimentalModel)=>model.scope==='basira-experimental-display-only'&&model.researchOnly===true&&model.productionEligible===false&&model.navigationEnabled===false;
