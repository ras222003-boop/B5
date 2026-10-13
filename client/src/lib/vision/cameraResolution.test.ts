import {afterEach,describe,expect,it,vi} from 'vitest';
import {CameraService,detectionFrame} from './camera';
import {DEFAULT_VISION_CONFIG} from './config';

afterEach(()=>vi.unstubAllGlobals());

describe('separate capture and detection resolutions',()=>{
  it('requests a high-resolution rear stream and reports negotiated pixels',async()=>{
    const stop=vi.fn(),play=vi.fn(async()=>{});
    const track={readyState:'live',stop,getSettings:()=>({width:1280,height:720})};
    const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
    const getUserMedia=vi.fn(async(_constraints:MediaStreamConstraints)=>stream);
    vi.stubGlobal('window',{isSecureContext:true});
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia},permissions:{query:async()=>({state:'granted'})}});
    const video={srcObject:null,muted:false,playsInline:false,play,pause:vi.fn()} as unknown as HTMLVideoElement;
    const service=new CameraService(DEFAULT_VISION_CONFIG);
    await service.start(video);
    expect(getUserMedia.mock.calls[0][0].video).toMatchObject({width:{ideal:1920},height:{ideal:1080},facingMode:{ideal:'environment'}});
    expect(service.frameSize).toEqual({width:1280,height:720});
    service.stop(video);
    expect(stop).toHaveBeenCalledOnce();
  });
  it('feeds at most 640×480 real pixels to detection without shrinking the source video',()=>{
    const drawImage=vi.fn();
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage})})});
    const video={videoWidth:1920,videoHeight:1080} as HTMLVideoElement;
    const frame=detectionFrame(video,DEFAULT_VISION_CONFIG) as HTMLCanvasElement;
    expect([frame.width,frame.height]).toEqual([640,360]);
    expect(drawImage).toHaveBeenCalledWith(video,0,0,640,360);
    expect([video.videoWidth,video.videoHeight]).toEqual([1920,1080]);
  });
});
