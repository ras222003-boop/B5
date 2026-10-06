/** Public map material only. Never place saved places, saved routes or location traces here. */
const prefix='basira-public-nav-v2:';
const maxAgeMs=30*86400000;
export function cachePublicMap<T>(key:string,data:T,now=Date.now()){
  try{localStorage.setItem(prefix+key,JSON.stringify({cachedAt:now,data}));}catch{/* storage may be disabled or full */}
}
export function readPublicMap<T>(key:string,now=Date.now()):T|null{
  try{const raw=localStorage.getItem(prefix+key);if(!raw)return null;const parsed=JSON.parse(raw) as {cachedAt:number;data:T};return Number.isFinite(parsed.cachedAt)&&now-parsed.cachedAt<=maxAgeMs&&now>=parsed.cachedAt?parsed.data:null;}catch{return null;}
}
