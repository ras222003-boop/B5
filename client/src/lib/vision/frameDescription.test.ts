import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureDescriptionFrame,cropDescriptionFrame,requestFrameDescription} from './frameDescription';

afterEach(()=>vi.unstubAllGlobals());

describe('on-demand camera still',()=>{
  it('draws the current video frame and encodes one bounded JPEG',async()=>{
    const drawImage=vi.fn();
    const canvas={width:0,height:0,getContext:()=>({drawImage}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array(200)],{type:'image/jpeg'}))};
    vi.stubGlobal('document',{createElement:()=>canvas});
    vi.stubGlobal('HTMLMediaElement',{HAVE_CURRENT_DATA:2});
    vi.stubGlobal('FileReader',class {result:string|null=null;onload?:()=>void;readAsDataURL(blob:Blob){expect(blob.type).toBe('image/jpeg');this.result='data:image/jpeg;base64,ZmFrZQ==';this.onload?.();}});
    const video={videoWidth:2560,videoHeight:1440,readyState:2} as HTMLVideoElement;
    const result=await captureDescriptionFrame(video,null,false);
    expect(drawImage).toHaveBeenCalledWith(video,0,0,2048,1152);
    expect(result).toMatchObject({width:2048,height:1152,sourceWidth:2560,sourceHeight:1440,source:'video'});
    expect(result.imageBase64).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('never enlarges a low-resolution native frame',async()=>{
    const drawImage=vi.fn();
    const output={width:0,height:0,getContext:()=>({drawImage}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array(200)],{type:'image/jpeg'}))};
    vi.stubGlobal('document',{createElement:()=>output});
    vi.stubGlobal('FileReader',class {result='data:image/jpeg;base64,ZmFrZQ==';onload?:()=>void;readAsDataURL(){this.onload?.();}});
    const native={width:480,height:640} as HTMLCanvasElement;
    const result=await captureDescriptionFrame({} as HTMLVideoElement,native,true);
    expect(result).toMatchObject({width:480,height:640,sourceWidth:480,sourceHeight:640,source:'native'});
    expect(drawImage).toHaveBeenCalledWith(native,0,0,480,640);
  });
  it('uses a genuine camera still when ImageCapture is available and strips its metadata through canvas',async()=>{
    const drawImage=vi.fn(),revokeObjectURL=vi.fn();
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array(200)],{type:'image/jpeg'}))})});
    vi.stubGlobal('HTMLMediaElement',{HAVE_CURRENT_DATA:2});
    vi.stubGlobal('ImageCapture',class {async takePhoto(){return new Blob([new Uint8Array(512)],{type:'image/jpeg'});}});
    vi.stubGlobal('Image',class {naturalWidth=4000;naturalHeight=3000;src='';async decode(){}});
    vi.stubGlobal('URL',{createObjectURL:()=> 'blob:photo',revokeObjectURL});
    vi.stubGlobal('FileReader',class {result='data:image/jpeg;base64,ZmFrZQ==';onload?:()=>void;readAsDataURL(){this.onload?.();}});
    const video={videoWidth:1920,videoHeight:1080,readyState:2,srcObject:{getVideoTracks:()=>[{readyState:'live'}]}} as unknown as HTMLVideoElement;
    const frame=await captureDescriptionFrame(video,null,false);
    expect(frame).toMatchObject({source:'photo',sourceWidth:4000,sourceHeight:3000,width:2048,height:1536});
    expect(drawImage).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('crops original pixels only after a selected inspection region is requested',async()=>{
    const draws:unknown[][]=[];
    vi.stubGlobal('Image',class {naturalWidth=1600;naturalHeight=1200;src='';async decode(){}});
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:(...args:unknown[])=>draws.push(args)}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array(200)],{type:'image/jpeg'}))})});
    vi.stubGlobal('FileReader',class {result='data:image/jpeg;base64,ZmFrZQ==';onload?:()=>void;readAsDataURL(){this.onload?.();}});
    const original={imageBase64:'data:image/jpeg;base64,ZmFrZQ==',width:1600,height:1200,sourceWidth:1600,sourceHeight:1200,source:'video' as const};
    const crop=await cropDescriptionFrame(original,'right');
    expect(crop).toMatchObject({width:800,height:1200,source:'crop'});
    expect(draws[0].slice(1)).toEqual([800,0,800,1200,0,0,800,1200]);
    expect(await cropDescriptionFrame(original,'full')).toBe(original);
  });
  it('sends the captured still only for a requested description mode',async()=>{
    const fetchMock=vi.fn(async(_url:string,options:RequestInit)=>{
      expect(JSON.parse(options.body as string)).toMatchObject({mode:'detailed',consent:true,imageBase64:'data:image/jpeg;base64,AA=='});
      return {ok:true,json:async()=>({description:'وصف حقيقي'})};
    });
    vi.stubGlobal('fetch',fetchMock);
    expect(await requestFrameDescription('data:image/jpeg;base64,AA==','detailed')).toEqual({description:'وصف حقيقي',diagnostics:undefined});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports network failure instead of returning a fabricated description',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(requestFrameDescription('data:image/jpeg;base64,AA==','brief')).rejects.toThrow();
  });
});
