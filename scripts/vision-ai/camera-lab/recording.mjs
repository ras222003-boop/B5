/** Local metadata only. Predictions never become reference annotations. */
export const ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export function sceneIdentity(value){
  const result={};
  for(const key of ['siteId','captureSessionId','sceneId']){
    if(!ID_PATTERN.test(value?.[key]??''))throw new Error(`Invalid pseudonymous ${key}`);
    result[key]=value[key];
  }
  if(value.sampleId){if(!ID_PATTERN.test(value.sampleId))throw new Error('Invalid sampleId');result.sampleId=value.sampleId;}
  return result;
}
export function makeReport({id,identity,model,source,metrics,predictions,events,browser,secureContext}){
  return {schemaVersion:2,scope:'isolated-browser-camera-lab',id,identity:sceneIdentity(identity),model,source,
    metrics,predictions,events,browser,secureContext,mediaIncluded:false,productionUsed:false,
    referenceLabelsIncluded:false,predictionsAreGroundTruth:false,realWorldAccuracyMeasured:false};
}
export async function openRecordingStore(factory=globalThis.indexedDB){
  if(!factory)throw new Error('Local IndexedDB unavailable; export results before closing');
  const db=await new Promise((done,reject)=>{
    const request=factory.open('basira-isolated-camera-lab',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id'});
    request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);
  });
  const transaction=(mode,action)=>new Promise((done,reject)=>{
    const tx=db.transaction('sessions',mode),request=action(tx.objectStore('sessions'));
    tx.oncomplete=()=>done(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local transaction aborted'));
  });
  return {save:report=>transaction('readwrite',store=>store.put(report)),
    all:()=>transaction('readonly',store=>store.getAll()),clear:()=>transaction('readwrite',store=>store.clear()),close:()=>db.close()};
}
