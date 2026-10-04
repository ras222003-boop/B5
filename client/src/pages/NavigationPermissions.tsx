import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useMessages } from '@/i18n';
import { navigationMessages } from '@/i18n/locales/navigation';
import { permissionService, type NavigationPermission, type PermissionState } from '@/lib/permissionService';

const permissions: NavigationPermission[]=['location','camera','microphone','bluetooth','motion','notifications'];

export default function NavigationPermissions() {
  const t=useMessages(navigationMessages);
  const [states,setStates]=useState<Partial<Record<NavigationPermission,PermissionState>>>({});
  useEffect(()=>{let active=true;Promise.all(permissions.map(async key=>[key,await permissionService.status(key)] as const)).then(entries=>{if(active)setStates(Object.fromEntries(entries));});return()=>{active=false;};},[]);
  const labels={location:t.permissionLocation,camera:t.permissionCamera,microphone:t.permissionMicrophone,bluetooth:t.permissionBluetooth,motion:t.permissionMotion,notifications:t.permissionNotifications};
  const reasons={location:t.locationReason,camera:t.cameraReason,microphone:t.microphoneReason,bluetooth:t.bluetoothReason,motion:t.motionReason,notifications:t.notificationsReason};
  const statusLabels={not_requested:t.notRequested,allowed:t.allowed,denied:t.denied,device_settings:t.deviceSettings,unavailable:t.unavailable};
  return <Layout><div className="container space-y-6 py-10 text-stone-100"><Link href="/navigation" className="text-amber-300 underline">{t.title}</Link><h1 className="text-3xl font-black">{t.permissions}</h1><section aria-labelledby="permissions-title"><h2 id="permissions-title" className="text-xl font-bold">{t.permissionTitle}</h2><p className="mt-2 text-stone-300">{t.permissionHint}</p><ul className="mt-5 grid gap-4 md:grid-cols-2">{permissions.map(key=><li key={key} className="rounded-2xl border border-amber-200/20 bg-stone-900/80 p-5"><h3 className="text-lg font-bold">{labels[key]}</h3><p className="mt-2 text-stone-300">{reasons[key]}</p><p className="mt-3 text-amber-200">{t.permissionStatus}: {statusLabels[states[key]??'not_requested']}</p></li>)}</ul></section></div></Layout>;
}
