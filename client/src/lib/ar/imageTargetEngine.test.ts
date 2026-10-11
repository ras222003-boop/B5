import { describe, expect, it } from 'vitest';
import { validateLabImageTargetManifest, BASIRA_MARKER_JSON_URL, BASIRA_8THWALL_MIT_CDN } from './imageTargetEngine';

const valid = {
  name: 'basira-lab-entrance',
  type: 'PLANAR',
  imagePath: '/ar/targets/basira-lab-entrance_luminance.png',
  created: 1760000000000,
  resources: {luminanceImage:'basira-lab-entrance_luminance.png', originalImage:'basira-lab-entrance_original.png', croppedImage:'basira-lab-entrance_cropped.png'},
  properties: {top:0,left:0,width:480,height:640,isRotated:false,originalWidth:480,originalHeight:640},
};

describe('8th Wall image target lab boundaries', () => {
  it('pins the MIT pre-release and same-origin training manifest', () => {
    expect(BASIRA_8THWALL_MIT_CDN).toContain('@8thwall/engine@0.1.0/');
    expect(BASIRA_8THWALL_MIT_CDN).not.toContain('engine-binary');
    expect(BASIRA_MARKER_JSON_URL.startsWith('/ar/')).toBe(true);
  });

  it('accepts only the known test target with expected dimensions', () => {
    expect(validateLabImageTargetManifest(valid)).toBe(true);
    expect(validateLabImageTargetManifest({...valid, name:'unknown-room'})).toBe(false);
    expect(validateLabImageTargetManifest({...valid, imagePath:'https://attacker.example/image'})).toBe(false);
    expect(validateLabImageTargetManifest({...valid, properties:{...valid.properties,width:-1}})).toBe(false);
    expect(validateLabImageTargetManifest({...valid, created:undefined})).toBe(false);
    expect(validateLabImageTargetManifest(null)).toBe(false);
  });
});
