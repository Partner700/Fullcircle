// Stage-only concurrent calls through GoTrue's real password-token endpoint.
// Test usernames are non-existent; 400/422 is expected. This reveals auth gateway
// throttling/timeouts but does NOT validate successful password sign-ins.
// No credentials, real user accounts, or production traffic are involved.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=(process.env.FULL_CIRCLE_STAGING_SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.FULL_CIRCLE_STAGING_PUBLISHABLE_KEY||'';
assert.equal(process.env.FULL_CIRCLE_ALLOW_STAGING_TEST,'yes');
assert.match(base,/^https:\/\/[a-z0-9-]+\.supabase\.co$/i);
for (const id of ['ovusyeqbmtvfcrlflrbf','nffqohxdelaglrmuzjwb'])
  assert.ok(!base.includes(id),'Production project refused');
assert.ok(key && /^sb_publishable_|^eyJ/.test(key));
const sizes=(process.env.LOAD_CHECK_USERS||'10,25,50').split(',').map(Number);
assert.ok(sizes.length>0&&sizes.every(n=>Number.isInteger(n)&&n>0&&n<=100));
async function rejectPassword() {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),35_000);
  const started=performance.now();
  try {
    const res=await fetch(base+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:{apikey:key,'content-type':'application/json'},
      body:JSON.stringify({email:'no-such-user-'+randomUUID()+'@example.invalid',password:randomUUID()}),
      signal:controller.signal
    });
    return {ok:res.status===400||res.status===422,status:res.status,ms:Math.round(performance.now()-started)};
  } catch (err) {
    return {ok:false,status:err?.name==='AbortError'?'timeout':'network',ms:Math.round(performance.now()-started)};
  } finally {clearTimeout(timeout);}
}
const results=[];
for(const count of sizes){
  const wave=await Promise.all(Array.from({length:count},rejectPassword));
  const latency=wave.map(v=>v.ms).sort((a,b)=>a-b);
  const failures=wave.filter(v=>!v.ok);
  results.push({parallel_password_attempts:count,expected_rejections:count-failures.length,
    failures:failures.length,p95_ms:latency[Math.ceil(count*.95)-1],
    max_ms:latency.at(-1),unexpected_statuses:failures.reduce((a,v)=>(a[v.status]=(a[v.status]||0)+1,a),{})});
  if(failures.length)break;await new Promise(resolve=>setTimeout(resolve,1000));
}
console.log(JSON.stringify({staging:true,tests:'nonexistent-user auth token rejection',results},null,2));
if(results.some(v=>v.failures))process.exitCode=1;
