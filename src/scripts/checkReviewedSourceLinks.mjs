import fs from 'node:fs/promises';
const data=JSON.parse(await fs.readFile(new URL('../../scripts/data/reviewed-package-sources.json', import.meta.url),'utf8'));
const accepted=new Set(['content_validated','content_validated_in_original_review']), excluded=new Set(['legacy_legal_references_do_not_import_as_current','policy_confirmation_required_old_examples']);
const rows=data.rows.map(row=>({...row,sources:row.sources.filter(s=>accepted.has(s.validationStatus)&&!excluded.has(s.currentnessStatus))}));
const urls=[...new Set(rows.flatMap(row=>row.sources.map(s=>s.url)))]; let cursor=0; const checks=[];
async function check(url){ const start=Date.now(); try { const r=await fetch(url,{method:'GET',headers:{Range:'bytes=0-1023','User-Agent':'Readines source link verification'},signal:AbortSignal.timeout(16000)}); const result={url,status:r.status,ok:r.ok,finalUrl:r.url,contentType:r.headers.get('content-type'),ms:Date.now()-start}; await r.body?.cancel(); return result; } catch(e){return {url,status:null,ok:false,error:e.name,ms:Date.now()-start};}}
await Promise.all(Array.from({length:6},async()=>{while(cursor<urls.length){const url=urls[cursor++]; checks.push(await check(url));}}));
const report={checkedAt:new Date().toISOString(),packages:rows.length,sourceAssignments:rows.reduce((n,r)=>n+r.sources.length,0),uniqueUrls:urls.length,reachable:checks.filter(c=>c.ok).length,unreachable:checks.filter(c=>!c.ok).length,checks,rows:rows.map(r=>({id:r.id,slug:r.slug,sources:r.sources.map(s=>({url:s.url,organization:s.organization,currentnessStatus:s.currentnessStatus,applicability:s.applicability}))}))};
await fs.writeFile(process.argv[process.argv.indexOf('--output') + 1] || '/tmp/readines-source-links.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({packages:report.packages,sourceAssignments:report.sourceAssignments,uniqueUrls:report.uniqueUrls,reachable:report.reachable,unreachable:report.unreachable,failures:checks.filter(c=>!c.ok)}));
