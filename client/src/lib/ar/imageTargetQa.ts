import type {LandmarkDetection} from './imageTargetLandmarks';

/**
 * Camera-event only diagnostics. No frames, coordinates, user identifiers, or
 * facial/biometric data are stored. Data stays in component memory until export.
 */
export type ImageTargetQaMetrics=Readonly<{
  observedEvents:number;
  recognitions:number;
  trackingLosses:number;
  firstRecognitionMs:number|null;
  noRecognitionObserved:boolean;
  validatedOnPhysicalDevice:false;
}>;

export function summarizeImageTargetQa(
  startEpochMs:number|null,
  observations:readonly LandmarkDetection[],
):ImageTargetQaMetrics {
  const valid=observations.filter(o=>Number.isFinite(o.observedAt)&&o.observedAt>=0);
  const found=valid.filter(o=>o.state==='found');
  const first=found.length?Math.min(...found.map(o=>o.observedAt)):null;
  return {
    observedEvents:valid.length,
    recognitions:found.length,
    trackingLosses:valid.filter(o=>o.state==='lost').length,
    firstRecognitionMs:startEpochMs!==null && first!==null && first>=startEpochMs ? first-startEpochMs : null,
    noRecognitionObserved:found.length===0,
    validatedOnPhysicalDevice:false,
  };
}

export function imageTargetEventsCsv(observations:readonly LandmarkDetection[]):string {
  // TSV/CSV injection is impossible because only allowlisted literal fields
  // and numerical timestamps enter this export, not arbitrary camera payload.
  return ['event,marker,unix_ms', ...observations.map(event=>
    [event.state,'basira-lab-entrance',Number.isFinite(event.observedAt)?Math.round(event.observedAt):0].join(','))].join('\n');
}
