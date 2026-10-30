import {afterEach,describe,expect,it,vi} from 'vitest';
import {CameraService,detectionFrame} from './camera';
import {DEFAULT_VISION_CONFIG} from './config';

afterEach(()=>vi.unstubAllGlobals());

describe('separate capture and detection resolutions',()=>{
  it('does not open a camera after stop while the permission query is pending',async()=>{
    let queried!:(value:{state:string})=>void;
    const getUserMedia=vi.fn();
    vi.stubGlobal('window',{isSecureContext:true});
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia},permissions:{query:()=>new Promise(resolve=>{queried=resolve;})}});
    const video={pause:vi.fn(),srcObject:null} as unknown as HTMLVideoElement;
    const service=new CameraService(DEFAULT_VISION_CONFIG),start=service.start(video);
    service.stop(video);queried({state:'granted'});
    await expect(start).rejects.toThrow('FAILED');expect(getUserMedia).not.toHaveBeenCalled();expect(service.active).toBe(false);
  });
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
  it.each(['AbortError','Error'])('never retries an obsolete %s camera acquisition after Stop',async name=>{
    let reject!:(error:Error)=>void;
    const getUserMedia=vi.fn(()=>new Promise<MediaStream>((_resolve,fail)=>{reject=fail;}));
    vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    const video={pause:vi.fn(),srcObject:null} as unknown as HTMLVideoElement;
    const service=new CameraService(DEFAULT_VISION_CONFIG),starting=service.start(video);
    await Promise.resolve();service.stop(video);reject(new DOMException('stopped',name));
    await expect(starting).rejects.toThrow('FAILED');expect(getUserMedia).toHaveBeenCalledOnce();
  });
  it('does not retry an active native-suspend AbortError with different constraints',async()=>{
    const getUserMedia=vi.fn().mockRejectedValue(new DOMException('suspended','AbortError'));
    vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    const service=new CameraService(DEFAULT_VISION_CONFIG);
    await expect(service.start({pause:vi.fn(),srcObject:null} as unknown as HTMLVideoElement)).rejects.toThrow('FAILED');
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
  it('an old playback failure cannot stop or detach a newer camera stream',async()=>{
    let reject!:(error:Error)=>void;
    const oldTrack={readyState:'live',stop:vi.fn()},newTrack={readyState:'live',stop:vi.fn()};
    const stream=(track:typeof oldTrack)=>({getTracks:()=>[track],getVideoTracks:()=>[track]});
    const oldStream=stream(oldTrack),newStream=stream(newTrack);
    const getUserMedia=vi.fn().mockResolvedValueOnce(oldStream).mockResolvedValueOnce(newStream);
    vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    const play=vi.fn().mockReturnValueOnce(new Promise<void>((_resolve,fail)=>{reject=fail;})).mockResolvedValue(undefined);
    const video={pause:vi.fn(),srcObject:null,play} as unknown as HTMLVideoElement;
    const service=new CameraService(DEFAULT_VISION_CONFIG),starting=service.start(video);
    await Promise.resolve();await Promise.resolve();expect(play).toHaveBeenCalledOnce();
    service.stop(video);await service.start(video);reject(Error('old play failed'));
    await expect(starting).rejects.toThrow('FAILED');expect(service.active).toBe(true);
    expect(video.srcObject).toBe(newStream);expect(newTrack.stop).not.toHaveBeenCalled();service.stop(video);
  });
});
