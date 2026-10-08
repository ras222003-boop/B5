/** Browser fixture for the navigation UI. No real GPS, database, building or safety claim. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.BASIRA_TEST_URL??'http://127.0.0.1:4173';
const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222';
const start='33333333-3333-4333-8333-333333333333',middle='44444444-4444-4444-8444-444444444444',end='55555555-5555-4555-8555-555555555555';
const edgeA='66666666-6666-4666-8666-666666666666',edgeB='77777777-7777-4777-8777-777777777777';
const graph={building:{id:building,name:'كلية الاختبار',mapStatus:'MAPPED',verificationStatus:'OFFICIAL',latitude:24.7136,longitude:46.6753},nodes:[
  {id:start,buildingId:building,floorId:floor,placeId:null,x:0,y:0,nodeType:'ENTRANCE',accessibilityLevel:'ACCESSIBLE'},
  {id:middle,buildingId:building,floorId:floor,placeId:null,x:5,y:0,nodeType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE'},
  {id:end,buildingId:building,floorId:floor,placeId:null,x:10,y:0,nodeType:'ROOM',accessibilityLevel:'ACCESSIBLE'}],edges:[edgeA,edgeB].map((id,index)=>({id,buildingId:building,fromNodeId:index?middle:start,toNodeId:index?end:middle,distanceMeters:5,direction:null,pathType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE',hasStairs:false,hasRamp:false,wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW'})),zones:[]};
const saved={id:'88888888-8888-4888-8888-888888888888',name:'من المدخل إلى القاعة',buildingId:building,originNodeId:start,destinationNodeId:end,routeData:{nodeIds:[start,middle,end],edgeIds:[edgeA,edgeB],floorTransitions:[],anchorNodeIds:[start,end],turnNodeIds:[]},mapVersion:1,successfulArrivalCount:2,typicalDurationSeconds:90,lastSuccessfulAt:new Date().toISOString(),lastVerifiedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),familiarity:'FAMILIAR'};
let savedPayload:Record<string,unknown>|null=null;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'ar-SA',viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(30000);
await page.route('**/api/speech/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
await page.addInitScript(()=>localStorage.setItem('basira-b4-safety-disclaimer-v1','1'));
await page.addInitScript({content:`(() => {
  const listeners = new Map(); let serial = 0;
  let current = {latitude:24.71360,longitude:46.67530};
  const fix = () => ({coords:{...current,accuracy:6,heading:null,altitude:null,altitudeAccuracy:null,speed:null},timestamp:Date.now()});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    watchPosition:(callback) => { const id=++serial; listeners.set(id,callback); setTimeout(()=>{ if(listeners.has(id))callback(fix()); },0); return id; },
    clearWatch:(id) => { listeners.delete(id); },
    getCurrentPosition:(callback) => callback(fix()),
  }});
  window.pushMockGps = (latitude,longitude) => { current={latitude,longitude}; for(const callback of listeners.values())callback(fix()); };
  window.activeMockGpsWatches = () => listeners.size;
})()`});
await page.route('**/api/navigation/**',async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();
  const reply=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path.endsWith('/saved-routes')&&method==='GET')return reply({savedRoutes:[saved]});
  if(path.endsWith('/saved-routes')&&method==='POST'){savedPayload=route.request().postDataJSON() as Record<string,unknown>;return reply({savedRoute:{...saved,id:'99999999-9999-4999-8999-999999999999',name:savedPayload.name}},201);}
  if(path.endsWith(`/saved-routes/${saved.id}/success`)&&method==='POST')return reply({savedRoute:{...saved,successfulArrivalCount:3}});
  if(path.endsWith(`/buildings/${building}/graph`))return reply(graph);
  if(path.endsWith(`/buildings/${building}/floors`))return reply({floors:[{id:floor,buildingId:building,name:'الأرضي',floorNumber:0}]});
  if(path.endsWith(`/buildings/${building}/places`))return reply({places:[]});
  if(path.endsWith(`/buildings/${building}/version`))return reply({version:1});
  if(path.endsWith('/safety-flags'))return reply({});
  if(path.endsWith('/access'))return reply({userId:'test',role:null});
  return reply({},404);
});
try{
  await page.goto(`${base}/navigation/guidance`);
  const skip=page.locator('[data-testid="welcome-skip"]');if(await skip.count())await skip.click();
  await page.getByRole('heading',{name:'التنقل مع بصيرة'}).waitFor();
  assert(await page.getByRole('button',{name:'أين أنا؟'}).first().isVisible(),'A blind-first quick action must be visible on mobile');
  assert(await page.getByRole('button',{name:'توقف فورًا'}).isVisible(),'Immediate stop must be visible on mobile');
  assert(await page.getByRole('button',{name:'ابدأ تسجيل طريقي'}).isVisible(),'Walk recording must have a visible start button');
  await page.getByRole('button',{name:'استخدم المسار'}).click();
  await page.getByRole('combobox',{name:'ثبت موقعك عند عقدة معروفة'}).selectOption(start);
  assert(await page.getByRole('button',{name:'ابدأ التوجيه'}).first().isVisible(),'Journey start must be a visible button');
  assert(await page.getByRole('button',{name:'ابدأ التوجيه'}).first().isEnabled(),'Journey start must be enabled after choosing route and origin');
  await page.getByRole('button',{name:'ابدأ التوجيه'}).first().focus();await page.keyboard.press('Enter');
  await page.getByRole('img',{name:/خريطة الأرضي/}).waitFor();
  await page.getByRole('button',{name:'العودة إلى نقطة البداية'}).waitFor();
  assert((await page.locator('body').innerText()).includes('NAVIGATING'));
  const semanticMap=page.getByRole('region',{name:'خريطة بصيرة الدلالية'});
  await semanticMap.waitFor();
  assert((await semanticMap.innerText()).includes('2 مقاطع'),'Semantic map should expose mapped segments');
  assert((await semanticMap.innerText()).includes('عرض الممر غير متاح'),'Semantic map must not invent corridor width');
  assert((await semanticMap.innerText()).includes('هذه بيانات خريطة تحتاج تحققًا أثناء السير'),'Semantic map must identify mapped data as unverified during walking');
  const indoorAccessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.equal(indoorAccessibility.violations.length,0,`Indoor mobile accessibility violations: ${indoorAccessibility.violations.map(issue=>issue.id).join(', ')}`);
  await page.getByRole('combobox',{name:'ثبت موقعك عند عقدة معروفة'}).selectOption(end);
  await page.getByRole('button',{name:'تأكيد الوصول'}).click();
  await page.getByRole('textbox',{name:/هل تريد حفظ هذا المسار/}).fill('رحلة الاختبار');
  await page.getByRole('button',{name:'حفظ المسار'}).click();
  await page.getByText('حُفظ المسار المخطط في ذاكرة رحلاتك الخاصة. ستُراجع الخريطة والمخاطر في كل استخدام جديد.').waitFor();
  assert.deepEqual(savedPayload?.nodeIds,[start,middle,end]);
  assert.deepEqual(savedPayload?.edgeIds,[edgeA,edgeB]);
  assert.equal(Object.prototype.hasOwnProperty.call(savedPayload,'rawTrack'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(savedPayload,'gpsPoints'),false);

  // A second mocked session tests drawing a temporary GPS trail. It is not saved as a walked route.
  await page.reload();
  await page.getByRole('button',{name:'استخدم المسار'}).click();
  await page.getByRole('heading',{name:'خارطة بصيرة الجغرافية'}).waitFor();
  const geographicMap=page.getByTestId('geographic-map');await geographicMap.waitFor();
  await page.getByRole('button',{name:'ابدأ تسجيل طريقي'}).click();
  await page.getByText('التسجيل يعمل').waitFor();
  await page.waitForFunction(() => (window as typeof window & {activeMockGpsWatches:()=>number}).activeMockGpsWatches() === 1);
  await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="geographic-map"]')?.getAttribute('data-position')));
  for(const latitude of [24.71364,24.71368,24.71372]){
    await page.waitForTimeout(20);
    await page.evaluate(value => (window as typeof window & {pushMockGps:(latitude:number,longitude:number)=>void}).pushMockGps(value,46.67530),latitude);
    await page.waitForFunction(expected => document.querySelector('[data-testid="geographic-map"]')?.getAttribute('data-position') === expected,`${latitude},46.6753`);
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="geographic-map"]')?.getAttribute('data-observed-points')) >= 2);
  assert((await geographicMap.getAttribute('aria-label'))?.includes('أثر المشي المرصود التقريبي'),'Map region should describe the observed trail to screen readers');
  await page.getByText(/البنفسجي المتقطع: أثر المشي المرصود تقريبيًا من GPS/).waitFor();
  await page.getByRole('button',{name:'إيقاف تسجيل الطريق'}).click();
  await page.getByText('التسجيل متوقف والأثر المؤقت متاح').waitFor();
  assert.equal(await page.evaluate(() => (window as typeof window & {activeMockGpsWatches:()=>number}).activeMockGpsWatches()),0);
  const outdoorAccessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.equal(outdoorAccessibility.violations.length,0,`Outdoor mobile accessibility violations: ${outdoorAccessibility.violations.map(issue=>issue.id).join(', ')}`);
  console.log('BROWSER PASS: 390x844 mobile visible start controls, indoor semantic map, planned route save, mock GPS temporary trail, and axe WCAG A/AA automated checks (0 violations in both fixtures). No real phone, walking or field safety test.');
}finally{await browser.close();}
