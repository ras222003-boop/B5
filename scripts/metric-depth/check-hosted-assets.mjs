const origin=process.argv[2];
let base;
try{base=new URL(origin);}
catch{console.error('Provide a complete site origin URL');process.exit(2);}
if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))){
  console.error('Usage: node scripts/metric-depth/check-hosted-assets.mjs https://your-basira-host');
  process.exit(2);
}
const prefix='/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/';
const model=[{path:prefix+'parts.json',type:'application/json',size:null},
  ...Array.from({length:6},(_,i)=>({path:prefix+`model_fp32.part-${i}.bin`,type:'application/octet-stream',size:i<5?16*1024*1024:15054335}))];
const wasm=[
  {path:'/vision/onnx/ort-wasm-simd-threaded.wasm',type:'application/wasm',size:11133407},
  {path:'/vision/onnx/ort-wasm-simd-threaded.mjs',type:'application/javascript',size:20856},
  {path:'/vision/onnx/ort-wasm-simd-threaded.jsep.wasm',type:'application/wasm',size:21596019},
  {path:'/vision/onnx/ort-wasm-simd-threaded.jsep.mjs',type:'application/javascript',size:44484},
];
let failures=0;
for(const asset of [...model,...wasm]){
  const url=new URL(asset.path,base);
  let head,range;
  try{
    head=await fetch(url,{method:'HEAD',redirect:'manual'});
    range=await fetch(url,{headers:{Range:'bytes=0-255'},redirect:'manual'});
    const type=(head.headers.get('content-type')??'').split(';')[0].toLowerCase();
    const rangeType=(range.headers.get('content-type')??'').split(';')[0].toLowerCase();
    const rangeSize=Number(/\/(\d+)$/.exec(range.headers.get('content-range')??'')?.[1])||null;
    const size=Number(head.headers.get('content-length'))||rangeSize||null;
    const matchesType=value=>value===asset.type||(asset.type==='application/javascript'&&value==='text/javascript');
    const good=head.status===200&&range.status===206&&matchesType(type)&&matchesType(rangeType)&&
      (asset.size===null?size!==null:size===asset.size);
    console.log(`${good?'OK  ':'FAIL'} ${head.status}/${range.status} ${type||'no-type'} ${size??'no-size'} ${asset.path}`);
    if(!good)failures++;
  }catch(error){
    failures++;
    console.log(`FAIL network ${asset.path}: ${error instanceof Error?error.message:String(error)}`);
  }finally{await range?.body?.cancel().catch(()=>{});}
}
if(failures){console.error(`${failures} hosted assets failed validation`);process.exitCode=1;}
