import { describe, expect, it, vi } from 'vitest';
import {metricDiagnostic, validateAlignedMetricFrame, VerifiedMetricDepthProvider} from './metricEngine';

const good = {
 width: 16, height: 12, values: Array(16*12).fill(1.5),
 confidence: .94, source: 'ARKIT_DEPTH' as const,
 frameTimestampMs: 1000, alignedToVideo: true as const,
};

describe('Basira verified metre-depth inputs', () => {
  it('accepts verified pixel-aligned ARKit and ARCore metre maps', () => {
    for (const source of ['ARKIT_DEPTH','ARCORE_DEPTH'] as const) {
      const map=validateAlignedMetricFrame({...good,source},1000);
      expect(map).toMatchObject({source,alignmentVerified:true,width:16,height:12,timestamp:1000});
      expect(map?.values[5]).toBeCloseTo(1.5);
    }
  });
  it('rejects browser guesses, stale frames and unverified RGB alignment', () => {
    expect(validateAlignedMetricFrame({...good, source:'8TH_WALL_ABSOLUTE_SCALE'},1000)).toBeNull();
    expect(validateAlignedMetricFrame({...good, alignedToVideo:false},1000)).toBeNull();
    expect(validateAlignedMetricFrame({...good, frameTimestampMs:1105},1000)).toBeNull();
    expect(validateAlignedMetricFrame({...good, confidence:.6},1000)).toBeNull();
    expect(validateAlignedMetricFrame({...good, values:[1]},1000)).toBeNull();
    expect(validateAlignedMetricFrame({...good,values:Array(192).fill(NaN)},1000)).toBeNull();
  });
  it('makes invalid individual pixels unavailable without inventing range', () => {
    const map=validateAlignedMetricFrame({...good,values:[0,-1,Infinity,...Array(189).fill(2.3)]},1000);
    expect(map).not.toBeNull();
    expect(Number.isNaN(map!.values[0])).toBe(true);
    expect(Number.isNaN(map!.values[1])).toBe(true);
    expect(Number.isNaN(map!.values[2])).toBe(true);
  });
  it('reports sensor availability separately from detection and tolerates no bridge', async () => {
    const adapter=new VerifiedMetricDepthProvider({getAlignedDepth:vi.fn(async()=>good)});
    const map=await adapter.capture(1000);
    expect(metricDiagnostic(map,1000,true)).toEqual({status:'LIVE',source:'ARKIT_DEPTH'});
    expect(metricDiagnostic(map,2000,true)).toEqual({status:'REJECTED',source:null});
    expect(metricDiagnostic(null,1000,true).status).toBe('WAITING');
    expect(metricDiagnostic(null,1000,false).status).toBe('UNAVAILABLE');
    await adapter.close();
  });
});
