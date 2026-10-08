import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type * as GeoJSON from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoDistance, gpsQuality, type GeoFix } from '@/lib/guidance/outdoor';
import { acceptGeoFix, fetchWalkingRoute, routeSplitIndex, type GeoPoint, type WalkingRoute } from '@/lib/guidance/geographicRoute';
import type { OutdoorTrailSegment } from '@/lib/guidance/walkRecording';

type Props = { target?: (GeoPoint & { name: string }) | null; onPick?: (point: GeoPoint) => void; onFix?: (fix: GeoFix) => void; className?: string; heading?: string; autoRoute?: boolean; autoTrack?: boolean; observedSegments?: OutdoorTrailSegment[] };
const noObservedSegments: OutdoorTrailSegment[] = [];
const start = { latitude: 24.7136, longitude: 46.6753 };
maplibregl.setWorkerUrl(workerUrl);
const controls = 'min-h-11 rounded-lg border border-amber-300/70 bg-stone-950 px-3 py-2 font-bold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300';
const point = (location: GeoPoint): GeoJSON.Position => [location.longitude, location.latitude];
const feature = (geometry: GeoJSON.Geometry): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] });
const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });
function accuracyRing(fix: GeoFix): GeoJSON.Polygon {
  const latRadius = fix.accuracy / 111_320;
  const lonRadius = fix.accuracy / (111_320 * Math.max(.1, Math.cos(fix.latitude * Math.PI / 180)));
  const ring: GeoJSON.Position[] = Array.from({ length: 65 }, (_, index) => {
    const angle = index * Math.PI / 32;
    return [fix.longitude + Math.cos(angle) * lonRadius, fix.latitude + Math.sin(angle) * latRadius];
  });
  return { type: 'Polygon', coordinates: [ring] };
}
function setSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

