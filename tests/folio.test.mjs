import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{aggregate,compareHoldings,parseInformationTable,selectFilings,buildConsensus,buildDashboard,INVESTORS,hasSecConfiguration} from '../worker.mjs';
// Fixtures are synthetic and used only in tests. Never served by the application.
const configuredEnv={SEC_USER_AGENT:'FolioTests tests@example.invalid'};
const row=(shares=10,extra={})=>({issuer:'TEST FIXTURE',cusip:'000000001',title:'COM',putCall:'',shareType:'SH',shares,value:shares*3,...extra});
const reports=(forms=['13F-HR','13F-HR'],periods=['2026-06-30','2026-03-31'])=>({filings:{recent:{form:forms,reportDate:periods,filingDate:forms.map(()=> '2026-08-14'),accessionNumber:forms.map((_,i)=>`0000000001-26-00000${i}`)}}});
const manager=(slug,period,positions)=>({slug,name:slug,filing:{reportDate:period},positions});
test('parser reads namespaced table and dollar units',()=>{const xml='<DOCUMENT><TYPE>INFORMATION TABLE\n<ns:infoTable><ns:nameOfIssuer>Test &amp; Co</ns:nameOfIssuer><ns:titleOfClass>COM</ns:titleOfClass><ns:cusip>000000001</ns:cusip><ns:value>12500</ns:value><ns:sshPrnamt>50</ns:sshPrnamt><ns:sshPrnamtType>SH</ns:sshPrnamtType></ns:infoTable></DOCUMENT>';const parsed=parseInformationTable(xml,'2026-08-14');assert.equal(parsed[0].value,12500);assert.equal(parsed[0].issuer,'Test & Co');assert.equal(parsed[0].shares,50);assert.throws(()=>parseInformationTable(xml.replace('12500','oops'),'2026-08-14'));});
test('missing information table fails rather than inventing holdings',()=>assert.throws(()=>parseInformationTable('error page','2026-08-14')));
test('aggregation keeps option direction and quantity units separate',()=>{const items=aggregate([row(),row(5),row(10,{putCall:'PUT'}),row(10,{shareType:'PRN'})]);assert.equal(items.length,3);assert.equal(items[0].shares,15);});
test('detects all five position states including sub-0.5% changes',()=>{const current=[row(11),row(2,{cusip:'2'}),row(9,{cusip:'3'}),row(10,{cusip:'4'}),row(1001,{cusip:'6'})];const previous=[row(),row(10,{cusip:'3'}),row(10,{cusip:'4'}),row(10,{cusip:'5'}),row(1000,{cusip:'6'})];const result=compareHoldings(current,previous);assert.deepEqual(new Set(result.positions.map(p=>p.action)),new Set(['NEW','INCREASED','REDUCED','UNCHANGED','EXITED']));assert.equal(result.positions.find(p=>p.cusip==='6').action,'INCREASED');assert.ok(Math.abs(result.positions.reduce((s,p)=>s+p.weight,0)-100)<1e-8);});
test('selects two different consecutive quarters',()=>assert.equal(selectFilings(reports()).length,2));
test('does not silently ignore amendments',()=>assert.throws(()=>selectFilings(reports(['13F-HR/A','13F-HR','13F-HR'],['2026-06-30','2026-06-30','2026-03-31'])),/amended/));
test('withholds comparisons across missing quarters',()=>assert.throws(()=>selectFilings(reports(undefined,['2026-06-30','2025-12-31'])),/consecutive/));
test('consensus deduplicates managers, excludes options, separates quarters',()=>{const result=buildConsensus([manager('a','2026-06-30',[row(),row(1,{title:'OTHER'}),row(1,{cusip:'2',putCall:'CALL'})]),manager('b','2026-06-30',[row()]),manager('c','2026-03-31',[row()])]);assert.equal(result.length,1);assert.equal(result[0].count,2);assert.deepEqual(result[0].slugs,['a','b']);});
test('health works without exposing environment bindings',async()=>{const r=await worker.fetch(new Request('https://folio.test/api/health'),{SECRET:'never-public'},{});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('never-public'));});
test('rejects write methods and hidden cache paths',async()=>{assert.equal((await worker.fetch(new Request('https://folio.test/api/health',{method:'POST'}),{},{})).status,405);assert.equal((await worker.fetch(new Request('https://folio.test/__folio_cache__/v2/berkshire'),{},{})).status,404);});
test('all upstream failures return 503, not a misleading empty success',async()=>{const old=globalThis.caches;globalThis.caches={default:{match:async()=>new Response(JSON.stringify({error:'SEC returned HTTP 403'}))}};try{const r=await worker.fetch(new Request('https://folio.test/api/dashboard'),configuredEnv,{});assert.equal(r.status,503);const body=await r.json();assert.equal(body.investors.length,0);assert.equal(body.errors.length,5);}finally{globalThis.caches=old;}});
test('partial coverage remains explicit and cache is reused',async()=>{const old=globalThis.caches;globalThis.caches={default:{match:async request=>request.url.endsWith('/berkshire')?new Response(JSON.stringify({...INVESTORS[0],filing:{filingDate:'2026-08-14',reportDate:'2026-06-30'},positions:[row()],changes:[]})):new Response(JSON.stringify({error:'unavailable'}))}};try{const data=await buildDashboard(new Request('https://folio.test/api/dashboard'),configuredEnv,{});assert.equal(data.investors.length,1);assert.equal(data.errors.length,4);assert.equal(data.requestedInvestorCount,5);}finally{globalThis.caches=old;}});

test('unconfigured SEC access fails before making any upstream request',async()=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected external request');};
  try{const response=await worker.fetch(new Request('https://folio.test/api/dashboard'),{},{});assert.equal(response.status,503);assert.equal((await response.json()).code,'SEC_NOT_CONFIGURED');assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test('SEC contact configuration rejects empty, malformed and injected values',()=>{
  assert.equal(hasSecConfiguration({}),false);
  assert.equal(hasSecConfiguration({SEC_USER_AGENT:'Folio'}),false);
  assert.equal(hasSecConfiguration({SEC_USER_AGENT:'Folio contact@example.invalid\nInjected: value'}),false);
  assert.equal(hasSecConfiguration(configuredEnv),true);
});
test('health exposes configuration status but never the contact value',async()=>{
  const response=await worker.fetch(new Request('https://folio.test/api/health'),configuredEnv,{});
  const text=await response.text();assert.equal(JSON.parse(text).secConfigured,true);assert.ok(!text.includes(configuredEnv.SEC_USER_AGENT));
});
