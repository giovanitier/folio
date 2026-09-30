/** Folio: read-only SEC 13F tracker. No brokerage, credentials, or sample holdings. */
export const INVESTORS = [
  {slug:'berkshire',name:'Warren Buffett',entity:'Berkshire Hathaway',cik:'0001067983',initials:'WB'},
  {slug:'pershing',name:'Bill Ackman',entity:'Pershing Square',cik:'0001336528',initials:'BA'},
  {slug:'appaloosa',name:'David Tepper',entity:'Appaloosa LP',cik:'0001656456',initials:'DT'},
  {slug:'coatue',name:'Philippe Laffont',entity:'Coatue Management',cik:'0001135730',initials:'PL'},
  {slug:'tiger-global',name:'Chase Coleman',entity:'Tiger Global',cik:'0001167483',initials:'CC'}
];
export function hasSecConfiguration(env) {
  const value = env?.SEC_USER_AGENT;
  return typeof value === 'string' && value.length <= 200 && !/[\r\n]/.test(value) && /\S+@\S+\.\S+/.test(value);
}
const TTL = 21600;
const inflight = new Map();
let nextFetch = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function tag(text, name) {
  const match = text.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i'));
  return (match?.[1] || '').replace(/<[^>]*>/g, '').replace(/&#x([a-f\d]+);/gi, (_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim();
}
function numeric(text) {
  if (!text || !/^\d+(?:\.\d+)?$/.test(text.replace(/,/g,''))) throw new Error('Invalid numeric value in SEC information table.');
  const value = Number(text.replace(/,/g,''));
  if (!Number.isFinite(value)) throw new Error('Invalid SEC numeric value.');
  return value;
}
export function parseInformationTable(text, filedAt) {
  const documents = text.match(/<DOCUMENT>[\s\S]*?<\/DOCUMENT>/gi) || [];
  const tables = documents.filter(doc => /<TYPE>\s*INFORMATION TABLE/i.test(doc));
  if (!tables.length) throw new Error('SEC information table is missing.');
  // Structured 13F filings changed from USD thousands to USD in January 2023.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAt)) throw new Error('A filing date is required to interpret units.');
  const multiplier = filedAt < '2023-01-03' ? 1000 : 1;
  const blocks = tables.flatMap(doc => doc.match(/<(?:[\w-]+:)?infoTable\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?infoTable>/gi) || []);
  if (!blocks.length) throw new Error('SEC information table has no holdings.');
  return blocks.map(block => {
    const row = {issuer:tag(block,'nameOfIssuer'),title:tag(block,'titleOfClass'),cusip:tag(block,'cusip'),putCall:tag(block,'putCall').toUpperCase(),shareType:tag(block,'sshPrnamtType'),shares:numeric(tag(block,'sshPrnamt')),value:numeric(tag(block,'value'))*multiplier};
    if (!row.issuer || !row.cusip || !['SH','PRN'].includes(row.shareType)) throw new Error('Incomplete SEC holding; comparison stopped.');
    return row;
  });
}
function key(row) { return `${row.cusip}|${row.title.trim().toUpperCase()}|${row.putCall || ''}|${row.shareType}`; }
export function aggregate(rows) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row), prior = map.get(k);
    if (prior) { prior.shares += row.shares; prior.value += row.value; }
    else map.set(k,{...row});
  }
  return [...map.values()];
}
export function compareHoldings(currentRows, previousRows) {
  const current = aggregate(currentRows), previous = aggregate(previousRows);
  const prevMap = new Map(previous.map(row=>[key(row),row]));
  const currMap = new Map(current.map(row=>[key(row),row]));
  const totalValue = current.reduce((sum,row)=>sum+row.value,0);
  const positions = current.map(row=>{
    const prev = prevMap.get(key(row));
    const delta = row.shares - (prev?.shares || 0);
    const action = !prev ? 'NEW' : delta > 0 ? 'INCREASED' : delta < 0 ? 'REDUCED' : 'UNCHANGED';
    return {...row,action,previousShares:prev?.shares || 0,previousValue:prev?.value || 0,changePct:prev?.shares ? delta/prev.shares*100 : null,weight:totalValue ? row.value/totalValue*100 : 0};
  });
  for (const prev of previous) if (!currMap.has(key(prev))) positions.push({...prev,action:'EXITED',previousShares:prev.shares,previousValue:prev.value,shares:0,value:0,changePct:-100,weight:0});
  return {totalValue,positions:positions.sort((a,b)=>b.value-a.value)};
}
export function selectFilings(submissions) {
  const recent = submissions?.filings?.recent;
  if (!Array.isArray(recent?.form)) throw new Error('SEC submissions are unavailable.');
  const filings = [], periods = new Set();
  for (let i=0;i<recent.form.length;i++) {
    const reportDate = recent.reportDate?.[i];
    if (recent.form[i] !== '13F-HR' || periods.has(reportDate)) continue;
    const accession = recent.accessionNumber?.[i], filingDate = recent.filingDate?.[i];
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession || '') || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate || '')) throw new Error('Invalid filing metadata.');
    filings.push({accession,filingDate,reportDate}); periods.add(reportDate);
  }
  filings.sort((a,b)=>b.reportDate.localeCompare(a.reportDate));
  if (filings.length<2) throw new Error('Two distinct 13F report periods are required.');
  const selected=filings.slice(0,2);
  const gap=(Date.parse(selected[0].reportDate)-Date.parse(selected[1].reportDate))/86400000;
  if (gap<80 || gap>100) throw new Error('Latest filings are not consecutive quarters; comparison withheld.');
  if (recent.form.some((form,i)=>form==='13F-HR/A' && selected.some(f=>f.reportDate===recent.reportDate[i]))) throw new Error('This period has an amended 13F. Automatic comparison is withheld pending reconciliation.');
  return selected;
}
async function secFetch(url, userAgent, json=false) {
  // Reserve the slot before yielding, preventing concurrent calls from racing.
  const wait=Math.max(0,nextFetch-Date.now()); nextFetch=Date.now()+wait+550;
  if(wait) await sleep(wait);
  const response=await fetch(url,{headers:{'User-Agent':userAgent,Accept:json?'application/json':'text/plain, application/xml'},signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error(`SEC returned HTTP ${response.status}; no data substituted.`);
  const text=await response.text();
  if(text.length>20000000) throw new Error('SEC filing exceeds the V1 size limit.');
  return json?JSON.parse(text):text;
}
async function loadInvestor(investor, env) {
  if (!hasSecConfiguration(env)) throw new Error('SEC access is not configured. Set SEC_USER_AGENT on the server.');
  const userAgent=env.SEC_USER_AGENT;
  const submissions=await secFetch(`https://data.sec.gov/submissions/CIK${investor.cik}.json`,userAgent,true);
  const filings=selectFilings(submissions);
  const base=f=>`https://www.sec.gov/Archives/edgar/data/${Number(investor.cik)}/${f.accession.replaceAll('-','')}/${f.accession}`;
  const [a,b]=await Promise.all(filings.map(async f=>parseInformationTable(await secFetch(base(f)+'.txt',userAgent),f.filingDate)));
  const compared=compareHoldings(a,b);
  const positions=compared.positions.filter(p=>p.action!=='EXITED');
  const changes=compared.positions.filter(p=>p.action!=='UNCHANGED');
  return {...investor,entity:submissions.name || investor.entity,checkedAt:new Date().toISOString(),filing:{...filings[0],previousReportDate:filings[1].reportDate,sourceUrl:base(filings[0])+'-index.html'},totalValue:compared.totalValue,positionCount:positions.length,changeCount:changes.length,positions,changes,topPositions:positions.slice(0,12)};
}
async function cachedInvestor(investor, request, env, ctx) {
  const cache=globalThis.caches?.default;
  const url=new URL(`/__folio_cache__/v2/${investor.slug}`,request.url).href;
  const cacheKey=new Request(url);
  const hit=cache?await cache.match(cacheKey):null;
  if(hit){const payload=await hit.json();if(payload.error)throw new Error(payload.error);return payload;}
  if(inflight.has(url)) return inflight.get(url);
  const pending=(async()=>{
    try {
      const data=await loadInvestor(investor,env);
      if(cache)ctx.waitUntil(cache.put(cacheKey,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${TTL}`}})));
      return data;
    } catch(error) {
      if(cache)ctx.waitUntil(cache.put(cacheKey,new Response(JSON.stringify({error:error.message}),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60'}})));
      throw error;
    } finally { inflight.delete(url); }
  })();
  inflight.set(url,pending);return pending;
}
export function buildConsensus(investors) {
  const map=new Map();
  for(const investor of investors){
    const seen=new Set();
    for(const p of investor.positions){
      if(p.putCall || p.shareType!=='SH')continue;
      // Do not compare different reporting periods or count a manager twice.
      const id=investor.filing.reportDate+'|'+p.cusip;
      const item=map.get(id) || {cusip:p.cusip,issuer:p.issuer,title:p.title,reportDate:investor.filing.reportDate,count:0,investors:[],slugs:[],combinedValue:0};
      item.combinedValue+=p.value;
      if(!seen.has(id)){item.count++;item.investors.push(investor.name);item.slugs.push(investor.slug);seen.add(id);}
      map.set(id,item);
    }
  }
  return [...map.values()].filter(item=>item.count>=2).sort((a,b)=>b.count-a.count || b.combinedValue-a.combinedValue);
}
export async function buildDashboard(request,env,ctx) {
  const investors=[],errors=[];
  const results=await Promise.allSettled(INVESTORS.map(investor=>cachedInvestor(investor,request,env,ctx)));
  results.forEach((result,i)=>result.status==='fulfilled'?investors.push(result.value):errors.push({slug:INVESTORS[i].slug,entity:INVESTORS[i].entity,error:result.reason?.message || 'SEC unavailable.'}));
  const activity=investors.flatMap(i=>i.changes.map(p=>({...p,investorSlug:i.slug,investorName:i.name,investorEntity:i.entity,investorInitials:i.initials,filingDate:i.filing.filingDate,reportDate:i.filing.reportDate,sourceUrl:i.filing.sourceUrl}))).sort((a,b)=>b.filingDate.localeCompare(a.filingDate) || b.value-a.value);
  return {generatedAt:new Date().toISOString(),source:'SEC EDGAR Form 13F-HR',currency:'USD',requestedInvestorCount:INVESTORS.length,investors,activity,consensus:buildConsensus(investors),errors};
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}});}
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    if(path==='/api/health')return json({ok:true,service:'folio',version:'0.2.0',source:'SEC EDGAR',configuredInvestors:INVESTORS.length,secConfigured:hasSecConfiguration(env)});
    if(path==='/api/dashboard'){
      if(!hasSecConfiguration(env))return json({error:'SEC access is not configured. Set SEC_USER_AGENT on the server.',code:'SEC_NOT_CONFIGURED'},503);
      try{const data=await buildDashboard(request,env,ctx);return json(data,data.investors.length?200:503);}
      catch(error){return json({error:'SEC data unavailable.',detail:error.message},503);}
    }
    if(path.startsWith('/api/') || path.startsWith('/__folio_cache__/'))return json({error:'Not found'},404);
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Robots-Tag','noindex');
    return new Response(response.body,{status:response.status,headers});
  }
};
