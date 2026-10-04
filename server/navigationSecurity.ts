/** Reject browser cross-site writes before cookie-authenticated navigation routes run. */
export function allowedNavigationMutation(origin:string|undefined,host:string|undefined,fetchSite:string|undefined):boolean{
  if(fetchSite==='cross-site')return false;
  if(!origin)return fetchSite==='same-origin'||fetchSite==='none';
  if(!host)return false;
  try{const parsed=new URL(origin);return parsed.host===host&&(parsed.protocol==='https:'||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1');}catch{return false;}
}
