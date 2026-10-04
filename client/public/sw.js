/* B6 bounded, opt-in runtime caches. Never cache authentication or personal API data. */
const SHELL='basira-shell-v1',MAPS='basira-public-maps-v1',ASSETS='basira-assets-v1',VISION='basira-vision-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(cache=>cache.add('/')));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('basira-')&&![SHELL,MAPS,ASSETS,VISION].includes(key))await caches.delete(key);await self.clients.claim();})());});
async function storeBounded(cacheName,request,response,maxBytes,maxEntries){
  if(!response.ok||response.type!=='basic'||/private|no-store/i.test(response.headers.get('Cache-Control')||''))return;
  const size=Number(response.headers.get('Content-Length'));
  if(!Number.isFinite(size)||size<=0||size>maxBytes)return;
  const cache=await caches.open(cacheName);await cache.put(request,response.clone());
  const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-maxEntries)))await cache.delete(old);
}
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  const path=url.pathname;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{if(response.ok)event.waitUntil(caches.open(SHELL).then(cache=>cache.put('/',response.clone())));return response;}).catch(async()=>(await caches.open(SHELL)).match('/')||Response.error()));
    return;
  }
  const publicMap=/^\/api\/navigation\/buildings\/[0-9a-f-]{36}\/(graph|floors|places)$/.test(path);
  if(publicMap){
    event.respondWith(fetch(request).then(response=>{event.waitUntil(storeBounded(MAPS,request,response,2_000_000,12));return response;}).catch(async()=>(await caches.open(MAPS)).match(request)||Response.error()));return;
  }
  if(path.startsWith('/assets/')||path.startsWith('/vision/')){
    const vision=path.startsWith('/vision/'),cacheName=vision?VISION:ASSETS;
    event.respondWith((async()=>{const cache=await caches.open(cacheName),cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);event.waitUntil(storeBounded(cacheName,request,response,vision?30_000_000:5_000_000,vision?8:40));return response;})());
  }
});
