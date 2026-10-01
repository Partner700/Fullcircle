const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const browserRequire = process.env.PLAYWRIGHT_MODULE_ROOT ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json')) : require;
const { chromium } = browserRequire('playwright-core');
const fixture = `
import React, {useState, useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {useMessageHistory} from '/src/hooks/useMessageHistory.ts';
window.messageTest = {total:100, calls:[], fail:false, delay:20};
const message = (index, room) => ({id:'00000000-0000-0000-0000-'+String(index).padStart(12,'0'),created_at:new Date(1700000000000+index*1000).toISOString(),body:room+' message '+index,sender_id:'test'});
function Harness() {
  const [room,setRoom]=useState('A');
  const [draft,setDraft]=useState('');
  const loadPage=useCallback(async options=>{
    const state=window.messageTest;
    state.calls.push({room,...options});
    await new Promise(resolve=>setTimeout(resolve,state.delay));
    if(state.fail) throw Error('Offline');
    let rows=Array.from({length:state.total},(_,i)=>message(i+1,room));
    if(options.before) rows=rows.filter(row=>row.id<options.before.id);
    if(options.after) rows=rows.filter(row=>row.id>options.after.id);
    if(!options.after) rows.reverse();
    const page=rows.slice(0,20);
    return {messages:options.after?page:page.reverse(),hasMore:rows.length>20};
  },[room]);
  const history=useMessageHistory(loadPage,true);
  return <main style={{maxWidth:480,margin:'auto',fontFamily:'sans-serif'}}>
    <h1>Messages</h1><output data-testid="count">{history.messages.length}</output>
    <button disabled={history.loadingOlder || !history.hasOlder} onClick={()=>history.loadOlder()}>Earlier messages</button>
    <button onClick={()=>history.refresh()}>Refresh</button>
    <button onClick={()=>setRoom('B')}>Other conversation</button>
    <button onClick={()=>history.update(history.messages[0].id,{body:'Edited message'})}>Edit first</button>
    {history.error && <p role="alert">{history.error}</p>}
    <div style={{height:300,overflow:'auto'}}>{history.messages.map(row=><p data-message key={row.id}>{row.body}</p>)}</div>
    <label>Message<input value={draft} onChange={event=>setDraft(event.target.value)}/></label>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`;

(async () => {
  const {createServer,transformWithEsbuild}=await import('vite');
  const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},plugins:[{
    name:'message-pages-test',enforce:'pre',
    resolveId(id){ if(id==='/message-test.jsx') return '\0message-test'; },
    async load(id){ if(id==='\0message-test') return (await transformWithEsbuild(fixture,'message-test.jsx',{loader:'jsx'})).code; },
    configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/message-test') return next(); res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/message-test.jsx"></script>');});},
  }]});
  let browser;
  try {
    await server.listen();
    browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    for(const width of [390,1280]) {
      const page=await browser.newPage({viewport:{width,height:844}});
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/message-test');
      await page.waitForFunction(()=>document.querySelector('[data-testid=count]')?.textContent==='20');
      assert.equal(await page.locator('[data-message]').first().textContent(),'A message 81');
      await page.getByRole('textbox').fill('An unfinished reply');
      await page.getByRole('button',{name:'Earlier messages',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-testid=count]')?.textContent==='40');
      assert.equal(await page.locator('[data-message]').first().textContent(),'A message 61');
      await page.evaluate(()=>{window.messageTest.total=125;});
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-testid=count]')?.textContent==='65');
      assert.equal(await page.getByRole('textbox').inputValue(),'An unfinished reply');
      const calls=await page.evaluate(()=>window.messageTest.calls);
      assert.equal(calls.length,4,'Initial page, older page, and two incremental catch-up pages');
      assert.ok(calls[1].before); assert.ok(calls[2].after); assert.ok(calls[3].after);
      await page.getByRole('button',{name:'Edit first'}).click();
      assert.equal(await page.locator('[data-message]').first().textContent(),'Edited message');
      await page.evaluate(()=>{window.messageTest.fail=true;});
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.locator('[data-message]').count(),65,'A failed refresh retains messages');
      await page.evaluate(()=>{window.messageTest.fail=false;window.messageTest.delay=150;});
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await page.getByRole('button',{name:'Other conversation'}).click();
      await page.waitForFunction(()=>document.querySelector('[data-message]')?.textContent==='B message 106');
      assert.equal(await page.locator('[data-message]').count(),20,'An old request cannot populate another conversation');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:'/tmp/fullcircle-message-pages-'+width+'.png'});
      await page.close();
      console.log('Message pagination, catch-up, drafts, edits, errors and conversation isolation passed at '+width+'px');
    }
  } finally {if(browser) await browser.close(); await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
