import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { MapPin, Search, BookmarkPlus, Building2, LocateFixed } from 'lucide-react';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { navigationMessages } from '@/i18n/locales/navigation';
import { visionMessages } from '@/i18n/locales/vision';
import { navApi, navigationRequest, json, type SearchResult, type BuildingGraph } from '@/lib/navigationApi';
import { permissionService } from '@/lib/permissionService';
import { savedCategories, type Building, type Floor, type Place, type SavedPlace } from '@shared/navigation';

const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-2 font-bold text-stone-950 hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';
const secondary = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-amber-300/50 px-5 py-2 font-bold text-amber-100 hover:bg-amber-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';
const input = 'min-h-12 w-full rounded-xl border border-amber-200/35 bg-stone-950 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300';
const panel = 'rounded-2xl border border-amber-200/20 bg-stone-900/80 p-5';

function useNotice() {
  const [notice, setNotice] = useState('');
  return { notice, setNotice, live: <p role="status" aria-live="polite" className="min-h-6 text-amber-200">{notice}</p> };
}

export default function Navigation() {
  const t = useMessages(navigationMessages);
  const vision = useMessages(visionMessages);
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [currentBuilding, setCurrentBuilding] = useState<Building | null>(null);
  const [coordinates, setCoordinates] = useState<{latitude:number;longitude:number}|null>(null);
  const [showSave, setShowSave] = useState(false);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [category, setCategory] = useState<typeof savedCategories[number]>('OTHER');
  const [notes, setNotes] = useState('');
  const [floorId, setFloorId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const { notice, setNotice, live } = useNotice();

  useEffect(() => {
    navApi.buildings().then(data => setBuildings(data.buildings)).catch(() => setNotice(t.failed));
    const id = sessionStorage.getItem('basira-current-building');
    if (id) navApi.building(id).then(data => setCurrentBuilding(data.building)).catch(() => sessionStorage.removeItem('basira-current-building'));
  }, []);
  useEffect(() => {
    if (!currentBuilding) { setFloors([]); setFloorId(''); return; }
    navApi.floors(currentBuilding.id).then(data => setFloors(data.floors)).catch(() => setFloors([]));
  }, [currentBuilding?.id]);

  const locate = async () => {
    setBusy(true); setNotice('');
    try {
      const point = await permissionService.currentLocation();
      setCoordinates(point); // Ephemeral: no continuous tracking or automatic location history.
      const data = await navigationRequest<{building:Building|null}>(`/buildings/current?latitude=${point.latitude}&longitude=${point.longitude}`);
      setCurrentBuilding(data.building);
      if (data.building) { sessionStorage.setItem('basira-current-building', data.building.id); setNotice(`${t.locationFound}: ${data.building.name}`); }
      else { sessionStorage.removeItem('basira-current-building'); setNotice(t.noLocation); }
    } catch { setNotice(t.noLocation); }
    finally { setBusy(false); }
  };
  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) { setResults([]); return; }
    setBusy(true);
    try { setResults((await navApi.search(query, currentBuilding?.id, includeOthers)).results); setNotice(''); }
    catch { setNotice(t.failed); }
    finally { setBusy(false); }
  };
  const selectResult = async (result: SearchResult) => {
    const item = result.item;
    if (result.kind === 'saved') {
      try { await navigationRequest(`/saved-places/${item.id}/select`, {method:'POST'}); } catch { setNotice(t.failed); return; }
    }
    setDestination(item.name);
    sessionStorage.setItem('basira-navigation-destination', JSON.stringify({ kind:result.kind, id:item.id }));
    setNotice(`${t.selected}: ${item.name}`);
  };
  const prepareDestination = (result: SearchResult) => {
    sessionStorage.setItem('basira-navigation-destination', JSON.stringify({kind:result.kind,id:result.item.id}));
    setDestination(result.item.name); setNotice(t.destinationReady); navigate('/navigation/guidance');
  };
  const startSave = async () => {
    setShowSave(true);
    if (!coordinates) {
      try { setCoordinates(await permissionService.currentLocation()); }
      catch { setNotice(t.noLocation); }
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!saveName.trim()) { setNotice(t.required); return; }
    setBusy(true);
    try {
      await navigationRequest('/saved-places', json('POST', {
        name:saveName.trim(),category,notes:notes.trim()||null,latitude:coordinates?.latitude??null,
        longitude:coordinates?.longitude??null,buildingId:currentBuilding?.id??null,floorId:floorId||null,
      }));
      setShowSave(false); setSaveName(''); setNotes(''); setNotice(t.savedSuccess);
    } catch (error) { setNotice(error instanceof Error && error.message==='sign_in_required'?t.signIn:t.failed); }
    finally { setBusy(false); }
  };
  const chooseBuilding = (id: string) => {
    const building = buildings.find(b => b.id===id)??null;
    setCurrentBuilding(building);
    setFloorId('');
    if (building) sessionStorage.setItem('basira-current-building', building.id);
    else sessionStorage.removeItem('basira-current-building');
  };

  return <Layout><div className="container space-y-7 py-10 text-stone-100">
    <header><p className="text-sm font-bold text-amber-300">{t.title}</p><h1 className="text-3xl font-black">{t.where}</h1></header>
    <form onSubmit={runSearch} role="search" className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="navigation-search">{t.where}</label>
      <input id="navigation-search" className={input} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t.searchPlaceholder}/>
      <button className={button} disabled={busy} type="submit"><Search aria-hidden="true" size={20}/>{t.search}</button>
    </form>
    <label className="block max-w-xl">{t.locationFound}<select className={input} value={currentBuilding?.id??''} onChange={e=>chooseBuilding(e.target.value)}><option value="">{t.chooseBuilding}</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    {currentBuilding && <p className="rounded-xl bg-amber-300/10 p-3 text-amber-100">{t.locationFound}: <Link href={`/navigation/buildings/${currentBuilding.id}`} className="underline">{currentBuilding.name}</Link></p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={secondary} onClick={locate} disabled={busy}><LocateFixed aria-hidden="true" size={20}/>{t.current}</button>
      <Link className={secondary} href="/navigation/places"><BookmarkPlus aria-hidden="true" size={20}/>{t.saved}</Link>
      <a className={secondary} href="#known-buildings"><Building2 aria-hidden="true" size={20}/>{t.known}</a>
      <button type="button" className={secondary} onClick={startSave}><MapPin aria-hidden="true" size={20}/>{t.saveHere}</button>
      <Link className={secondary} href={currentBuilding?`/navigation/buildings/${currentBuilding.id}`:'/navigation#known-buildings'}>{t.map}</Link>
      <Link className={secondary} href="/navigation/places?filter=recent">{t.recent}</Link>
      <Link className={secondary} href="/navigation/permissions">{t.permissions}</Link>
      <Link className={button} href="/navigation/vision">{vision.open}</Link>
      <Link className={button} href="/navigation/guidance">التنقل مع بصيرة</Link>
    </div>
    {live}
    {results.length>0 && <section aria-labelledby="results-heading" className={panel}><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="results-heading" className="text-xl font-bold">{t.search}</h2>{currentBuilding && !includeOthers && <button type="button" className={secondary} onClick={()=>{setIncludeOthers(true);navApi.search(query,currentBuilding.id,true).then(data=>setResults(data.results)).catch(()=>setNotice(t.failed));}}>{t.otherBuildings}</button>}</div>
      <ul className="space-y-3">{results.map(result=><li key={`${result.kind}-${result.item.id}`} className="rounded-xl border border-amber-200/20 p-4"><strong>{result.item.name}</strong><p className="text-sm text-stone-300">{result.kind==='place' ? `${(result.item as Place).buildingName??''} — ${(result.item as Place).floorName??''}` : `${(result.item as SavedPlace).buildingName??''} — ${(result.item as SavedPlace).floorName??''}`}</p><div className="mt-3 flex flex-wrap gap-2"><button className={secondary} onClick={()=>selectResult(result)}>{t.select}</button><button className={button} onClick={()=>prepareDestination(result)}>{t.guide}</button></div></li>)}</ul>
    </section>}
    {query && !busy && results.length===0 && <p>{t.noResults}</p>}
    {destination && <p className="text-amber-200" role="status">{t.selected}: {destination}</p>}
    {showSave && <section className={panel} aria-labelledby="save-title"><h2 id="save-title" className="mb-4 text-xl font-bold">{t.saveHere}</h2><p className="mb-4 text-sm text-stone-300">{t.privacyHint}</p><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <label>{t.placeName} *<input required className={input} value={saveName} onChange={e=>setSaveName(e.target.value)}/></label>
      <label>{t.category}<select className={input} value={category} onChange={e=>setCategory(e.target.value as typeof category)}>{savedCategories.map(key=><option key={key} value={key}>{t.categories[key]}</option>)}</select></label>
      <label>{t.building}<select className={input} value={currentBuilding?.id??''} onChange={e=>chooseBuilding(e.target.value)}><option value="">{t.chooseBuilding}</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>{t.floor}<select className={input} value={floorId} onChange={e=>setFloorId(e.target.value)}><option value="">{t.chooseFloor}</option>{floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label className="sm:col-span-2">{t.notes}<textarea className={input} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></label>
      <p className="sm:col-span-2 text-sm text-stone-300">{t.currentCoordinates}: {coordinates?`${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`:t.noLocation}</p>
      <div className="flex gap-2 sm:col-span-2"><button className={button} disabled={busy}>{t.save}</button><button type="button" className={secondary} onClick={()=>setShowSave(false)}>{t.cancel}</button></div>
    </form></section>}
    <section id="known-buildings" aria-labelledby="buildings-title" className={panel}><h2 id="buildings-title" className="mb-4 text-xl font-bold">{t.known}</h2>{buildings.length?<ul className="grid gap-3 sm:grid-cols-2">{buildings.map(b=><li key={b.id}><Link href={`/navigation/buildings/${b.id}`} className={`${secondary} w-full justify-start`}>{b.name} · {t.buildingTypes[b.buildingType]} · {t.mapStatuses[b.mapStatus]}</Link></li>)}</ul>:<p>{t.noBuildings}</p>}</section>
    <NavigationAdminLink/>
  </div></Layout>;
}

function NavigationAdminLink() {
  const t=useMessages(navigationMessages); const [allowed,setAllowed]=useState(false);
  useEffect(()=>{navApi.access().then(data=>setAllowed(Boolean(data.role))).catch(()=>{});},[]);
  return allowed?<Link className={secondary} href="/navigation/admin">{t.addBuilding} / {t.buildMap}</Link>:null;
}

export function BuildingPage() {
  const t=useMessages(navigationMessages);
  const [,navigate]=useLocation();
  const [,params]=useRoute('/navigation/buildings/:id');
  const id=params?.id??'';
  const [building,setBuilding]=useState<Building|null>(null);
  const [floors,setFloors]=useState<Floor[]>([]);
  const [places,setPlaces]=useState<Place[]>([]);
  const [graph,setGraph]=useState<BuildingGraph|null>(null);
  const [q,setQ]=useState('');
  const {notice,setNotice,live}=useNotice();
  useEffect(()=>{if(!id)return;Promise.all([navApi.building(id),navApi.floors(id),navApi.places(id),navApi.graph(id)]).then(([a,b,c,d])=>{setBuilding(a.building);setFloors(b.floors);setPlaces(c.places);setGraph(d);}).catch(()=>setNotice(t.failed));},[id]);
  const search=async (event:FormEvent)=>{event.preventDefault();try{setPlaces((await navApi.places(id,q)).places);}catch{setNotice(t.failed);}};
  const select=(place:Place)=>{sessionStorage.setItem('basira-navigation-destination',JSON.stringify({kind:'place',id:place.id}));setNotice(t.destinationReady);navigate('/navigation/guidance');};
  const groups=[{label:t.rooms,types:['ROOM','CLASSROOM','LAB']},{label:t.offices,types:['OFFICE']},{label:t.elevators,types:['ELEVATOR']},{label:t.stairs,types:['STAIRS']},{label:t.services,types:['RECEPTION','RESTROOM','WAITING_AREA','PHARMACY','CLINIC','SERVICE_POINT','PARKING']},{label:t.entrances,types:['ENTRANCE']},{label:t.exits,types:['EXIT','EMERGENCY_EXIT']}];
  return <Layout><div className="container space-y-6 py-10 text-stone-100"><Link className="text-amber-200 underline" href="/navigation">{t.title}</Link><h1 className="text-3xl font-black">{building?.name??t.loading}</h1>{building && <p>{t.buildingTypes[building.buildingType]} · {t.verification[building.verificationStatus]} · {t.mapStatuses[building.mapStatus]}</p>}
    <form onSubmit={search} role="search" className="flex gap-2"><label htmlFor="building-search" className="sr-only">{t.searchBuilding}</label><input id="building-search" className={input} value={q} onChange={e=>setQ(e.target.value)} placeholder={t.searchPlaceholder}/><button className={button}>{t.search}</button></form>
    {live}<section className={panel}><h2 className="text-xl font-bold">{t.floor}</h2><ul className="mt-3 flex flex-wrap gap-3">{floors.map(f=><li key={f.id} className={secondary}>{f.name}</li>)}</ul></section>
    {groups.map(group=>{const found=places.filter(p=>group.types.includes(p.placeType));return <section key={group.label} className={panel}><h2 className="text-xl font-bold">{group.label}</h2>{found.length?<ul className="mt-3 space-y-2">{found.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/20 p-3"><span>{p.name} {p.roomNumber?`(${p.roomNumber})`:''} — {p.floorName}</span><button className={secondary} onClick={()=>select(p)}>{t.guide}</button></li>)}</ul>:<p className="mt-2 text-stone-400">{t.noResults}</p>}</section>})}
    <section className={panel}><h2 className="text-xl font-bold">{t.map}</h2><p className="mt-2">{t.graphNodes}: {graph?.nodes.length??0} · {t.graphEdges}: {graph?.edges.length??0}</p><ol className="mt-3 space-y-1">{graph?.nodes.map(n=><li key={n.id}>{t.nodeTypes[n.nodeType]} — {floors.find(f=>f.id===n.floorId)?.name??''} ({n.x}, {n.y})</li>)}</ol></section>
    <NavigationAdminLink/>
  </div></Layout>;
}

export function MyPlaces() {
  const t=useMessages(navigationMessages); const {formatDate}=useI18n();
  const [,navigate]=useLocation();
  const [items,setItems]=useState<SavedPlace[]>([]); const [filter,setFilter]=useState<'all'|'favorites'|'recent'>(()=>new URLSearchParams(location.search).get('filter')==='recent'?'recent':'all');
  const [q,setQ]=useState(''); const [editing,setEditing]=useState<SavedPlace|null>(null); const [name,setName]=useState(''); const [notes,setNotes]=useState(''); const [category,setCategory]=useState<typeof savedCategories[number]>('OTHER');
  const {notice,setNotice,live}=useNotice();
  const load=()=>navApi.saved(filter,q).then(data=>{setItems(data.savedPlaces);setNotice('');}).catch(error=>setNotice(error instanceof Error&&error.message==='sign_in_required'?t.signIn:t.failed));
  useEffect(()=>{load();},[filter]);
  const edit=(item:SavedPlace)=>{setEditing(item);setName(item.name);setNotes(item.notes??'');setCategory(item.category);};
  const save=async(event:FormEvent)=>{event.preventDefault();if(!editing)return;try{await navigationRequest(`/saved-places/${editing.id}`,json('PATCH',{name,notes,category}));setEditing(null);await load();setNotice(t.updatedSuccess);}catch{setNotice(t.failed);}};
  const action=async(item:SavedPlace,kind:'delete'|'favorite'|'select'|'guide')=>{try{
    if(kind==='delete')await navigationRequest(`/saved-places/${item.id}`,{method:'DELETE'});
    if(kind==='favorite')await navigationRequest(`/saved-places/${item.id}/favorite`,json('POST',{isFavorite:!item.isFavorite}));
    if(kind==='select'||kind==='guide'){await navigationRequest(`/saved-places/${item.id}/select`,{method:'POST'});sessionStorage.setItem('basira-navigation-destination',JSON.stringify({kind:'saved',id:item.id}));}
    if(kind==='delete'||kind==='favorite')await load();
    if(kind==='guide')navigate('/navigation/guidance');
    setNotice(kind==='delete'?t.removedSuccess:kind==='guide'?t.destinationReady:kind==='select'?t.selected:t.updatedSuccess);
  }catch{setNotice(t.failed);}};
  return <Layout><div className="container space-y-6 py-10 text-stone-100"><Link className="text-amber-200 underline" href="/navigation">{t.title}</Link><h1 className="text-3xl font-black">{t.myPlaces}</h1><p>{t.privacyHint}</p>
    <form onSubmit={e=>{e.preventDefault();load();}} role="search" className="flex gap-2"><label className="sr-only" htmlFor="saved-search">{t.search}</label><input id="saved-search" className={input} value={q} onChange={e=>setQ(e.target.value)} placeholder={t.searchPlaceholder}/><button className={button}>{t.search}</button></form>
    <div role="group" aria-label={t.myPlaces} className="flex flex-wrap gap-2">{(['all','favorites','recent'] as const).map(key=><button key={key} type="button" className={filter===key?button:secondary} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{key==='all'?t.all:key==='favorites'?t.favorites:t.recent}</button>)}</div>{live}
    {editing && <form className={panel} onSubmit={save}><h2 className="mb-3 text-xl font-bold">{t.edit}</h2><label className="block">{t.placeName} *<input className={input} required value={name} onChange={e=>setName(e.target.value)}/></label><label className="mt-3 block">{t.category}<select className={input} value={category} onChange={e=>setCategory(e.target.value as typeof category)}>{savedCategories.map(key=><option key={key} value={key}>{t.categories[key]}</option>)}</select></label><label className="mt-3 block">{t.notes}<textarea className={input} value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="mt-3 flex gap-2"><button className={button}>{t.save}</button><button type="button" className={secondary} onClick={()=>setEditing(null)}>{t.cancel}</button></div></form>}
    {items.length?<ul className="grid gap-4 md:grid-cols-2">{items.map(item=><li className={panel} key={item.id}><h2 className="text-xl font-bold">{item.name} {item.isFavorite&&<span className="text-sm text-amber-300">· {t.favorite}</span>}</h2><p>{t.categories[item.category]} · {item.buildingName??''} · {item.floorName??''}</p><p className="text-sm text-stone-400">{t.lastUsed}: {item.lastUsedAt?formatDate(item.lastUsedAt):t.neverUsed}</p><div className="mt-3 flex flex-wrap gap-2"><button className={secondary} onClick={()=>action(item,'select')}>{t.select}</button><button className={button} onClick={()=>action(item,'guide')}>{t.guide}</button><button className={secondary} onClick={()=>edit(item)}>{t.edit}</button><button className={secondary} onClick={()=>action(item,'favorite')}>{item.isFavorite?t.removeFavorite:t.addFavorite}</button><button className={secondary} onClick={()=>action(item,'delete')}>{t.remove}</button></div></li>)}</ul>:<p>{t.noSaved}</p>}
  </div></Layout>;
}
