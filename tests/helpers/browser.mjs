import assert from 'node:assert/strict';
import {once} from 'node:events';
import {runtimeFixture,barrier,until} from './runtime.mjs';
import {openSession} from '../../src/session.mjs';
import {createApp} from '../../src/server.mjs';
import {NOW} from '../fixtures/sleeper.mjs';

export async function browserFixture(t,browser,options={}){
 const f=await runtimeFixture(t,options);let session=await openSession({...f.options,autoRefresh:false});
 if(!options.unknown)await session.refresh();
 let app=createApp({session});app.listen(0,'127.0.0.1');await once(app,'listening');const port=app.address().port,base=`http://127.0.0.1:${port}`;
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
 page.setDefaultTimeout(5000);
 await page.clock.install({time:new Date(NOW)});await page.clock.pauseAt(new Date(NOW));
 const errors=[],consoleErrors=[],requests=[],gates=[],allGates=[];
 const records=new WeakMap();
 page.on('requestfinished',request=>{const record=records.get(request);if(record)record.complete=true;});
 page.on('requestfailed',request=>{const record=records.get(request);if(record){record.complete=true;record.error=request.failure()?.errorText;}});
 page.on('response',response=>{const record=records.get(response.request());if(record)record.status=response.status();});
 const observe=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});};
 observe(page);context.on('page',observe);
 await page.route('**/api/**',async route=>{
  const request=route.request(),record={path:new URL(request.url()).pathname,method:request.method(),body:request.postDataJSON(),complete:false};requests.push(record);records.set(request,record);
  const index=gates.findIndex(g=>g.path===record.path&&g.method===record.method),gate=index<0?null:gates.splice(index,1)[0];
  try{
   if(!gate){await route.continue();return;}
   if(gate?.phase==='request'){gate.entered.release();await gate.release.promise;}
   const response=await route.fetch();await response.body();
   if(gate?.phase==='response'){gate.response=response;gate.entered.release();await gate.release.promise;}
   await route.fulfill({response});record.complete=true;
  }catch(e){record.error=e.message;await route.abort().catch(()=>{});record.complete=true;}
 });
 function holdApp(path='/api/board',method='GET',phase='response'){
  const gate={path,method,phase,entered:barrier(),release:barrier()};gates.push(gate);allGates.push(gate);return gate;
 }
 t.after(async()=>{
  for(const g of allGates)g.release.release();await context.close();await app.shutdown();assert.deepEqual(errors,[]);
  assert.deepEqual(consoleErrors.filter(message=>!(options.allowedConsoleErrors??[]).some(pattern=>pattern.test(message))),[]);
  if(consoleErrors.length)t.diagnostic(`Expected browser failure exercise: ${JSON.stringify(consoleErrors)}`);
 });
 return {...f,context,page,base,appRequests:requests,errors,consoleErrors,holdApp,get session(){return session;},
  open:async()=>{await page.goto(base);await page.locator('body[data-ready="true"]').waitFor();},
  read:async()=>{
   const expected=session.getBoard();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await page.waitForFunction(b=>document.body.dataset.session===b.sessionId&&Number(document.body.dataset.view)>=b.viewRevision,expected);
  },
  restart:async()=>{await app.shutdown();session=await openSession({...f.options,autoRefresh:false});app=createApp({session});app.listen(port,'127.0.0.1');await once(app,'listening');return session;},
  settle:async()=>{await page.locator('main[aria-busy="false"]').waitFor();await until(()=>requests.every(r=>r.complete));}};
}
export async function keyboard(button){await button.focus();await button.press('Enter');}

export function rehearsalStartup(output){
 const match=output.match(/^Open (http:\/\/127\.0\.0\.1:\d+)\r?\nPrivate rehearsal state: ([^\r\n]+)\r?\n/m);
 return match?{url:match[1],directory:match[2]}:null;
}
