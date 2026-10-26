/** Controlled perturbations of qualified real photos with ORACLE COCO masks, not predicted-mask accuracy. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(process.argv[2]),origin='http://127.0.0.1:4350',plan=JSON.parse(await readFile(resolve(root,'mask-plan.json'))),rows=plan.rows.filter(r=>r.split==='development').slice(0,2);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const c=await browser.newContext({serviceWorkers:'block'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const p=await c.newPage();await p.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded'});const results=[];
 for(const row of rows){const g=row.objects[0],rgb=await readFile(row.image),mask=await readFile(resolve(root,g.mask));
  results.push(...await p.evaluate(async({rgb,mask,g,id})=>{
   const {sampleColorFrame,analyzeObjectColor}=await import('/src/lib/vision/objectColors.ts');
   const im=new Image();im.src='data:image/png;base64,'+rgb;await im.decode();const canvas=new OffscreenCanvas(im.width,im.height);canvas.getContext('2d').drawImage(im,0,0);
   const original=sampleColorFrame(canvas,1,id);const m=new Image();m.src='data:image/png;base64,'+mask;await m.decode();const mc=new OffscreenCanvas(m.width,m.height);mc.getContext('2d').drawImage(m,0,0);const md=mc.getContext('2d').getImageData(0,0,m.width,m.height).data,bits=Uint8Array.from({length:m.width*m.height},(_,i)=>md[4*i]>0?1:0);
   const b=g.box,d={id:'reference',cocoClass:g.class,boundingBox:{x:b[0],y:b[1],width:b[2],height:b[3]}};
   const results=[];
   for(const variant of ['original','dark','clipped-foreground','brown-background']){
    const data=new Uint8ClampedArray(original.data);for(let i=0;i<bits.length;i++)for(let channel=0;channel<3;channel++){
      if(variant==='dark')data[4*i+channel]=Math.round(data[4*i+channel]*.02);
      if(variant==='clipped-foreground'&&bits[i])data[4*i+channel]=255;
      if(variant==='brown-background'&&!bits[i])data[4*i+channel]=[100,60,20][channel];
    }
    const frame={...original,data,frameId:id+'-'+variant},oracle={objectId:'reference',frameId:frame.frameId,width:frame.width,height:frame.height,data:bits,alignmentVerified:true,source:'INSTANCE_SEGMENTATION'};
    const before=analyzeObjectColor(frame,d,[]),after=analyzeObjectColor(frame,d,[],oracle);
    if(['dark','clipped-foreground'].includes(variant)&&after.name!==null)throw Error('Extreme visibility must abstain');
    results.push({imageId:id,variant,before,oracleMaskDiagnostic:after,expectedColour:null});
   }
   return results;
  },{rgb:rgb.toString('base64'),mask:mask.toString('base64'),g,id:row.id}));
 }
 const out={scope:'ORACLE_MASK_CONTROLLED_PHOTO_PERTURBATIONS_NOT_NATURAL_LIGHTING_OR_MODEL_MASK_QUALIFICATION',images:rows.length,cases:results.length,results,humanColourAccuracy:null,productMasksEnabled:false};
 await writeFile(resolve(root,'colour-stress.json'),JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({cases:out.cases,forcedDarkAndClippedAbstentionPassed:true}));
}finally{await browser.close();}
