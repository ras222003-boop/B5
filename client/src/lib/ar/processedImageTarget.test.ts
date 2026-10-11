import {describe,it,expect,vi} from 'vitest';
import {
 BASIRA_LAB_LUMINANCE_PATH,fetchApprovedImageTarget,isProcessedBasiraImageTarget,
} from './processedImageTarget';
const valid={
  name:'basira-lab-entrance',type:'PLANAR',
  imagePath:BASIRA_LAB_LUMINANCE_PATH,created:100,
  properties:{top:0,left:0,width:480,height:640,originalWidth:480,originalHeight:640,isRotated:false},
  resources:{
    luminanceImage:'basira-lab-entrance_luminance.png',
    originalImage:'basira-lab-entrance_original.png',
    croppedImage:'basira-lab-entrance_cropped.png',
  },
};
describe('8th Wall CLI marker readiness gate',()=>{
 it('does not accept the former manually-authored SVG manifest',()=>{
   expect(isProcessedBasiraImageTarget({...valid,imagePath:'/ar/targets/basira-lab-marker.svg'})).toBe(false);
   expect(isProcessedBasiraImageTarget({...valid,created:undefined})).toBe(false);
   expect(isProcessedBasiraImageTarget({...valid,resources:{...valid.resources,luminanceImage:'marker.svg'}})).toBe(false);
   expect(isProcessedBasiraImageTarget(valid)).toBe(true);
 });
 it('requires an actual PNG before loading the camera SDK',async()=>{
   const missing=vi.fn(async()=>({ok:false}) as Response);
   await expect(fetchApprovedImageTarget(missing as unknown as typeof fetch)).rejects.toThrow('PROCESSED_MARKER_ASSETS_REQUIRED');
   const mocked=vi.fn(async(url:string)=> url.endsWith('.json')
     ? {ok:true,json:async()=>valid}
     : {ok:true,headers:{get:()=> 'text/html'}}) as unknown as typeof fetch;
   await expect(fetchApprovedImageTarget(mocked)).rejects.toThrow('PROCESSED_MARKER_ASSETS_REQUIRED');
 });
});
