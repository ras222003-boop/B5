import { geoDistance, gpsQuality, type GeoFix } from './outdoor';

export type GeoPoint = { latitude: number; longitude: number };
export type WalkingRoute = { points: GeoPoint[]; distanceMeters: number; provider: string };
let nextPublicRouteAt = 0;

/** The public walking router is queried only when a person starts a route, never for every fix. */
export async function fetchWalkingRoute(origin: GeoPoint, destination: GeoPoint, signal?: AbortSignal): Promise<WalkingRoute> {
  const slot = Math.max(Date.now(), nextPublicRouteAt);
  nextPublicRouteAt = slot + 1100;
  if (slot > Date.now()) await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, slot - Date.now());
    signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const response = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal });
  if (!response.ok) throw new Error('walking_route_unavailable');
  const data = await response.json() as { code?: string; routes?: Array<{ distance: number; geometry: { coordinates: number[][] } }> };
  const result = data.routes?.[0];
  if (data.code !== 'Ok' || !result || !Number.isFinite(result.distance)) throw new Error('walking_route_unavailable');
  const points = result.geometry.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
  if (points.length < 2 || points.some(point => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) throw new Error('walking_route_unavailable');
  return { points, distanceMeters: result.distance, provider: 'OSM pedestrian network' };
}

export function acceptGeoFix(next: GeoFix, previous: GeoFix | null): boolean {
  if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude) || Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180 || !Number.isFinite(next.accuracy) || next.accuracy < 0) return false;
  if (!previous) return true;
  const elapsed = (next.timestamp - previous.timestamp) / 1000;
  if (elapsed <= 0) return false;
  const distance = geoDistance(next, previous);
  if (distance > Math.max(100, elapsed * 18) + next.accuracy + previous.accuracy) return false;
  if (gpsQuality(next) === 'LOW' && gpsQuality(previous) !== 'LOW' && distance < next.accuracy) return false;
  return distance >= 3 || elapsed >= 5 || next.accuracy < previous.accuracy / 2;
}

export function routeSplitIndex(route: WalkingRoute, current: GeoPoint): number {
  let best = 0, distance = Infinity;
  route.points.forEach((point, index) => { const candidate = geoDistance(point, current); if (candidate < distance) { best = index; distance = candidate; } });
  return best;
}
