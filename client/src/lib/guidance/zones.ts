import type { NavigationZone } from '@shared/navigation';

export type ZonePosition = { floorId: string | null; x: number | null; y: number | null };

const area = (zone: NavigationZone) => (zone.maxX - zone.minX) * (zone.maxY - zone.minY);

/** Returns the most specific saved zone containing a trusted local coordinate. */
export function zoneAt(zones: NavigationZone[] | undefined, position: ZonePosition | null): NavigationZone | null {
  if (!zones?.length || !position?.floorId || position.x === null || position.y === null) return null;
  return zones
    .filter(zone => zone.floorId === position.floorId && position.x! >= zone.minX && position.x! <= zone.maxX && position.y! >= zone.minY && position.y! <= zone.maxY)
    .sort((left, right) => area(left) - area(right))[0] ?? null;
}

export function zoneAnnouncement(zone: NavigationZone, language: 'ar' | 'en' | 'zh-CN' = 'ar') {
  const hint = zone.guidanceHint?.trim();
  if (language === 'en') return `You have entered ${zone.name}.${hint ? ` ${hint}` : ''}`;
  if (language === 'zh-CN') return `您已进入${zone.name}。${hint ?? ''}`;
  return `دخلت منطقة ${zone.name}.${hint ? ` ${hint}` : ''}`;
}
