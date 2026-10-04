import { SAFE_DEFAULT_FLAGS, type SafetyFlags } from '@shared/safetyFlags';

export async function loadSafetyFlags():Promise<SafetyFlags>{
  try{
    const response=await fetch('/api/navigation/safety-flags',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return {...SAFE_DEFAULT_FLAGS};
    const value=await response.json() as Partial<SafetyFlags>;
    return Object.fromEntries(Object.keys(SAFE_DEFAULT_FLAGS).map(key=>[key,value[key as keyof SafetyFlags]===true])) as unknown as SafetyFlags;
  }catch{return {...SAFE_DEFAULT_FLAGS};}
}
