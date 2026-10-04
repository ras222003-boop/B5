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
  return <Layout><div className="container space-y-5 py-10 text-stone-100"><Link href="/navigation/permissions" className="text-amber-200 underline">Permissions</Link><h1 className="text-3xl font-bold">{t.title}</h1><p>{t.hint}</p><ul className="grid gap-3 sm:grid-cols-2">{entries.map(([name,status])=><li key={name} className="rounded-xl border border-amber-200/25 bg-stone-900 p-4"><strong>{name}</strong><p className="text-amber-200">{t.statuses[status]}</p></li>)}</ul></div></Layout>;
}
