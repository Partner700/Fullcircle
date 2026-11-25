// Stage-only Arena spectator pressure test. Requires a seeded, open, dedicated
// staging match and synthetic staging user credentials (never real users).
// Read-only gameplay state is sampled while spectators enter via the same RPC
// as the website. Manually move a staging player during the test to verify
// that turns remain responsive; this script never fabricates game moves.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base=(process.env.FULL_CIRCLE_STAGING_SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.FULL_CIRCLE_STAGING_PUBLISHABLE_KEY||'';
const accountsPath=process.env.FULL_CIRCLE_TEST_ACCOUNTS_FILE||'';
const room=process.env.FULL_CIRCLE_STAGING_ARENA_ROOM_ID||'';
assert.equal(process.env.FULL_CIRCLE_ALLOW_STAGING_TEST,'yes');
assert.match(base,/^https:\/\/[a-z0-9-]+\.supabase\.co$/i);
for(const id of ['ovusyeqbmtvfcrlflrbf','nffqohxdelaglrmuzjwb'])assert.ok(!base.includes(id),'Production refused');
assert.match(room,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,'Staging match UUID required');
assert.ok(key && accountsPath);
const users=JSON.parse(await readFile(accountsPath,'utf8'));
const waves=(process.env.LOAD_CHECK_USERS||'10,25,50').split(',').map(x=>Number(x)).filter(x=>Number.isInteger(x)&&x>0&&x<=100);
assert.ok(waves.length&&users.length>=Math.max(...waves),'Distinct staging witness accounts required');
const seen=new Set();
for(const x of users){assert.ok(x.email&&x.password&& !seen.has(x.email));seen.add(x.email);}
const timeoutMs=22000;
async function request(url, init={}){
 const timer=new AbortController();const id=setTimeout(()=>timer.abort(),timeoutMs);const started=performance.now();
 try{
   const r=await fetch(base+url,{...init,signal:timer.signal,headers:{apikey:key,...init.headers}});
   const data=await r.json().catch(()=>null);
   return {ok:r.ok,code:r.status,ms:Math.round(performance.now()-started),data};
 }catch(e){return {ok:false,code:e?.name==='AbortError'?'timeout':'network',ms:Math.round(performance.now()-started)};}
 finally{clearTimeout(id);}
}
async function login(user){
 return request('/auth/v1/token?grant_type=password',{
 method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({email:user.email,password:user.password})});
}
async function join(token){
 const headers={Authorization:'Bearer '+token,'content-type':'application/json'};
 const watched=await request('/rest/v1/rpc/watch_arena_room',{method:'POST',headers,body:JSON.stringify({p_room_id:room})});
 if(!watched.ok)return {ok:false,code:watched.code,ms:watched.ms};
 const checked=await request('/rest/v1/arena_rooms?id=eq.'+room+'&select=id,status',{headers});
 return {ok:checked.ok,code:checked.code,ms:watched.ms+checked.ms};
}
const records=[];
for(const count of waves){
 const batch=users.slice(0,count);
 const authorized=await Promise.all(batch.map(login));
 const failures=authorized.filter(x=>!x.ok||!x.data?.access_token);
 if(failures.length){
   records.push({spectators:count,phase:'login',failures:failures.length,codes:failures.map(x=>x.code).slice(0,5)});break;
 }
 const joined=await Promise.all(authorized.map(x=>join(x.data.access_token)));
 const times=joined.map(x=>x.ms).sort((a,b)=>a-b);
 const bad=joined.filter(x=>!x.ok);
 records.push({spectators:count,joined:count-bad.length,failures:bad.length,p95_ms:times[Math.ceil(times.length*.95)-1],
    max_ms:times.at(-1),error_codes:bad.reduce((a,x)=>(a[x.code]=(a[x.code]||0)+1,a),{})});
 if(bad.length)break;await new Promise(r=>setTimeout(r,1500));
}
console.log(JSON.stringify({staging:true,room_id:room,results:records},null,2));
if(records.some(r=>r.failures))process.exitCode=1;
