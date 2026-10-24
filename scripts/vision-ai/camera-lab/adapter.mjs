/** Research-only tensor adapter. Never imported by Basira production vision. */
export const LABELS = Object.freeze({2301:'درج صاعد',2302:'درج هابط',2303:'درج — الاتجاه غير مؤكد',2304:'سلم كهربائي'});
const check = (condition, message) => { if (!condition) throw new Error(message); };
const finite = values => values.every(Number.isFinite);
const probability = (value, fallback) => { const number=Number(value ?? fallback); check(Number.isFinite(number)&&number>=0&&number<=1,'Invalid research threshold'); return number; };
export function normalizeEntry(entry) {
  check(entry?.researchOnly===true && entry?.productionEnabled===false,'Research-only, production-disabled entry required');
  const shape=entry.input?.shape;
  check(Array.isArray(shape)&&shape.length===4&&['batch',1,null].includes(shape[0])&&shape[1]===3&&Number.isInteger(shape[2])&&shape[2]===shape[3]&&shape[2]>=64&&shape[2]<=512,'Expected one RGB NCHW square input');
  check(entry.input.name==='image'&&entry.input.color==='RGB'&&JSON.stringify(entry.input.range)==='[0,1]','Unsupported image input contract');
  const named=entry.outputs;
  const outputs=Array.isArray(named)?named:(named&&Object.keys(named).length===3&&named.presence==='presence_logits'&&named.direction==='direction_logits'&&named.box==='box_xywh'?['presence_logits','direction_logits','box_xywh']:null);
  check(Array.isArray(outputs),'Explicit output names required');
  const separated=outputs.includes('presence_logits');
  const expected=separated?['presence_logits','direction_logits','box_xywh']:['class_logits','box_xywh'];
  check(JSON.stringify(outputs)===JSON.stringify(expected),'Unsupported research output schema');
  if(!separated)check(JSON.stringify(entry.classIds)==='[null,2301,2302,2303,2304]','V2 class mapping mismatch');
  const preprocessing=entry.preprocessing ?? (entry.input.resize?{mode:entry.input.resize,padValue:Number(entry.input.padValue)/255}:(!separated?{mode:'stretch',padValue:127/255}:null));
  check(preprocessing&&['stretch','letterbox'].includes(preprocessing.mode),'Explicit supported preprocessing required');
  if(separated)check(preprocessing.mode==='letterbox'&&Math.abs(Number(preprocessing.padValue)-127/255)<1e-6,'V3 requires explicit gray letterbox preprocessing');
  check(/^[a-f0-9]{64}$/i.test(entry.sha256??''),'Model SHA-256 required');
  const thresholds=entry.thresholds??{};
  return {schemaVersion:1,name:String(entry.name??'نموذج بحثي'),adapter:separated?'separated-v3':'single-v2',
    input:{name:'image',shape:[1,3,shape[2],shape[3]],color:'RGB',range:[0,1]},outputs:expected,
    preprocessing:{mode:preprocessing.mode,padValue:127/255},
    thresholds:{presence:probability(thresholds.presence??thresholds.presenceMin??entry.threshold,.5),
      directionConfidence:probability(thresholds.directionConfidence??thresholds.directionMin??thresholds.direction_confidence,.6),
      directionMargin:probability(thresholds.directionMargin??thresholds.direction_margin,.15)},
    sha256:entry.sha256.toLowerCase(),confidenceCalibrated:entry.confidenceCalibrated===true,
    realCameraEvaluation:String(entry.realCameraEvaluation??'not_performed'),researchOnly:true,productionEnabled:false};
}
export function softmax(values) {
  check(values.length>0&&finite(Array.from(values)),'Nonfinite model logits');
  const max=Math.max(...values),exp=Array.from(values,value=>Math.exp(value-max)),sum=exp.reduce((a,b)=>a+b,0);
  return exp.map(value=>value/sum);
}
function tensor(output,name,length) {
  const value=output[name];
  check(value&&Array.isArray(value.dims)&&value.dims.length===2&&value.dims[0]===1&&value.dims[1]===length&&value.data?.length===length,`Unexpected ${name} tensor shape`);
  const data=Array.from(value.data,Number);check(finite(data),`Nonfinite ${name}`);return data;
}
export function frameTransform(width,height,size,mode) {
  check(width>0&&height>0&&Number.isFinite(width)&&Number.isFinite(height),'Source dimensions missing');
  if(mode==='stretch')return{width,height,size,drawWidth:size,drawHeight:size,left:0,top:0};
  const scale=Math.min(size/width,size/height),drawWidth=Math.round(width*scale),drawHeight=Math.round(height*scale);
  return{width,height,size,drawWidth,drawHeight,left:Math.floor((size-drawWidth)/2),top:Math.floor((size-drawHeight)/2)};
}
export function originalBox(box,transform) {
  const [x,y,w,h]=box;check(finite(box)&&w>0&&h>0,'Invalid normalized box');
  const {size,left,top,drawWidth,drawHeight}=transform;
  const clip=value=>Math.max(0,Math.min(1,value));
  const x0=clip((x*size-left)/drawWidth),y0=clip((y*size-top)/drawHeight);
  const x1=clip(((x+w)*size-left)/drawWidth),y1=clip(((y+h)*size-top)/drawHeight);
  check(x1>x0&&y1>y0,'Model box lies outside source image');return[x0,y0,x1-x0,y1-y0];
}
export function decodeOutputs(output,contract,transform) {
  const box=tensor(output,'box_xywh',4);let classId,score,directionConfidence=null,directionAbstained=false;
  if(contract.adapter==='single-v2') {
    const p=softmax(tensor(output,'class_logits',5));score=1-p[0];
    if(score<contract.thresholds.presence)return{classId:null,score:p[0],box:null,directionAbstained:false};
    classId=[2301,2302,2303,2304][p.slice(1).indexOf(Math.max(...p.slice(1)))];
    directionAbstained=classId===2303;
  } else {
    const p=softmax(tensor(output,'presence_logits',3)),d=softmax(tensor(output,'direction_logits',3));
    const objectIndex=p[2]>p[1]?2:1;score=p[objectIndex];
    if(p[0]>=score||score<contract.thresholds.presence)return{classId:null,score:p[0],box:null,directionAbstained:false};
    if(objectIndex===2)classId=2304;
    else {
      const ranked=d.map((value,index)=>({value,index})).sort((a,b)=>b.value-a.value);directionConfidence=ranked[0].value;
      directionAbstained=ranked[0].index===2||directionConfidence<contract.thresholds.directionConfidence||ranked[0].value-ranked[1].value<contract.thresholds.directionMargin;
      classId=directionAbstained?2303:[2301,2302][ranked[0].index];
    }
  }
  return{classId,score,directionConfidence,directionAbstained,box:originalBox(box,transform)};
}
export function makeInput(source,contract,canvas) {
  const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
  const size=contract.input.shape[2],transform=frameTransform(width,height,size,contract.preprocessing.mode);
  canvas.width=canvas.height=size;const context=canvas.getContext('2d',{willReadFrequently:true});
  context.fillStyle='rgb(127,127,127)';context.fillRect(0,0,size,size);
  context.drawImage(source,transform.left,transform.top,transform.drawWidth,transform.drawHeight);
  const rgba=context.getImageData(0,0,size,size).data,data=new Float32Array(3*size*size);
  for(let i=0;i<size*size;i++)for(let c=0;c<3;c++)data[c*size*size+i]=rgba[i*4+c]/255;
  return{data,transform};
}
