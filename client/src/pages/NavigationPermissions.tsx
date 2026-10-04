import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { navigationMessages } from '@/i18n/locales/navigation';
import { permissionService, type NavigationPermission, type PermissionState } from '@/lib/permissionService';

const permissions: NavigationPermission[]=['location','camera','microphone','bluetooth','motion','nfc','notifications'];
const extra={
  ar:{nfc:'NFC',nfcReason:'قراءة علامة موقع معروفة على جهاز يدعم NFC، عند اختيارك تشغيلها.',optional:'اختيارية',impact:'إذا رفضت الصلاحية',control:'يمكن تغييرها من إعدادات المتصفح أو الجهاز. لا تُطلب عند فتح الصفحة.',effects:{location:'اختر المبنى ونقطة البداية يدويًا.',camera:'تبقى الخريطة والأزرار دون تحليل المشهد أو QR.',microphone:'استخدم الأزرار أو قارئ الشاشة.',bluetooth:'استخدم QR أو نقطة معروفة.',motion:'استخدم QR أو تأكيد الموقع يدويًا.',nfc:'استخدم QR أو عقدة معروفة.',notifications:'تبقى تنبيهات الجلسة داخل الصفحة.'}},
  en:{nfc:'NFC',nfcReason:'Read a known anchor on supported devices when you choose to use it.',optional:'Optional',impact:'If declined',control:'Change access in browser or device settings. This page does not request permissions.',effects:{location:'Choose the building and starting point manually.',camera:'Map and buttons remain, without scene analysis or QR.',microphone:'Use buttons or a screen reader.',bluetooth:'Use QR or a known anchor.',motion:'Use QR or confirm location manually.',nfc:'Use QR or a known node.',notifications:'In-page alerts remain.'}},
  'zh-CN':{nfc:'NFC',nfcReason:'选择使用时，在支持的设备上读取已知锚点。',optional:'可选',impact:'拒绝后',control:'可在浏览器或设备设置中更改；此页面不会请求权限。',effects:{location:'手动选择建筑和起点。',camera:'地图和按钮仍可用，但没有场景分析或 QR。',microphone:'使用按钮或屏幕阅读器。',bluetooth:'使用 QR 或已知锚点。',motion:'使用 QR 或手动确认位置。',nfc:'使用 QR 或已知节点。',notifications:'页面内提醒仍可用。'}},
} as const;

export default function NavigationPermissions() {
  const t=useMessages(navigationMessages);
  const {lang}=useI18n(),x=extra[lang]??extra.ar;
  const [states,setStates]=useState<Partial<Record<NavigationPermission,PermissionState>>>({});
  useEffect(()=>{let active=true;Promise.all(permissions.map(async key=>[key,await permissionService.status(key)] as const)).then(entries=>{if(active)setStates(Object.fromEntries(entries));});return()=>{active=false;};},[]);
  const labels={location:t.permissionLocation,camera:t.permissionCamera,microphone:t.permissionMicrophone,bluetooth:t.permissionBluetooth,motion:t.permissionMotion,nfc:x.nfc,notifications:t.permissionNotifications};
  const reasons={location:t.locationReason,camera:t.cameraReason,microphone:t.microphoneReason,bluetooth:t.bluetoothReason,motion:t.motionReason,nfc:x.nfcReason,notifications:t.notificationsReason};
  const statusLabels={not_requested:t.notRequested,allowed:t.allowed,denied:t.denied,device_settings:t.deviceSettings,unavailable:t.unavailable};
  return <Layout><div className="container space-y-6 py-10 text-stone-100"><Link href="/navigation" className="text-amber-300 underline">{t.title}</Link><h1 className="text-3xl font-black">{t.permissions}</h1><section aria-labelledby="permissions-title"><h2 id="permissions-title" className="text-xl font-bold">{t.permissionTitle}</h2><p className="mt-2 text-stone-300">{t.permissionHint}</p><ul className="mt-5 grid gap-4 md:grid-cols-2">{permissions.map(key=><li key={key} className="rounded-2xl border border-amber-200/20 bg-stone-900/80 p-5"><h3 className="text-lg font-bold">{labels[key]} · {x.optional}</h3><p className="mt-2 text-stone-300">{reasons[key]}</p><p className="mt-3 text-amber-200">{t.permissionStatus}: {statusLabels[states[key]??'not_requested']}</p><p className="mt-2">{x.impact}: {x.effects[key]}</p><p className="mt-2 text-sm text-stone-300">{x.control}</p></li>)}</ul></section><Link href="/navigation/capabilities" className="text-amber-200 underline">Device capabilities</Link></div></Layout>;
}
