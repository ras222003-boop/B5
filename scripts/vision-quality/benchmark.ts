/** Isolated, quota-accounted comparison on original synthetic fixtures only. */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {MysqlVisionQuotaStore,visionLimits} from '../../server/visionQuota';
import {descriptionPrompt,descriptionSystem,prepareDescriptionImage} from '../../server/visionDescribe';
import {fixtures,fixtureSvg} from './fixtures.mjs';

const args=new Set(process.argv.slice(2));
const live=args.has('--live');
const countFlag=process.argv.find(arg=>arg.startsWith('--cases='));
const requested=Number(countFlag?.slice('--cases='.length)??10);
const offset=Number(process.argv.find(arg=>arg.startsWith('--offset='))?.slice('--offset='.length)??0);
if(!Number.isInteger(requested)||requested<1||requested>10||!Number.isInteger(offset)||offset<0||offset+requested>20)throw new Error('Select at most 10 fixtures with --cases and --offset, so the paired run fits the default daily account quota.');
const inputRate=Number(process.argv.find(arg=>arg.startsWith('--input-rate='))?.slice('--input-rate='.length));
const outputRate=Number(process.argv.find(arg=>arg.startsWith('--output-rate='))?.slice('--output-rate='.length));
const hasRates=Number.isFinite(inputRate)&&inputRate>0&&Number.isFinite(outputRate)&&outputRate>0;
const afterTokens=Number(process.argv.find(arg=>arg.startsWith('--after-tokens='))?.slice('--after-tokens='.length)??1200);
if(!Number.isInteger(afterTokens)||afterTokens<1200||afterTokens>1800)throw new Error('--after-tokens must be 1200..1800');
const outputDir=path.resolve('scripts/vision-quality/output');
await mkdir(outputDir,{recursive:true});
const selected=fixtures.slice(offset,offset+requested);

for(const fixture of fixtures){
  await sharp(Buffer.from(fixtureSvg(fixture))).png().toFile(path.join(outputDir,`${fixture.id}.png`));
}
await writeFile(path.join(outputDir,'references.json'),JSON.stringify(fixtures.map(({id,kind,reference})=>({id,kind,reference})),null,2),'utf8');
if(!live){
  process.stdout.write(`Rendered ${fixtures.length} original test scenes. Use --live --cases=10 --offset=0 and then --offset=10 on another quota day to compare prompts.\n`);
  process.exit(0);
}

