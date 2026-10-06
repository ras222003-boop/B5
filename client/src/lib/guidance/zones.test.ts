import { describe, expect, it } from 'vitest';
import type { NavigationZone } from '@shared/navigation';
import { zoneAnnouncement, zoneAt } from './zones';

const zone = (id: string, minX: number, maxX: number): NavigationZone => ({
  id, buildingId: 'building', floorId: 'floor', name: id === 'inner' ? 'ممر القاعات' : 'الطابق الشرقي', zoneType: 'CORRIDOR',
  minX, maxX, minY: 0, maxY: 10, guidanceHint: id === 'inner' ? 'استمر بمحاذاة الجدار الأيمن.' : null,
  accessibilityNote: null, createdBy: null, createdAt: '', updatedAt: '',
});

describe('navigation zones', () => {
  it('selects the smallest matching zone on the same floor', () => {
    expect(zoneAt([zone('outer', 0, 20), zone('inner', 5, 10)], { floorId: 'floor', x: 6, y: 4 })?.id).toBe('inner');
    expect(zoneAt([zone('outer', 0, 20)], { floorId: 'other-floor', x: 6, y: 4 })).toBeNull();
  });

  it('includes a saved guidance hint in the spoken zone announcement', () => {
    expect(zoneAnnouncement(zone('inner', 5, 10), 'ar')).toContain('استمر بمحاذاة الجدار الأيمن');
  });
});
