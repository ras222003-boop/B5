import { useMemo, useState, type MouseEvent } from 'react';
import type { Floor, MapEdge, MapNode, NavigationZone } from '@shared/navigation';

const input = 'min-h-11 w-full rounded-xl border border-amber-200/35 bg-stone-950 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300';
const button = 'min-h-11 rounded-xl border border-amber-300/70 px-4 py-2 font-bold text-amber-100 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50';

type Mode = 'NODE' | 'EDGE' | 'ZONE';
type NodeType = MapNode['nodeType'];
type PathType = MapEdge['pathType'];
type ZoneType = NavigationZone['zoneType'];

type Props = {
  floors: Floor[];
  graph: { nodes: MapNode[]; edges: MapEdge[]; zones?: NavigationZone[] };
  busy: boolean;
  onCreateNode: (input: { floorId: string; x: number; y: number; nodeType: NodeType }) => Promise<void>;
  onCreateEdge: (input: { fromNodeId: string; toNodeId: string; distanceMeters: number; pathType: PathType }) => Promise<void>;
  onCreateZone: (input: Omit<NavigationZone, 'id' | 'buildingId' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDeleteZone: (zone: NavigationZone) => Promise<void>;
};

const rounded = (value: number) => Math.round(value * 10) / 10;
const distance = (a: MapNode, b: MapNode) => Math.max(0.1, rounded(Math.hypot(a.x - b.x, a.y - b.y)));

export default function NavigationMapEditor({ floors, graph, busy, onCreateNode, onCreateEdge, onCreateZone, onDeleteZone }: Props) {
  const [floorId, setFloorId] = useState('');
  const [mode, setMode] = useState<Mode>('NODE');
  const [nodeType, setNodeType] = useState<NodeType>('CORRIDOR');
  const [pathType, setPathType] = useState<PathType>('CORRIDOR');
  const [zoneType, setZoneType] = useState<ZoneType>('CORRIDOR');
  const [zoneName, setZoneName] = useState('');
  const [zoneHint, setZoneHint] = useState('');
  const [edgeStartId, setEdgeStartId] = useState<string | null>(null);
  const [zoneCorner, setZoneCorner] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState('اختر طابقًا ثم أضف نقاطًا أو ارسم مسارًا أو منطقة.');

  const selectedFloor = floorId || floors[0]?.id || '';
  const nodes = graph.nodes.filter(node => node.floorId === selectedFloor);
  const zones = (graph.zones ?? []).filter(zone => zone.floorId === selectedFloor);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const edges = graph.edges.filter(edge => nodeById.has(edge.fromNodeId) && nodeById.has(edge.toNodeId));
  const bounds = useMemo(() => {
    const xs = [...nodes.map(node => node.x), ...zones.flatMap(zone => [zone.minX, zone.maxX]), 0, 40];
    const ys = [...nodes.map(node => node.y), ...zones.flatMap(zone => [zone.minY, zone.maxY]), 0, 40];
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const padding = Math.max(4, Math.max(maxX - minX, maxY - minY) * 0.15);
    return { minX: minX - padding, minY: minY - padding, width: Math.max(20, maxX - minX + padding * 2), height: Math.max(20, maxY - minY + padding * 2) };
  }, [nodes, zones]);

  const pointFromEvent = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: rounded(bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.width),
      y: rounded(bounds.minY + ((event.clientY - rect.top) / rect.height) * bounds.height),
    };
  };

  const chooseMode = (value: Mode) => {
    setMode(value); setEdgeStartId(null); setZoneCorner(null);
    setNotice(value === 'NODE' ? 'انقر مساحة فارغة لإضافة نقطة.' : value === 'EDGE' ? 'انقر نقطة البداية ثم نقطة النهاية لرسم مسار.' : 'اكتب اسم المنطقة، ثم انقر زاويتين متقابلتين لرسمها.');
  };

  const handleCanvasClick = async (event: MouseEvent<SVGSVGElement>) => {
    if (!selectedFloor || busy) { setNotice('اختر طابقًا قبل الرسم.'); return; }
    const point = pointFromEvent(event);
    if (mode === 'NODE') {
      await onCreateNode({ floorId: selectedFloor, x: point.x, y: point.y, nodeType });
      setNotice(`حُفظت نقطة ${nodeType} عند ${point.x}، ${point.y}.`);
      return;
    }
    if (mode === 'ZONE') {
      if (!zoneName.trim()) { setNotice('اكتب اسم المنطقة قبل تحديدها على الخريطة.'); return; }
      if (!zoneCorner) { setZoneCorner(point); setNotice('حدد الزاوية المقابلة لإكمال المنطقة.'); return; }
      const minX = Math.min(zoneCorner.x, point.x), maxX = Math.max(zoneCorner.x, point.x);
      const minY = Math.min(zoneCorner.y, point.y), maxY = Math.max(zoneCorner.y, point.y);
      if (maxX - minX < 0.5 || maxY - minY < 0.5) { setNotice('يجب أن تكون المنطقة مرئية وليست نقطة واحدة.'); return; }
      await onCreateZone({ floorId: selectedFloor, name: zoneName.trim(), zoneType, minX, maxX, minY, maxY, guidanceHint: zoneHint.trim() || null, accessibilityNote: null });
      setZoneCorner(null); setZoneName(''); setZoneHint(''); setNotice('حُفظت المنطقة، وستُعلن عند دخولها أثناء التوجيه.');
    }
  };

  const handleNodeClick = async (event: MouseEvent<SVGGElement>, node: MapNode) => {
    event.stopPropagation();
    if (mode !== 'EDGE' || busy) return;
    const start = edgeStartId ? nodeById.get(edgeStartId) : null;
    if (!start) { setEdgeStartId(node.id); setNotice(`نقطة البداية هي ${node.nodeType}. اختر نقطة النهاية.`); return; }
    if (start.id === node.id) { setEdgeStartId(null); setNotice('ألغيت اختيار نقطة البداية.'); return; }
    await onCreateEdge({ fromNodeId: start.id, toNodeId: node.id, distanceMeters: distance(start, node), pathType });
    setEdgeStartId(null); setNotice(`حُفظ مسار ${pathType} بطول ${distance(start, node)} متر تقريبًا.`);
  };

  return <section className="mt-6 rounded-2xl border border-amber-200/25 bg-stone-950/50 p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xl font-black">محرر الخريطة البصري</h3><p className="mt-1 text-sm text-stone-300">ارسم عقد المسار ووصلاته وحدد المناطق التي يتعرف عليها بصيرة أثناء التنقل. تبقى النماذج اليدوية أعلاه متاحة كبديل كامل بلوحة المفاتيح.</p></div><span className="rounded-full bg-amber-300/15 px-3 py-1 text-sm font-bold text-amber-100">{nodes.length} نقطة · {edges.length} مسار · {zones.length} منطقة</span></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-4"><label>الطابق<select className={input} value={selectedFloor} onChange={event => { setFloorId(event.target.value); setEdgeStartId(null); setZoneCorner(null); }}>{floors.length === 0 && <option value="">أضف طابقًا أولًا</option>}{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label><label>نوع النقطة<select className={input} value={nodeType} onChange={event => setNodeType(event.target.value as NodeType)}><option value="POINT">نقطة</option><option value="CORRIDOR">ممر</option><option value="INTERSECTION">تقاطع</option><option value="DOOR">باب</option><option value="STAIRS">درج</option><option value="ELEVATOR">مصعد</option><option value="ENTRANCE">مدخل</option><option value="EXIT">مخرج</option></select></label><label>نوع المسار<select className={input} value={pathType} onChange={event => setPathType(event.target.value as PathType)}><option value="CORRIDOR">ممر</option><option value="DOOR">باب</option><option value="STAIRS">درج</option><option value="RAMP">منحدر</option><option value="ELEVATOR">مصعد</option><option value="OTHER">أخرى</option></select></label><div className="flex flex-wrap items-end gap-2"><button type="button" className={button} aria-pressed={mode === 'NODE'} onClick={() => chooseMode('NODE')}>نقطة</button><button type="button" className={button} aria-pressed={mode === 'EDGE'} onClick={() => chooseMode('EDGE')}>ارسم مسارًا</button><button type="button" className={button} aria-pressed={mode === 'ZONE'} onClick={() => chooseMode('ZONE')}>حدد منطقة</button></div></div>
    {mode === 'ZONE' && <div className="mt-3 grid gap-3 rounded-xl border border-amber-200/20 p-3 md:grid-cols-3"><label>اسم المنطقة<input className={input} maxLength={255} value={zoneName} onChange={event => setZoneName(event.target.value)} placeholder="مثل: ممر القاعات الشرقية" /></label><label>نوع المنطقة<select className={input} value={zoneType} onChange={event => setZoneType(event.target.value as ZoneType)}><option value="CORRIDOR">ممر</option><option value="LANDMARK">معلم</option><option value="WAITING">انتظار</option><option value="HAZARD">تنبيه</option><option value="SERVICE">خدمة</option><option value="OTHER">أخرى</option></select></label><label>تنبيه صوتي اختياري<input className={input} maxLength={500} value={zoneHint} onChange={event => setZoneHint(event.target.value)} placeholder="مثل: استمر بمحاذاة الجدار الأيمن" /></label></div>}
    <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm text-amber-200">{notice}</p>
    <div className="mt-3 overflow-hidden rounded-xl border border-amber-200/25 bg-stone-950"><svg className="h-auto w-full touch-none" style={{ minHeight: 360 }} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} role="application" aria-label="خريطة تفاعلية لرسم اتجاهات المبنى" onClick={event => void handleCanvasClick(event)}>
      <defs><pattern id="basira-map-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#fcd34d" strokeOpacity=".12" strokeWidth=".25" /></pattern></defs><rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="url(#basira-map-grid)" />
      {zones.map(zone => <g key={zone.id}><rect x={zone.minX} y={zone.minY} width={zone.maxX - zone.minX} height={zone.maxY - zone.minY} fill="#38bdf8" fillOpacity=".16" stroke="#7dd3fc" strokeWidth=".35" strokeDasharray="1.5 1" /><text x={zone.minX + .5} y={zone.minY + 1.5} fill="#e0f2fe" fontSize="1.4">{zone.name}</text></g>)}
      {edges.map(edge => { const start = nodeById.get(edge.fromNodeId)!, end = nodeById.get(edge.toNodeId)!; return <line key={edge.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={edge.pathType === 'STAIRS' ? '#fb7185' : edge.pathType === 'ELEVATOR' ? '#a78bfa' : '#fcd34d'} strokeWidth=".7" />; })}
      {nodes.map(node => <g key={node.id} role="button" tabIndex={0} aria-label={`${node.nodeType} عند ${node.x}، ${node.y}`} onClick={event => void handleNodeClick(event, node)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void handleNodeClick(event as unknown as MouseEvent<SVGGElement>, node); } }}><circle cx={node.x} cy={node.y} r={edgeStartId === node.id ? 2 : 1.35} fill={edgeStartId === node.id ? '#38bdf8' : '#fef3c7'} stroke="#78350f" strokeWidth=".35" /><title>{`${node.nodeType} (${node.x}, ${node.y})`}</title><text x={node.x + 1.8} y={node.y - 1.2} fill="#fef3c7" fontSize="1.25" pointerEvents="none">{node.nodeType}</text></g>)}
      {zoneCorner && <circle cx={zoneCorner.x} cy={zoneCorner.y} r="1.4" fill="#7dd3fc" />}
    </svg></div>
    {zones.length > 0 && <ul className="mt-4 space-y-2" aria-label="المناطق المحفوظة">{zones.map(zone => <li key={zone.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/20 px-3 py-2"><span><strong>{zone.name}</strong> · {zone.zoneType}{zone.guidanceHint ? ` · ${zone.guidanceHint}` : ''}</span><button type="button" className={button} disabled={busy} onClick={() => void onDeleteZone(zone)}>حذف المنطقة</button></li>)}</ul>}
  </section>;
}