const userId=process.env.BASIRA_VISION_BENCHMARK_USER_ID;
const key=process.env.MANUS_API_KEY||process.env.BUILT_IN_FORGE_API_KEY;
if(!userId||!key||!process.env.DATABASE_URL)throw new Error('A test account id, DATABASE_URL and server-side Forge key are required. No paid call was made.');
const {pool}=await import('../../server/auth');
const [users]=await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT id FROM `user` WHERE id=? LIMIT 1',[userId]);
if(!users.length)throw new Error('The benchmark account does not exist. No paid call was made.');
const quota=new MysqlVisionQuotaStore(async()=>pool);
const url=`${(process.env.MANUS_API_URL||process.env.BUILT_IN_FORGE_API_URL||'https://forge.manus.ai').replace(/\/+$/,'')}/v1/chat/completions`;
const model=process.env.BASIRA_VISION_DESCRIPTION_MODEL||'gemini-3.1-pro-preview';
const baselineSystem=`You are Basira's visual description assistant for a blind Arabic speaker. Describe only what is visible in the supplied still image. Respond in clear Arabic. Identify the apparent setting only when supported by the image. Include relevant objects and relative positions, furniture, doors, windows, visible activities of people without identifying them, colors, shapes, readable signs and text, visible ground features, and relationships. If the image is blurred, dark, cropped, or ambiguous, explicitly say which details cannot be determined instead of guessing. Never infer what lies outside the frame. Never claim the path is safe, give movement commands, or infer metric distance or collision risk from the image.`;
const baselinePrompt='Give a structured, detailed description of as many reliably visible details as possible. Mention uncertainty for ambiguous details.';
const comparison=[];
try{
for(const fixture of selected){
  const png=await sharp(Buffer.from(fixtureSvg(fixture))).png().toBuffer();
  const image=await prepareDescriptionImage(`data:image/png;base64,${png.toString('base64')}`);
  for(const variant of ['before','after'] as const){
    const release=await quota.reserve(userId,visionLimits());
    const started=Date.now();
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({model,messages:[{role:'system',content:variant==='before'?baselineSystem:descriptionSystem},{role:'user',content:[{type:'text',text:variant==='before'?baselinePrompt:descriptionPrompt('detailed')},{type:'image_url',image_url:{url:image,detail:'high'}}]}],max_tokens:variant==='before'?1200:afterTokens}),
        signal:AbortSignal.timeout(60_000)});
      if(!response.ok)throw new Error(`Forge returned HTTP ${response.status}; no response body or key was logged.`);
      const data=await response.json() as {model?:string;choices?:Array<{message?:{content?:string|Array<{type:string;text?:string}>}}> ;usage?:{prompt_tokens?:number;completion_tokens?:number}};
      const promptTokens=data.usage?.prompt_tokens??null,completionTokens=data.usage?.completion_tokens??null;
      const content=data.choices?.[0]?.message?.content;
      const description=typeof content==='string'?content:Array.isArray(content)?content.filter(part=>part.type==='text').map(part=>part.text??'').join(' '):'';
      comparison.push({id:fixture.id,variant,maxTokens:variant==='before'?1200:afterTokens,modelRequested:model,modelReturned:data.model??null,latencyMs:Date.now()-started,promptTokens,completionTokens,
        estimatedUsd:hasRates&&promptTokens!==null&&completionTokens!==null?(promptTokens*inputRate+completionTokens*outputRate)/1_000_000:null,
        description});
      await writeFile(path.join(outputDir,`comparison-${offset}-${requested}-${afterTokens}.json`),JSON.stringify(comparison,null,2),'utf8');
      process.stdout.write(`${fixture.id} ${variant}: ${Date.now()-started} ms, ${data.usage?.prompt_tokens??'?'} input / ${data.usage?.completion_tokens??'?'} output tokens\n`);
    }finally{await release();}
  }
}
const header='id,variant,object_accuracy_0_2,position_accuracy_0_2,detail_coverage_0_2,text_accuracy_0_2,hallucinations_count,arabic_clarity_0_2,reviewer_notes';
await writeFile(path.join(outputDir,`human-review-${offset}-${requested}-${afterTokens}.csv`),[header,...comparison.map(row=>`${row.id},${row.variant},,,,,,,`)].join('\n'),'utf8');
const average=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const summary=['# قياس Forge لمشاهد الاختبار التخطيطية','',`عدد الصور المقارنة: ${selected.length}. النموذج المطلوب: ${model}. حد النسخة الجديدة: ${afterTokens}.`,'',
  '| النسخة | متوسط زمن النموذج (مللي ثانية) | متوسط رموز الإدخال | متوسط رموز الإخراج | متوسط التكلفة التقديرية (دولار) |','|---|---:|---:|---:|---:|',
  ...(['before','after'] as const).map(variant=>{const rows=comparison.filter(row=>row.variant===variant);const mean=(field:'latencyMs'|'promptTokens'|'completionTokens'|'estimatedUsd')=>{const value=average(rows.map(row=>row[field]).filter((value):value is number=>typeof value==='number'));return value===null?'غير متاح':value.toFixed(field==='estimatedUsd'?6:1);};return `| ${variant} | ${mean('latencyMs')} | ${mean('promptTokens')} | ${mean('completionTokens')} | ${mean('estimatedUsd')} |`;}),
  '',`النموذج الذي أعاده Forge: ${[...new Set(comparison.map(row=>row.modelReturned??'غير مُعلن'))].join('، ')}.`,
  'التكلفة تقدير بسعري الإدخال والإخراج الممررين إلى السكربت، وليست فاتورة Forge. درجات الجودة تتطلب مراجعة بشرية للصور والمخرجات في human-review CSV.'];
await writeFile(path.join(outputDir,`summary-${offset}-${requested}-${afterTokens}.md`),summary.join('\n'),'utf8');
}finally{await pool.end();}
