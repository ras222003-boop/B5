/** Browser fixture for the navigation UI. No real GPS, database, building or safety claim. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.BASIRA_TEST_URL??'http://127.0.0.1:4173';
const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222';
const start='33333333-3333-4333-8333-333333333333',middle='44444444-4444-4444-8444-444444444444',end='55555555-5555-4555-8555-555555555555';
const savedPointId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const edgeA='66666666-6666-4666-8666-666666666666',edgeB='77777777-7777-4777-8777-777777777777';
const graph={building:{id:building,name:'كلية الاختبار',mapStatus:'MAPPED',verificationStatus:'OFFICIAL',latitude:24.7136,longitude:46.6753},nodes:[
  {id:start,buildingId:building,floorId:floor,placeId:null,x:0,y:0,nodeType:'ENTRANCE',accessibilityLevel:'ACCESSIBLE'},
  {id:middle,buildingId:building,floorId:floor,placeId:null,x:5,y:0,nodeType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE'},
  {id:end,buildingId:building,floorId:floor,placeId:null,x:10,y:0,nodeType:'ROOM',accessibilityLevel:'ACCESSIBLE'}],edges:[edgeA,edgeB].map((id,index)=>({id,buildingId:building,fromNodeId:index?middle:start,toNodeId:index?end:middle,distanceMeters:5,direction:null,pathType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE',hasStairs:false,hasRamp:false,wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW'})),zones:[]};
const saved={id:'88888888-8888-4888-8888-888888888888',name:'من المدخل إلى القاعة',buildingId:building,originNodeId:start,destinationNodeId:end,routeData:{nodeIds:[start,middle,end],edgeIds:[edgeA,edgeB],floorTransitions:[],anchorNodeIds:[start,end],turnNodeIds:[]},mapVersion:1,successfulArrivalCount:2,typicalDurationSeconds:90,lastSuccessfulAt:new Date().toISOString(),lastVerifiedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),familiarity:'FAMILIAR'};
let savedPayload:Record<string,unknown>|null=null;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'ar-SA',serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(15000);
await page.route('**/api/speech/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
await page.addInitScript(()=>localStorage.setItem('basira-b4-safety-disclaimer-v1','1'));
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
  if(path.endsWith('/saved-places')&&method==='POST')return reply({savedPlace:{id:'test'}},201);
  if(path.endsWith(`/saved-places/${savedPointId}`))return reply({savedPlace:{id:savedPointId,name:'بوابة الجامعة',buildingId:null,floorId:null,placeId:null,latitude:24.714,longitude:46.675,category:'STUDY'}});
  return reply({},404);
});
try{
  await page.goto(`${base}/navigation/guidance`);
  const skip=page.locator('[data-testid="welcome-skip"]');if(await skip.count())await skip.click();
  await page.getByRole('heading',{name:'التنقل مع بصيرة'}).waitFor();
  await page.getByRole('button',{name:'استخدم المسار'}).click();
  await page.getByRole('combobox',{name:'ثبت موقعك عند عقدة معروفة'}).selectOption(start);
  await page.getByRole('button',{name:'ابدأ التوجيه'}).focus();await page.keyboard.press('Enter');
  await page.getByRole('img',{name:/خريطة الأرضي/}).waitFor();
  await page.getByRole('button',{name:'العودة إلى نقطة البداية'}).waitFor();
  assert((await page.locator('body').innerText()).includes('NAVIGATING'));
  const place=page.getByRole('textbox',{name:'اسم هذا المكان'});await place.fill('نقطة اختبار');
  await page.getByRole('button',{name:'احفظ هذا المكان'}).click();
  await page.getByText('حُفظ المكان في أماكني الخاصة.').waitFor();
  await page.getByRole('combobox',{name:'ثبت موقعك عند عقدة معروفة'}).selectOption(end);
  await page.getByRole('button',{name:'تأكيد الوصول'}).click();
  await page.getByRole('textbox',{name:/هل تريد حفظ هذا المسار/}).fill('رحلة الاختبار');
  await page.getByRole('button',{name:'حفظ المسار'}).click();
  await page.getByText('حُفظ المسار في ذاكرة رحلاتك الخاصة. ستُراجع الخريطة والمخاطر في كل استخدام جديد.').waitFor();
  const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.equal(accessibility.violations.length,0,`Indoor accessibility violations: ${accessibility.violations.map(issue=>issue.id).join(', ')}`);
  assert.deepEqual(savedPayload?.nodeIds,[start,middle,end]);
  assert.equal(Object.prototype.hasOwnProperty.call(savedPayload,'rawTrack'),false);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:24.7138,longitude:46.675,accuracy:6});
  await page.evaluate(id=>sessionStorage.setItem('basira-navigation-destination',JSON.stringify({kind:'saved',id})),savedPointId);
  await page.reload();
  await page.getByRole('heading',{name:'متابعة الموقع خارج المبنى'}).waitFor();
  await page.getByRole('button',{name:'بدء متابعة GPS'}).click();
  await page.getByText(/دقة الموقع: مرتفعة/).waitFor();
  await page.getByText(/الخط المتقطع يشير إلى الوجهة مباشرة وليس طريقًا قابلًا للمشي/).waitFor();
  const outdoorAccessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.equal(outdoorAccessibility.violations.length,0,`Outdoor accessibility violations: ${outdoorAccessibility.violations.map(issue=>issue.id).join(', ')}`);
  console.log('BROWSER PASS: indoor familiar route, map, place and route save; simulated outdoor GPS quality; axe WCAG A/AA automated checks (0 violations on both fixtures).');
}finally{await browser.close();}
