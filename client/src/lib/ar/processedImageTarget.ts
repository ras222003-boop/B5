/**
 * 8th Wall's image target CLI produces a grayscale luminance image plus JSON
 * crop metadata.  A hand-authored SVG/JSON is NOT a processed Image Target.
 *
 * Never accept arbitrary metadata URLs supplied by a camera event or QR code.
 * See https://8thwall.org/docs/engine/guides/image-targets
 */
export const BASIRA_LAB_PROCESSED_TARGET_NAME = 'basira-lab-entrance';
export const BASIRA_LAB_LUMINANCE_PATH = '/ar/targets/basira-lab-entrance_luminance.png';

export interface ProcessedImageTarget {
  name: string;
  type: 'PLANAR';
  imagePath: string;
  properties: {
    top:number; left:number; width:number; height:number;
    originalWidth:number; originalHeight:number;
    isRotated:boolean;
  };
  resources: {
    luminanceImage:string;
    originalImage:string;
    croppedImage:string;
  };
  created: number;
}

const validFinite=(n:unknown)=>typeof n==='number' && Number.isFinite(n) && n>=0;

export function isProcessedBasiraImageTarget(input:unknown):input is ProcessedImageTarget {
  if(!input || typeof input!=='object')return false;
  const m=input as Partial<ProcessedImageTarget>;
  const p=m.properties;
  const res=m.resources;
  return m.name===BASIRA_LAB_PROCESSED_TARGET_NAME &&
    m.type==='PLANAR' &&
    m.imagePath===BASIRA_LAB_LUMINANCE_PATH &&
    validFinite(m.created) && (m.created??0)>0 &&
    !!p && !!res &&
    [p.top,p.left,p.width,p.height,p.originalWidth,p.originalHeight].every(validFinite) &&
    (p.width??0)>0 && (p.height??0)>0 &&
    (p.originalWidth??0)>=(p.width??0) && (p.originalHeight??0)>=(p.height??0) &&
    typeof p.isRotated==='boolean' &&
    res.luminanceImage==='basira-lab-entrance_luminance.png' &&
    res.originalImage==='basira-lab-entrance_original.png' &&
    res.croppedImage==='basira-lab-entrance_cropped.png';
}

/** Fail before requesting camera if the processed grayscale target cannot load. */
export async function fetchApprovedImageTarget(
  fetcher:typeof fetch,
):Promise<ProcessedImageTarget> {
  const response=await fetcher('/ar/targets/basira-lab-entrance.json',{cache:'no-store'});
  if(!response.ok)throw new Error('PROCESSED_MARKER_ASSETS_REQUIRED');
  const json:unknown=await response.json();
  if(!isProcessedBasiraImageTarget(json))throw new Error('PROCESSED_MARKER_ASSETS_REQUIRED');
  const image=await fetcher(BASIRA_LAB_LUMINANCE_PATH,{method:'GET',cache:'no-store'});
  if(!image.ok || !(image.headers.get('content-type')??'').startsWith('image/png')) {
    throw new Error('PROCESSED_MARKER_ASSETS_REQUIRED');
  }
  return json;
}
