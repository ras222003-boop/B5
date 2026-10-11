import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
import { loadSafetyFlags } from '@/lib/safetyFlags';
import type { SafetyFlags } from '@shared/safetyFlags';

type Status='Available'|'Unavailable'|'Permission required'|'Experimental'|'Native-only';
const copy={ar:{title:'قدرات الجهاز',hint:'فحص توفر تقني فقط؛ لا يؤكد دقة الكشف أو سلامة التنقل.',statuses:{Available:'متاحة',Unavailable:'غير متاحة','Permission required':'تحتاج إذنًا',Experimental:'تجريبية','Native-only':'تطبيق أصلي فقط'}},en:{title:'Device capabilities',hint:'Availability check only; it does not prove detection accuracy or safe navigation.',statuses:{Available:'Available',Unavailable:'Unavailable','Permission required':'Permission required',Experimental:'Experimental','Native-only':'Native-only'}},'zh-CN':{title:'设备能力',hint:'仅检查技术可用性，不代表检测准确或导航安全。',statuses:{Available:'可用',Unavailable:'不可用','Permission required':'需要权限',Experimental:'实验性','Native-only':'仅原生应用'} }} as const;
export default function NavigationCapabilities(){
  const {lang}=useI18n(),t=copy[lang]??copy.ar;
  const [flags,setFlags]=useState<SafetyFlags|null>(null);
  useEffect(()=>{let live=true;void loadSafetyFlags().then(value=>{if(live)setFlags(value);});return()=>{live=false;};},[]);
  const media=Boolean(navigator.mediaDevices?.getUserMedia),speech='speechSynthesis'in window,recognition='SpeechRecognition'in window||'webkitSpeechRecognition'in window;
  const entries:[string,Status][]=[
    ['Camera',media?'Permission required':'Unavailable'],['TTS',speech?'Available':'Unavailable'],['STT',recognition?'Permission required':'Unavailable'],
    ['Motion',typeof DeviceMotionEvent!=='undefined'?'Permission required':'Unavailable'],['Vibration','vibrate'in navigator?'Available':'Unavailable'],
    ['Web NFC','NDEFReader'in window?'Permission required':'Unavailable'],['Bluetooth','bluetooth'in navigator?'Permission required':'Unavailable'],
    ['Offline cache','caches'in window?'Available':'Unavailable'],['Vision detection',media?'Experimental':'Unavailable'],['OCR',media?'Experimental':'Unavailable'],
    ['Semantic segmentation',media?'Experimental':'Unavailable'],['Depth',flags?.metricDepth&&'BasiraNativeDepth'in window?'Experimental':'Native-only'],
    ['Native AR bridge','BasiraNativeAr'in window?'Experimental':'Native-only'],
  ];
  return <Layout><div className="container space-y-5 py-10 text-stone-100"><Link href="/navigation/permissions" className="text-amber-200 underline">Permissions</Link><h1 className="text-3xl font-bold">{t.title}</h1><p>{t.hint}</p>{import.meta.env.VITE_BASIRA_AR_LAB_ENABLED === 'true' && <section className="rounded-xl border border-amber-300/40 bg-stone-900 p-4" aria-label="8th Wall WebAR"><h2 className="mb-2 text-lg font-bold">{lang==='ar'?'مختبر بصيرة للواقع المعزز':lang==='zh-CN'?'Basira 增强现实实验室':'Basira augmented reality lab'}</h2><p className="mb-3 text-sm text-stone-200">{lang==='ar'?'التعرف على العلامات وتجارب الوجه والسماء داخل بصيرة. التجارب غير معتمدة للملاحة أو قياس الأمتار.':lang==='zh-CN'?'图像标记、人脸与天空实验；并非安全导航或测距工具。':'Image targets, face and sky trials within Basira. Not approved for navigation safety or meter measurement.'}</p><Link href="/navigation/ar-lab" className="inline-flex min-h-12 items-center rounded-lg border border-amber-300 px-4 py-2 font-bold text-amber-100">{lang==='ar'?'فتح مختبر 8th Wall':lang==='zh-CN'?'打开 8th Wall 实验室':'Open 8th Wall lab'}</Link></section>}<ul className="grid gap-3 sm:grid-cols-2">{entries.map(([name,status])=><li key={name} className="rounded-xl border border-amber-200/25 bg-stone-900 p-4"><strong>{name}</strong><p className="text-amber-200">{t.statuses[status]}</p></li>)}</ul></div></Layout>;
}
