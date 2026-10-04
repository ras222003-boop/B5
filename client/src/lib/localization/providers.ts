import jsQR from 'jsqr';
import type { MapNode } from '@shared/navigation';
import type { MotionSample, NfcAnchorProvider } from '@shared/localization';

export function parseQrAnchor(value:string,nodes:MapNode[]):MapNode|null {
  const match=/^basira:\/\/building\/([^/]+)\/floor\/([^/]+)\/node\/([^/?#]+)$/.exec(value.trim());
  if(!match)return null;
  return nodes.find(n=>n.buildingId===match[1]&&n.floorId===match[2]&&n.id===match[3])??null;
}

type PermissionEvent=typeof DeviceMotionEvent & {requestPermission?:()=>Promise<'granted'|'denied'>};
type OrientationPermissionEvent=typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<'granted'|'denied'>};

export class PedestrianMotionProvider {
  private lastStep=0;
  private baseline=9.81;
  private steps=0;
  private lastMotionAt=0;
  private gyroHeading:number|null=null;
  private onMotion=(event:DeviceMotionEvent)=>{
    const a=event.accelerationIncludingGravity;
    if(!a||a.x===null||a.y===null||a.z===null)return;
    const magnitude=Math.hypot(a.x,a.y,a.z);
    this.baseline=this.baseline*.9+magnitude*.1;
    const now=Date.now();
    if(this.gyroHeading!==null&&event.rotationRate?.alpha!=null&&this.lastMotionAt){
      const delta=Math.min(.2,(now-this.lastMotionAt)/1000);
      this.gyroHeading=((this.gyroHeading+event.rotationRate.alpha*delta)%360+360)%360;
      this.heading(this.gyroHeading,'GYROSCOPE',false);
    }
    this.lastMotionAt=now;
    const step=magnitude-this.baseline>this.threshold&&now-this.lastStep>this.refractoryMs;
    if(step){this.lastStep=now;this.steps++;}
    this.callback({timestamp:now,accelerationMagnitude:magnitude,rotationRate:event.rotationRate?.alpha??null,headingDegrees:null,stepDetected:step,source:'DEVICE_MOTION'});
  };
  private onOrientation=(event:DeviceOrientationEvent)=>{
    if(event.alpha===null)return;
    const heading=typeof (event as DeviceOrientationEvent & {webkitCompassHeading?:number}).webkitCompassHeading==='number'
      ? (event as DeviceOrientationEvent & {webkitCompassHeading:number}).webkitCompassHeading
      : (360-event.alpha)%360;
    this.gyroHeading=heading;
    this.heading(heading,'COMPASS',event.absolute===true);
  };
  constructor(private readonly callback:(sample:MotionSample)=>void,private readonly heading:(degrees:number,source:'COMPASS'|'GYROSCOPE',absolute:boolean)=>void,
    private readonly threshold=1.2,private readonly refractoryMs=350){}
  get stepCount(){return this.steps;}
  async start():Promise<boolean>{
    if(typeof window==='undefined'||!('DeviceMotionEvent'in window))return false;
    const motion=DeviceMotionEvent as PermissionEvent;
    const orientation=DeviceOrientationEvent as OrientationPermissionEvent;
    if(typeof motion.requestPermission==='function'&&await motion.requestPermission()!=='granted')return false;
    if(typeof orientation.requestPermission==='function'&&await orientation.requestPermission()!=='granted')return false;
    window.addEventListener('devicemotion',this.onMotion);
    window.addEventListener('deviceorientation',this.onOrientation);
    return true;
  }
  stop(){window.removeEventListener('devicemotion',this.onMotion);window.removeEventListener('deviceorientation',this.onOrientation);}
}

/** The scanner reads a single frame at a time and never uploads camera pixels. */
export function decodeQrFrame(video:HTMLVideoElement,canvas:HTMLCanvasElement):string|null {
  if(!video.videoWidth||!video.videoHeight)return null;
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
  context.drawImage(video,0,0);
  const frame=context.getImageData(0,0,canvas.width,canvas.height);
  return jsQR(frame.data,frame.width,frame.height)?.data??null;
}

export function decodeNfcAnchor(record:{recordType?:string;data?:DataView}):string|null {
  if(!record.data)return null;
  const bytes=new Uint8Array(record.data.buffer,record.data.byteOffset,record.data.byteLength);
  if(record.recordType==='text'&&bytes.length){
    const languageLength=bytes[0]&0x3f;
    return new TextDecoder(bytes[0]&0x80?'utf-16':'utf-8').decode(bytes.subarray(1+languageLength));
  }
  if(record.recordType==='url'&&bytes.length){
    const prefix=bytes[0]===0?'':bytes[0]===1?'http://www.':bytes[0]===2?'https://www.':bytes[0]===3?'http://':bytes[0]===4?'https://':'';
    return prefix+new TextDecoder().decode(bytes.subarray(1));
  }
  return new TextDecoder().decode(bytes);
}

/** Web NFC is optional; native shells can provide the same interface. */
export class BrowserNfcAnchorProvider implements NfcAnchorProvider {
  available(){return typeof window!=='undefined'&&'NDEFReader'in window;}
  async scan():Promise<string|null>{
    if(!this.available())return null;
    const Reader=(window as Window & {NDEFReader?:new()=>{scan:(options?:{signal?:AbortSignal})=>Promise<void>;addEventListener:(type:string,listener:(event:{message:{records:{recordType?:string;data?:DataView}[]}})=>void)=>void}}).NDEFReader;
    if(!Reader)return null;
    const reader=new Reader(),controller=new AbortController();
    return new Promise<string|null>((resolve)=>{
      const timer=window.setTimeout(()=>{controller.abort();resolve(null);},15_000);
      reader.addEventListener('reading',(event)=>{window.clearTimeout(timer);controller.abort();resolve(decodeNfcAnchor(event.message.records[0]??{}));});
      reader.scan({signal:controller.signal}).catch(()=>{window.clearTimeout(timer);resolve(null);});
    });
  }
}
