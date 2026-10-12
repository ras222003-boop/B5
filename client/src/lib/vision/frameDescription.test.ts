import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureDescriptionFrame,requestFrameDescription} from './frameDescription';

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
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('sends the captured still only for a requested description mode',async()=>{
    const fetchMock=vi.fn(async(_url:string,options:RequestInit)=>{
      expect(JSON.parse(options.body as string)).toMatchObject({mode:'detailed',consent:true,imageBase64:'data:image/jpeg;base64,AA=='});
      return {ok:true,json:async()=>({description:'وصف حقيقي'})};
    });
    vi.stubGlobal('fetch',fetchMock);
    expect(await requestFrameDescription('data:image/jpeg;base64,AA==','detailed')).toBe('وصف حقيقي');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports network failure instead of returning a fabricated description',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(requestFrameDescription('data:image/jpeg;base64,AA==','brief')).rejects.toThrow();
  });
});