export default function GeographicMap({ target, onPick, onFix, className = '', heading = 'خارطة بصيرة', autoRoute = false, autoTrack = false, observedSegments = noObservedSegments }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<MapLibreMap | null>(null), pickRef = useRef(onPick), fixRef = useRef(onFix);
  const lastGood = useRef<GeoFix | null>(null), watch = useRef<number | null>(null), watchOwner = useRef<'AUTO'|'MANUAL'|null>(null), lastRouteStart = useRef<GeoFix | null>(null), routeController = useRef<AbortController | null>(null), routeTargetKey = useRef('');
  const [fix, setFix] = useState<GeoFix | null>(null), [route, setRoute] = useState<WalkingRoute | null>(null), [routeError, setRouteError] = useState('');
  const [mapError, setMapError] = useState(''), [ready, setReady] = useState(false), [tilesReady, setTilesReady] = useState(false), [tracking, setTracking] = useState(false), [permissionError, setPermissionError] = useState(''), [expanded, setExpanded] = useState(false), [tick, setTick] = useState(Date.now()), [routeEnabled, setRouteEnabled] = useState(autoRoute);
  pickRef.current = onPick; fixRef.current = onFix;

  useEffect(() => {
    if (!container.current) return;
    let instance: MapLibreMap;
    try {
      instance = new maplibregl.Map({ container: container.current, style: 'https://tiles.openfreemap.org/styles/liberty', center: [start.longitude, start.latitude], zoom: 15, attributionControl: {} });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left');
      instance.on('load', () => {
        for (const id of ['accuracy', 'route-complete', 'route-remaining', 'observed-trail', 'position', 'destination', 'heading']) instance.addSource(id, { type: 'geojson', data: empty() });
        instance.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#075985', 'fill-opacity': .18 } });
        instance.addLayer({ id: 'accuracy-border', type: 'line', source: 'accuracy', paint: { 'line-color': '#075985', 'line-width': 2, 'line-dasharray': [2, 2] } });
        instance.addLayer({ id: 'route-complete-line', type: 'line', source: 'route-complete', paint: { 'line-color': '#065f46', 'line-width': 8, 'line-dasharray': [1, 1] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        instance.addLayer({ id: 'route-remaining-outline', type: 'line', source: 'route-remaining', paint: { 'line-color': '#1c1917', 'line-width': 12 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        instance.addLayer({ id: 'route-remaining-line', type: 'line', source: 'route-remaining', paint: { 'line-color': '#fbbf24', 'line-width': 7 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        instance.addLayer({ id: 'observed-trail-line', type: 'line', source: 'observed-trail', paint: { 'line-color': '#d8b4fe', 'line-width': 5, 'line-dasharray': [2, 2] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        instance.addLayer({ id: 'position-dot', type: 'circle', source: 'position', paint: { 'circle-color': '#0284c7', 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
        instance.addLayer({ id: 'heading-arrow', type: 'symbol', source: 'heading', layout: { 'text-field': '▲', 'text-size': 25, 'text-rotate': ['get', 'heading'], 'text-allow-overlap': true }, paint: { 'text-color': '#075985', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
        instance.addLayer({ id: 'destination-dot', type: 'circle', source: 'destination', paint: { 'circle-color': '#be123c', 'circle-radius': 10, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
        setReady(true);
        setMapError('');
      });
      instance.on('idle', () => { if (instance.areTilesLoaded()) setTilesReady(true); });
      instance.on('error', event => { if (!instance.isStyleLoaded()) setMapError('تعذر تحميل الخريطة الآن.'); });
      instance.on('click', event => pickRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    } catch { setMapError('تعذر تحميل الخريطة الآن.'); return; }
    return () => { instance.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    setSource(instance, 'position', fix ? feature({ type: 'Point', coordinates: point(fix) }) : empty());
    setSource(instance, 'accuracy', fix ? feature(accuracyRing(fix)) : empty());
    setSource(instance, 'heading', fix?.heading != null ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { heading: fix.heading }, geometry: { type: 'Point', coordinates: point(fix) } }] } : empty());
    setSource(instance, 'destination', target ? feature({ type: 'Point', coordinates: point(target) }) : empty());
    if (target && fix) {
      const bounds = new maplibregl.LngLatBounds(point(fix) as [number, number], point(target) as [number, number]);
      instance.fitBounds(bounds, { padding: 65, maxZoom: 17, duration: 400 });
    } else if (target) instance.flyTo({ center: point(target) as [number, number], zoom: 16 });
    else if (fix) instance.flyTo({ center: point(fix) as [number, number], zoom: 17 });
  }, [ready, target?.latitude, target?.longitude, Boolean(fix)]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const split = route && fix ? routeSplitIndex(route, fix) : 0;
    const completed = route?.points.slice(0, Math.max(2, split + 1)) ?? [];
    const remaining = route?.points.slice(split) ?? [];
    setSource(instance, 'route-complete', route && split > 0 ? feature({ type: 'LineString', coordinates: completed.map(point) }) : empty());
    setSource(instance, 'route-remaining', remaining.length >= 2 ? feature({ type: 'LineString', coordinates: remaining.map(point) }) : empty());
    if (fix) {
      setSource(instance, 'position', feature({ type: 'Point', coordinates: point(fix) }));
      setSource(instance, 'accuracy', feature(accuracyRing(fix)));
      setSource(instance, 'heading', fix.heading != null ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { heading: fix.heading }, geometry: { type: 'Point', coordinates: point(fix) } }] } : empty());
    }
  }, [ready, fix, route]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const features: GeoJSON.Feature[] = observedSegments.filter(segment => segment.points.length > 1).map(segment => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment.points.map(point) },
    }));
    setSource(map.current, 'observed-trail', { type: 'FeatureCollection', features });
  }, [ready, observedSegments]);

  useEffect(() => {
    const targetKey = target ? `${target.latitude}:${target.longitude}` : '';
    if (targetKey !== routeTargetKey.current) { routeController.current?.abort(); routeController.current = null; routeTargetKey.current = targetKey; lastRouteStart.current = null; setRoute(null); setRouteEnabled(autoRoute); }
    if (!routeEnabled || !target || !fix || gpsQuality(fix) === 'LOW' || gpsQuality(fix) === 'LOST') return;
    if (lastRouteStart.current && geoDistance(lastRouteStart.current, fix) < 50) return;
    routeController.current?.abort();
    const controller = new AbortController(); routeController.current = controller;
    lastRouteStart.current = fix; setRouteError('');
    void fetchWalkingRoute(fix, target, controller.signal).then(value => { if (!controller.signal.aborted) setRoute(value); }).catch(error => { if (error?.name !== 'AbortError') { setRoute(null); setRouteError('تعذر حساب طريق المشي الآن.'); } });
  }, [target?.latitude, target?.longitude, fix?.latitude, fix?.longitude, routeEnabled, autoRoute]);
  useEffect(() => () => routeController.current?.abort(), []);
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 5000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; watchOwner.current = null; }, []);
  useEffect(() => { if (expanded) { const timer = window.setTimeout(() => map.current?.resize(), 50); return () => window.clearTimeout(timer); } map.current?.resize(); }, [expanded]);
  const quality = gpsQuality(fix, tick);
  const observedPointCount = observedSegments.reduce((count, segment) => count + segment.points.length, 0);
  const hasObservedLine = observedSegments.some(segment => segment.points.length > 1);
  const beginTracking = (owner:'AUTO'|'MANUAL'='MANUAL') => {
    if (!navigator.geolocation) { setPermissionError('خدمة الموقع غير متاحة في هذا الجهاز.'); return; }
    if (watch.current !== null) return;
    setPermissionError('');
    try {
      const id = navigator.geolocation.watchPosition(position => {
        if (watch.current !== id) return;
        const next: GeoFix = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null, timestamp: position.timestamp };
        if (!acceptGeoFix(next, lastGood.current)) return;
        lastGood.current = next; setFix(next); fixRef.current?.(next);
      }, error => { if (watch.current !== id) return; setPermissionError(error.code === 1 ? 'رُفض إذن الموقع. يمكنك متابعة استعراض الخريطة دون موقعك.' : 'تعذر تحديث GPS.'); setTracking(false); navigator.geolocation.clearWatch(id); watch.current = null; watchOwner.current = null; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      watch.current = id; watchOwner.current = owner; setTracking(true);
    } catch { setPermissionError('تعذر بدء متابعة GPS.'); setTracking(false); }
  };
  const stopTracking = () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; watchOwner.current = null; setTracking(false); };
  useEffect(() => {
    if (autoTrack) beginTracking('AUTO');
    else if (watchOwner.current === 'AUTO') stopTracking();
  }, [autoTrack]);
  const recenter = () => { const location = fix ?? target ?? start; map.current?.flyTo({ center: point(location) as [number, number], zoom: 17 }); };
  const remainingMeters = route && fix ? Math.max(0, Math.round(route.points.slice(routeSplitIndex(route, fix)).reduce((sum, current, index, points) => index ? sum + geoDistance(points[index - 1], current) : 0, 0))) : null;
  return <section aria-label={heading} className={`rounded-2xl border border-amber-200/30 bg-stone-900 p-3 text-stone-100 ${expanded ? 'fixed inset-2 z-50 flex flex-col' : ''} ${className}`}>
    <div className="relative z-10 mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-black">{heading}</h2><div className="flex flex-wrap gap-2"><button type="button" className={controls} onClick={tracking ? stopTracking : () => beginTracking('MANUAL')}>{tracking ? 'إيقاف GPS' : 'تحديد موقعي'}</button><button type="button" className={controls} onClick={recenter}>إعادة التمركز</button>{target&&fix&&!routeEnabled&&<button type="button" className={controls} onClick={()=>setRouteEnabled(true)}>ابدأ توجيه المشي</button>}<button type="button" className={controls} onClick={() => setExpanded(!expanded)}>{expanded ? 'العودة إلى الإرشاد' : 'ملء الشاشة'}</button></div></div>
    <div ref={container} role="region" aria-label={`خريطة جغرافية تفاعلية تعرض الطرق والمباني والوجهة والموقع وطريق المشي المخطط عند توفره${hasObservedLine?'، وأثر المشي المرصود التقريبي':''}`} data-testid="geographic-map" data-map-ready={ready} data-tiles-ready={tilesReady} data-route-points={route?.points.length ?? 0} data-observed-points={observedPointCount} data-gps-quality={quality} data-position={fix ? `${fix.latitude},${fix.longitude}` : ''} className={`relative z-0 w-full overflow-hidden rounded-xl bg-stone-800 ${expanded ? 'min-h-0 flex-1' : 'h-[380px] sm:h-[480px]'}`} />
    {mapError && <p role="alert" className="mt-2 text-amber-200">{mapError}</p>}
    {permissionError && <p role="alert" className="mt-2 text-amber-200">{permissionError}</p>}
    <p className="mt-2" role="status">جودة GPS: {quality === 'HIGH' ? 'مرتفعة' : quality === 'MEDIUM' ? 'متوسطة' : quality === 'LOW' ? 'منخفضة' : 'مفقودة'}{fix ? ` · نطاق الدقة ${Math.round(fix.accuracy)} م` : ''}{target ? ` · الوجهة: ${target.name}` : ''}{remainingMeters !== null ? ` · المتبقي نحو ${remainingMeters} م` : ''}</p>
    {route ? <p className="text-sm text-stone-300">الخط الذهبي المتصل: المتبقي · الأخضر المتقطع: المنجز. مسار مشي من شبكة OpenStreetMap؛ تحقق من المعابر والعوائق.</p> : <p className="text-sm text-stone-300">اختر نقطة على الخريطة وحدد موقعك لعرض طريق مشي. لا يُرسم خط مباشر على أنه طريق.</p>}
    {hasObservedLine&&<p className="text-sm text-stone-300">البنفسجي المتقطع: أثر المشي المرصود تقريبيًا من GPS. تظهر فجوات حين لا تكفي دقة الموقع؛ هذا الأثر مختلف عن طريق المشي المخطط.</p>}
    {routeError && <p role="alert" className="text-amber-200">{routeError}</p>}
    <p className="text-xs text-stone-400">© OpenStreetMap contributors · OpenFreeMap. تُرسل نقطتا البداية والوجهة إلى خدمة حساب طريق المشي عند البدء، وقد تحفظهما في سجل الخدمة. <a className="underline" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">صحح بيانات الخريطة</a></p>
  </section>;
}
