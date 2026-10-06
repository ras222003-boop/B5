import { memo } from 'react';
import type { NavigationRoute, RouteProgress } from '@shared/guidance';
import type { LocalizationEstimate } from '@shared/localization';
import type { MapEdge, MapNode, Place } from '@shared/navigation';

type Props={nodes:MapNode[];edges:MapEdge[];places:Place[];route:NavigationRoute|null;progress:RouteProgress|null;estimate:LocalizationEstimate|null;floorId:string|null;floorName:string};
function NavigationRouteMap({nodes,edges,places,route,progress,estimate,floorId,floorName}:Props){
  const visible=nodes.filter(node=>node.floorId===floorId),byId=new Map(nodes.map(node=>[node.id,node]));
  const position=estimate?.floorId===floorId&&estimate.x!==null&&estimate.y!==null?{x:estimate.x!,y:estimate.y!}:null;
  const all=[...visible.map(node=>({x:node.x,y:node.y})),...(position?[position]:[])];
  if (!all.length)return <p>لا توجد بيانات هندسية لهذا الطابق.</p>;
  const minX=Math.min(...all.map(p=>p.x))-8,maxX=Math.max(...all.map(p=>p.x))+8,minY=Math.min(...all.map(p=>p.y))-8,maxY=Math.max(...all.map(p=>p.y))+8;
  const coordinates=(a:MapNode,b:MapNode)=>({x1:a.x,y1:a.y,x2:b.x,y2:b.y});
  const routeEdges=new Map(route?.orderedEdges.map((edge,index)=>[edge.id,index])??[]);
  const placeById=new Map(places.map(place=>[place.id,place]));
  const uncertainty=position&&estimate?.uncertaintyRadius!=null?Math.max(1,Math.min(estimate.uncertaintyRadius,50)):null;
  return <figure className="rounded-2xl border border-amber-200/30 bg-stone-950 p-3">
    <svg role="img" aria-label={`خريطة ${floorName}: ${route?`المسار إلى ${route.destination.name}`:'لا يوجد مسار'}؛ ${position?'الموقع ظاهر':'الموقع غير مؤكد'}`} viewBox={`${minX} ${minY} ${Math.max(16,maxX-minX)} ${Math.max(16,maxY-minY)}`} className="h-80 w-full rounded-xl bg-stone-900" preserveAspectRatio="xMidYMid meet">
      {edges.map(edge=>{const a=byId.get(edge.fromNodeId),b=byId.get(edge.toNodeId);if(!a||!b||a.floorId!==floorId||b.floorId!==floorId)return null;const index=routeEdges.get(edge.id),onRoute=index!==undefined;const completed=onRoute&&progress&&index<progress.edgeIndex;return <line key={edge.id} {...coordinates(a,b)} stroke={edge.temporarilyClosed?'#ef4444':completed?'#34d399':onRoute?'#fbbf24':'#78716c'} strokeWidth={onRoute?5:2} strokeLinecap="round" strokeDasharray={edge.temporarilyClosed?'4 3':undefined} vectorEffect="non-scaling-stroke"/>;})}
      {visible.map(node=><g key={node.id}><circle cx={node.x} cy={node.y} r={node.nodeType==='ENTRANCE'||node.nodeType==='DOOR'?1.2:.75} fill={node.id===route?.destination.nodeId?'#f59e0b':node.nodeType==='ENTRANCE'?'#60a5fa':'#d6d3d1'}/>{(node.placeId||node.nodeType==='ENTRANCE')&&<text x={node.x+1.4} y={node.y-1.4} fill="#fff" fontSize="2.4">{placeById.get(node.placeId??'')?.name??'مدخل'}</text>}</g>)}
      {position&&<g>{uncertainty!==null&&<circle cx={position.x} cy={position.y} r={uncertainty} fill="#38bdf8" fillOpacity=".12" stroke="#7dd3fc" strokeDasharray="2 1" strokeWidth=".5"/>}<circle cx={position.x} cy={position.y} r="1.5" fill="#38bdf8" stroke="#fff" strokeWidth=".45"/>{estimate?.headingDegrees!=null&&<line x1={position.x} y1={position.y} x2={position.x+Math.sin(estimate.headingDegrees*Math.PI/180)*4} y2={position.y-Math.cos(estimate.headingDegrees*Math.PI/180)*4} stroke="#38bdf8" strokeWidth="1"/>}</g>}
    </svg>
    <figcaption className="mt-2 text-sm text-stone-300">الذهبي: المسار المتبقي · الأخضر: الجزء المنجز · الأزرق: الموقع ونطاق عدم اليقين · الأحمر: إغلاق معروف. الرسم مرجع بصري مساعد.</figcaption>
  </figure>;
}
export default memo(NavigationRouteMap,(a,b)=>{
  if(a.nodes!==b.nodes||a.edges!==b.edges||a.places!==b.places||a.route?.id!==b.route?.id||a.progress?.edgeIndex!==b.progress?.edgeIndex||a.floorId!==b.floorId||a.floorName!==b.floorName)return false;
  const x=a.estimate,y=b.estimate;
  if(!x||!y)return x===y;
  if(x.floorId!==y.floorId||x.state!==y.state)return false;
  if(x.x===null||x.y===null||y.x===null||y.y===null)return x.x===y.x&&x.y===y.y;
  return Math.hypot(x.x-y.x,x.y-y.y)<1&&Math.abs((x.uncertaintyRadius??99)-(y.uncertaintyRadius??99))<1&&Math.abs((x.headingDegrees??0)-(y.headingDegrees??0))<15;
});
