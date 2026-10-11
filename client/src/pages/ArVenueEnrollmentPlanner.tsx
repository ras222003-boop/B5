import {useState} from 'react';
import {Link} from 'wouter';
import Layout from '@/components/Layout';
import {useI18n} from '@/i18n';
import {navApi} from '@/lib/navigationApi';
import type {Building,Floor,Place} from '@shared/navigation';

const button='min-h-12 rounded-lg border border-amber-300 px-4 py-3 font-bold text-amber-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';

/**
 * Read-only planning workflow for public verified building data.
 * No camera or persistence; not a tool for claiming true physical location.
 */
export default function ArVenueEnrollmentPlanner(){
 const {lang}=useI18n();
 const s=(ar:string,en:string,zh:string)=>lang==='ar'?ar:lang==='zh-CN'?zh:en;
 const [buildings,setBuildings]=useState<Building[]>([]);
 const [selected,setSelected]=useState('');
 const [places,setPlaces]=useState<Place[]>([]);
 const [floors,setFloors]=useState<Floor[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [loaded,setLoaded]=useState(false);
 const approved=buildings.filter(b=>b.status==='ACTIVE'&&b.verificationStatus==='OFFICIAL');
 const activeBuilding=approved.find(b=>b.id===selected)??null;
 const candidates=places.filter(place=>place.isPublic&&place.verificationStatus==='OFFICIAL'&&
   place.buildingId===selected&&floors.some(f=>f.id===place.floorId&&f.buildingId===selected));

 const load=async()=>{
   setBusy(true);setError('');setSelected('');setPlaces([]);setFloors([]);
   try{
     const data=await navApi.buildings();
     setBuildings(data.buildings);setLoaded(true);
   }catch{
     setError(s('تعذر جلب المباني الرسمية. قد يلزم تسجيل الدخول أو إعادة المحاولة.','Could not read approved buildings. Sign in or retry.','无法获取已批准的建筑物。'));
   }finally{setBusy(false)}
 };
 const select=async(id:string)=>{
   setSelected(id);setPlaces([]);setFloors([]);setError('');
   if(!id)return;
   setBusy(true);
   try{
     const [list,floorList]=await Promise.all([navApi.places(id),navApi.floors(id)]);
     setPlaces(list.places);setFloors(floorList.floors);
   }catch{setError(s('فشل جلب الغرف والطوابق.','Could not load floors and rooms.','无法获取楼层与房间。'))}
   finally{setBusy(false)}
 };
 const exportDraft=()=>{
   if(!activeBuilding||!candidates.length)return;
   const data={status:'DRAFT_NOT_ENROLLED',verifiedByCamera:false,issuedAt:new Date().toISOString(),
     building:{id:activeBuilding.id,name:activeBuilding.name},
     rooms:candidates.map(p=>({
       placeId:p.id,placeName:p.name,floorId:p.floorId,
       suggestedTargetName:null,printedMarkerVerified:false,onSiteReviewRequired:true,
     })),
     note:'Research preparation only: no target metadata is generated and no location is verified'};
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='basira-venue-target-enrollment-DRAFT.json';a.click();
   window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <Layout><main className="container max-w-5xl space-y-5 py-8 text-stone-100" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>
   <Link href="/navigation/ar-lab" className="inline-block min-h-10 text-amber-300 underline">{s('عودة إلى مختبرات الواقع المعزز','Back to AR labs','返回 AR 实验室')}</Link>
   <h1 className="text-3xl font-black">{s('تجهيز معالم بصيرة للمؤسسات','Institutional landmark enrollment planner','机构标记准备规划')}</h1>
   <p className="rounded-xl border border-amber-300 bg-stone-900 p-4" role="note">{s(
     'تستعرض هذه الصفحة القاعات الرسمية الموجودة في قاعدة خرائط بصيرة فقط. لا تثبت موقع أي مستخدم، ولا تسجل علامات بالكاميرا، ولا تنشئ طرقًا جديدة. تسجيل العلامات يحتاج اعتماد المؤسسة واختبارها في الموقع.',
     'This read-only planner lists approved public rooms from Basira maps. It does not locate users, scan or register camera targets, or generate routes. Marker enrollment requires venue approval and on-site testing.',
     '此页面仅用于查看官方验证的公共地点；不会定位用户或生成路线。')}</p>
   <button type="button" className={button} onClick={()=>void load()} disabled={busy}>{s('جلب المباني الرسمية','Load approved buildings','加载官方建筑')}</button>
   {loaded&&approved.length===0&&<p role="status">{s('لا توجد مبانٍ رسمية مؤهلة متاحة لهذا الحساب.','No approved venues available to this account.','当前账户无已批准建筑。')}</p>}
   <label className="block max-w-lg font-bold">{s('اختر مبنى معتمدًا','Choose an official venue','选择已批准的建筑')}
     <select className="mt-2 block w-full rounded-lg bg-stone-900 p-3" value={selected} onChange={e=>void select(e.target.value)} disabled={!approved.length||busy}>
       <option value="">{s('اختر…','Select…','选择…')}</option>
       {approved.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
     </select>
   </label>
   {error&&<p role="alert" className="text-red-300">{error}</p>}
   {busy&&<p role="status">{s('جارٍ التحميل…','Loading…','加载中…')}</p>}
   {activeBuilding&&<section className="space-y-3 rounded-2xl border border-amber-200/25 bg-stone-900 p-5">
     <h2 className="text-xl font-bold">{s('الغرف العامة الموثقة','Verified public rooms','已验证公共房间')} — {activeBuilding.name}</h2>
     {candidates.length===0?<p>{s('لا توجد قاعات تستوفي متطلبات الاعتماد بعد.','No rooms pass approval criteria yet.','暂无符合要求的房间。')}</p>:
       <ul className="grid gap-3 sm:grid-cols-2">{candidates.map(p=><li key={p.id} className="rounded-lg border border-amber-300/25 p-3"><strong>{p.name}</strong><p className="text-sm text-stone-300">{floors.find(f=>f.id===p.floorId)?.name??''}</p><p className="text-xs text-amber-200">{s('بحاجة لتسجيل علامة واختبار ميداني','Needs marker enrollment and field testing','需要登记标记并实地测试')}</p></li>)}</ul>}
     <button type="button" className={button} onClick={exportDraft} disabled={!candidates.length}>{s('تصدير قائمة تسجيل أولية JSON','Export draft enrollment list (JSON)','导出登记草稿')}</button>
   </section>}
   <p className="text-sm text-stone-300">{s('ملفات التصدير تحفظ على جهازك، ولا تعني اعتماد العلامات أو استخدام الموقع في الملاحة.','Exports stay on your device and do not approve markers or enable physical navigation.','导出文件保存在本地，不代表已完成标记审核。')}</p>
 </main></Layout>
}
