import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,rename,mkdir,rm,mkdtemp,writeFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {browserFixture,keyboard,rehearsalStartup} from '../helpers/browser.mjs';
import {until} from '../helpers/runtime.mjs';
import {pick,DRAFT} from '../fixtures/sleeper.mjs';
import {rankingsFixture,rankingsHtml} from '../fixtures/rankings.mjs';
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true});});
test.after(async()=>{await browser?.close();});
test('keyboard Refresh uses real bounded POST and observes the board without bypassing inflight or retry limits',async t=>{
 const f=await browserFixture(t,browser);await f.open();const control=f.page.getByRole('button',{name:'Refresh',exact:true});
 assert.equal(await control.count(),1);
 assert.equal(await f.page.locator('main').getAttribute('aria-busy'),'false');
 const held=f.hold(f.picksPath),count=f.requests.filter(r=>r.url===f.picksPath).length;
 try{
  await keyboard(control);await held.entered;
  await until(()=>f.appRequests.some(r=>r.path==='/api/refresh'&&r.complete));
  assert.equal(f.appRequests.find(r=>r.path==='/api/refresh').status,202);
  assert.deepEqual(f.appRequests.find(r=>r.path==='/api/refresh').body,{});
  await keyboard(control);await until(()=>f.appRequests.filter(r=>r.path==='/api/refresh'&&r.complete).length===2);
  assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,count+1);
 }finally{held.release();}
 await until(()=>!f.session.getBoard().refresh.inflight);await f.read();
 const last=f.session.getBoard().viewRevision;assert.ok(Number(await f.page.locator('body').getAttribute('data-view'))>=last);
 f.responses.set(f.picksPath,{status:500});await keyboard(control);await until(()=>f.session.getBoard().refresh.failures===1);await f.read();
 assert.match(await f.page.locator('#draft-status').textContent(),/failed.*500/i);
 const failedCount=f.requests.filter(r=>r.url===f.picksPath).length;
 await keyboard(control);await until(()=>f.appRequests.filter(r=>r.path==='/api/refresh'&&r.complete).length===4);
 assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,failedCount);assert.ok(f.requests.every(r=>r.method==='GET'));
});
const cards=page=>page.locator('#candidates .candidate');
const own=(page,id)=>page.locator(`#players [data-player-id="${id}"] button[data-action="my-pick"]`);
async function search(page,text){await page.getByLabel('Search players').fill(text);}
async function next(page,value){await page.waitForFunction(v=>document.querySelector('#next-picks').textContent===v,value);}

test('Chromium1: actual preparation, search/details and keyboard own1/28/29, opponent removal, taken/Undo and once-only confirmation',async t=>{
 const f=await browserFixture(t,browser);await f.open();assert.equal(await f.page.locator('#league').textContent(),'Fictional league');
 assert.match(await f.page.locator('#league-summary').textContent(),/14 teams.*half-PPR.*13 rounds/i);assert.equal(await cards(f.page).count(),3);await next(f.page,'1 · 28');
 await search(f.page,'Fictional QB 0');await f.page.getByLabel('Position').selectOption('QB');
 assert.deepEqual(await f.page.locator('#players tr').evaluateAll(rows=>rows.map(row=>row.dataset.playerId)),['10001']);
 await search(f.page,'');assert.equal(await f.page.locator('#players [data-player-id="10041"]').count(),0);assert.equal(await f.page.locator('#players [data-player-id="10002"]').count(),1);
 await search(f.page,'Fictional QB 0');
 await keyboard(f.page.locator('#players [data-player-id="10001"] button[data-details]'));
 assert.match(await f.page.getByRole('dialog').textContent(),/Sleeper half-PPR projection\s*0/);assert.match(await f.page.getByRole('dialog').textContent(),/Prior actual points\s*90/);
 assert.match(await f.page.getByRole('dialog').textContent(),/Not reported/);await f.page.getByRole('button',{name:'Close details'}).click();
 await f.page.getByLabel('Position').selectOption('ALL');await search(f.page,'Fictional RB 0');await keyboard(own(f.page,'10041'));await next(f.page,'28 · 29');
 f.routes[f.picksPath]=[pick(1,'10041')];await f.session.refresh();await f.read();
 const removed=f.session.getBoard().candidates[0].playerId;
 f.routes[f.picksPath]=[pick(1,'10041'),pick(2,removed),...Array.from({length:25},(_,i)=>pick(i+3,String(10200+i)))];await f.session.refresh();await f.read();
 assert.equal(await f.page.locator(`#candidates [data-player-id="${removed}"]`).count(),0);
 await search(f.page,'Fictional WR 0');await keyboard(own(f.page,'10151'));await next(f.page,'29 · 56');
 assert.match(await f.page.locator('#own-roster').textContent(),/Fictional WR 0/);assert.equal(f.session.getBoard().draft.officialCount,27);
 assert.deepEqual(await cards(f.page).evaluateAll(items=>items.map(e=>e.dataset.playerId)),f.session.getBoard().candidates.map(c=>c.playerId));
 assert.equal(await f.page.locator('#candidates [data-player-id="10151"]').count(),0);assert.equal(await cards(f.page).count(),3);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).corrections.filter(c=>c.playerId==='10151').length,1);
 f.routes[f.picksPath].push(pick(28,'10151'));await f.session.refresh();await f.read();
 assert.equal(await f.page.locator('#own-roster [data-player-id="10151"]').count(),1);assert.equal(f.session.getBoard().corrections.length,0);
 await search(f.page,'Fictional WR 1');await keyboard(own(f.page,'10152'));await next(f.page,'56 · 57');
 f.routes[f.picksPath].push(pick(29,'10152'));await f.session.refresh();await f.read();assert.equal(f.session.getBoard().ownRoster.length,3);
 await search(f.page,'Fictional RB 1');await keyboard(f.page.locator('#players [data-player-id="10042"] button[data-action="taken"]'));
 await f.page.getByRole('button',{name:/Undo Marked taken.*Fictional RB 1/}).waitFor();await keyboard(f.page.getByRole('button',{name:/Undo Marked taken.*Fictional RB 1/}));
 await f.page.waitForFunction(()=>document.querySelector('#corrections').textContent.includes('No local corrections'));
 assert.ok(f.requests.every(r=>r.method==='GET'));assert.deepEqual(f.consoleErrors,[]);
});
test('Chromium2: upstream and app connection failure retain cards, recover metadata, and respect active/completed freshness',async t=>{
 const f=await browserFixture(t,browser,{allowedConsoleErrors:[/net::ERR_INTERNET_DISCONNECTED/]});await f.open();assert.equal(await f.page.locator('#league').textContent(),'Fictional league');
 const original=await cards(f.page).allTextContents(),revision=f.session.getBoard().revision;
 f.responses.set(f.picksPath,{status:500});await f.session.refresh();await f.read();assert.match(await f.page.locator('#draft-status').textContent(),/failed.*500/i);assert.deepEqual(await cards(f.page).allTextContents(),original);
 f.responses.clear();await f.clock.advance(10000);await until(()=>!f.session.getBoard().refresh.inflight);await f.page.clock.runFor(10000);await f.read();
 assert.match(await f.page.locator('#draft-status').textContent(),/checked.*Sleeper may lag/i);assert.equal(f.session.getBoard().revision,revision);
 await f.context.setOffline(true);await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.getByText(/App connection lost/).waitFor();assert.deepEqual(await cards(f.page).allTextContents(),original);
 await f.page.clock.runFor(3000);assert.match(await f.page.locator('#last-check').textContent(),/3s ago/);
 await f.context.setOffline(false);await f.read();assert.doesNotMatch(await f.page.locator('#draft-status').textContent(),/connection lost/i);
 f.c.draft.status='complete';await f.session.refresh();await f.read();
 for(let i=0;i<2;i++){await f.clock.advance(30000);await until(()=>!f.session.getBoard().refresh.inflight);await f.page.clock.runFor(30000);await f.read();assert.doesNotMatch(await f.page.locator('#draft-status').textContent(),/overdue/i);}
 f.responses.set(f.picksPath,{status:500});await f.session.refresh();await f.read();assert.match(await f.page.locator('#draft-status').textContent(),/failed/i);
 assert.equal(f.session.getBoard().revision,revision);assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('Chromium3: exact rollback, HTTP errors, held read/action races, focus coalescing and session transitions',async t=>{
 const f=await browserFixture(t,browser,{allowedConsoleErrors:[/status of (409|422|500)/]});await f.open();assert.equal(await f.page.locator('#league').textContent(),'Fictional league');
 const input=f.page.getByLabel('Search players');await input.fill('Fictional RB 0');await input.focus();await f.session.refresh();await f.read();assert.equal(await input.evaluate(e=>e===document.activeElement),true);
 const gate=f.holdApp(),count=f.appRequests.filter(r=>r.path==='/api/board').length;
 await f.page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});await gate.entered.promise;
 await f.page.clock.runFor(2000);assert.equal(f.appRequests.filter(r=>r.path==='/api/board').length,count+1);gate.release.release();await f.settle();
 await f.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 const hidden=f.appRequests.length;await f.page.clock.runFor(1000);assert.equal(f.appRequests.length,hidden);
 const visible=f.holdApp();await f.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});await visible.entered.promise;
 assert.equal(f.appRequests.length,hidden+1);visible.release.release();await f.settle();
 // Older GET cannot replace the newly committed action.
 const older=f.holdApp();await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await older.entered.promise;
 await keyboard(own(f.page,'10041'));await next(f.page,'28 · 29');older.release.release();await f.settle();await next(f.page,'28 · 29');
 // Action N is held before HTTP consumption. Metadata GET N+1 arrives first; newer same-session action still wins.
 await search(f.page,'Fictional WR 0');const action=f.holdApp('/api/actions','POST','request');await keyboard(own(f.page,'10151'));await action.entered.promise;
 await f.session.refresh();await f.read();const metadataView=f.session.getBoard().viewRevision;
 // The action response must update the display before its follow-up GET can repair it.
 const postAction=f.holdApp('/api/board','GET','request');
 try{
  action.release.release();await postAction.entered.promise;
  await next(f.page,'29 · 56');assert.ok(Number(await f.page.locator('body').getAttribute('data-view'))>metadataView);
 }finally{postAction.release.release();}
 // Restart B supplies a never-applied GET; restart C supplies a newer action with a lower view counter.
 await f.settle();const priorSessionView=Number(await f.page.locator('body').getAttribute('data-view'));await f.restart();const unseen=f.holdApp();await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await unseen.entered.promise;
 await f.restart();const currentSession=f.session.getBoard().sessionId;await search(f.page,'Fictional RB 1');await keyboard(f.page.locator('#players [data-player-id="10042"] button[data-action="taken"]'));
 await f.page.waitForFunction(id=>document.body.dataset.session===id,currentSession);assert.ok(Number(await f.page.locator('body').getAttribute('data-view'))<priorSessionView);
 unseen.release.release();await f.settle();assert.equal(await f.page.locator('body').getAttribute('data-session'),currentSession);
 // A known retired session response is also ignored after restart.
 const retired=f.holdApp();await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await retired.entered.promise;await f.restart();await search(f.page,'Fictional RB 2');await keyboard(f.page.locator('#players [data-player-id="10043"] button[data-action="taken"]'));
 const newest=f.session.getBoard().sessionId;await f.page.waitForFunction(id=>document.body.dataset.session===id,newest);retired.release.release();await f.settle();assert.equal(await f.page.locator('body').getAttribute('data-session'),newest);
 //409 refetches but never replays the action;422 and disk failure never show saved success.
 await search(f.page,'Fictional RB 3');await f.session.act({expectedRevision:f.session.getBoard().revision,action:{type:'taken',playerId:'10044'}});
 const posts=f.appRequests.filter(r=>r.method==='POST').length;await keyboard(f.page.locator('#players [data-player-id="10044"] button[data-action="taken"]'));
 await f.page.getByText(/not saved.*obsolete/i).waitFor();await f.settle();assert.equal(f.appRequests.filter(r=>r.method==='POST').length,posts+1);
 await search(f.page,'Fictional RB 4');f.c.league.scoring_settings.rush_yd=0.25;await f.session.refresh({context:true});
 await keyboard(own(f.page,'10045'));await f.page.getByText(/not saved.*Invalid local/i).waitFor();
 const bytes=await readFile(f.file);await rename(f.file,f.file+'.retained');await mkdir(f.file);await keyboard(f.page.locator('#players [data-player-id="10045"] button[data-action="taken"]'));
 await f.page.getByText(/not saved.*Unable to save/i).waitFor();assert.deepEqual(await readFile(f.file+'.retained'),bytes);await rm(f.file,{recursive:true});await rename(f.file+'.retained',f.file);
 // Use a fresh compatible session fixture for pending diff; C1 invalidation deliberately remains sticky.
 const g=await browserFixture(t,browser,{allowedConsoleErrors:[/status of 409/]});g.routes[g.picksPath]=[pick(1,'10041'),pick(2,'10042')];await g.session.refresh();await g.open();
 g.routes[g.picksPath]=[pick(1,'10041')];await g.session.refresh();await g.read();const oldToken=g.session.getBoard().pending.revision;
 assert.match(await g.page.locator('#pending').textContent(),/pick 2/i);g.routes[g.picksPath]=[];await g.session.refresh();
 await keyboard(g.page.getByRole('button',{name:'Use this Sleeper board'}));await g.page.getByText(/not saved.*obsolete/i).waitFor();await g.read();assert.ok(g.session.getBoard().pending.revision>oldToken);
 await keyboard(g.page.getByRole('button',{name:'Use this Sleeper board'}));await next(g.page,'1 · 28');assert.equal(g.session.getBoard().pending,null);
});
test('Chromium4: provider strings are text, unknown versus empty is visible, named controls and two pages share one poller',async t=>{
 const malicious='<img src=x onerror="window.providerExecuted=true">';
 const f=await browserFixture(t,browser,{unknown:true,configure:u=>{u.s.players['10001'].full_name=malicious;u.routes['/ecr']=rankingsHtml(rankingsFixture(u.s.players));}});
 assert.equal(f.source.playersById['10001'].name,malicious);assert.equal(f.session.getBoard().draft.availabilityKnown,false);
 const held=f.hold(f.picksPath);const refresh=f.session.refresh();await held.entered;
 try{await f.open();assert.equal(await f.page.locator('#league').textContent(),'Fictional league');
 assert.match(await f.page.locator('#draft-status').textContent(),/availability is unknown/i);assert.equal(await cards(f.page).count(),0);
 }finally{held.release();await refresh;}
 await f.read();await next(f.page,'1 · 28');assert.equal(await cards(f.page).count(),3);
 await search(f.page,'<img');assert.equal(await f.page.locator('#players [data-player-id="10001"] .player-name').textContent(),malicious);
 assert.equal(await f.page.locator('#players img').count(),0);assert.equal(await f.page.evaluate(()=>window.providerExecuted),undefined);
 const unnamed=await f.page.locator('button').evaluateAll(items=>items.filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length);assert.equal(unnamed,0);
 const second=await f.context.newPage();await second.goto(f.base);await second.locator('body[data-ready="true"]').waitFor();
 const count=f.requests.filter(r=>r.url===f.picksPath).length;await f.clock.advance(4999);assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,count);
 await f.clock.advance(1);await until(()=>!f.session.getBoard().refresh.inflight);assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,count+1);
 assert.equal(await cards(second).count(),3);assert.ok(f.requests.every(r=>r.method==='GET'));assert.deepEqual(f.consoleErrors,[]);
});
test('actual rehearsal CLI Enter/quit uses isolated files and selected own players through0/1/27/28/29',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'fantasy-rehearsal-cli-'));t.after(()=>rm(cwd,{recursive:true,force:true}));await mkdir(join(cwd,'.local'));await writeFile(join(cwd,'.local','sentinel'),'live untouched');
 const child=spawn(process.execPath,[new URL('../../scripts/rehearse.mjs',import.meta.url).pathname],{cwd,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null){child.stdin.write('q\n');await exited;}});
 let startup=null;await until(()=>(startup=rehearsalStartup(out))||child.exitCode!==null);assert.match(out,/REHEARSAL/);
 assert.ok(startup,err||out);
 const {url,directory}=startup;assert.notEqual(directory,join(cwd,'.local'));
 const context=await browser.newContext(),page=await context.newPage(),browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text());});t.after(()=>context.close());await page.goto(url);await page.locator('body[data-ready="true"]').waitFor();assert.match(await page.locator('#league').textContent(),/^REHEARSAL/);
 page.setDefaultTimeout(5000);
 child.stdin.write('\n');await until(()=>out.includes('Record own pick 1 before advancing'));
 for(const [id,label,stage,following] of [['10041','Fictional RB 0',1,'28 · 29'],['10155','Fictional WR 4',28,'29 · 56'],['10156','Fictional WR 5',29,'56 · 57']]){
  await search(page,label);await keyboard(own(page,id));await next(page,following);child.stdin.write('\n');await until(()=>out.includes(`Stage ${stage}:`));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(n=>document.querySelector('#observed').textContent.startsWith(`${n} observed`),stage);
  const saved=JSON.parse(await readFile(join(directory,'drafts',DRAFT,'session.json'),'utf8'));assert.equal(saved.accepted.picks.find(p=>p.pickNo===stage).playerId,id);
  if(stage===1){child.stdin.write('\n');await until(()=>out.includes('Stage 27:'));const saved27=JSON.parse(await readFile(join(directory,'drafts',DRAFT,'session.json'),'utf8'));assert.equal(saved27.accepted.picks[1].playerId,'10001');
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('#observed').textContent.startsWith('27 observed'));}
 }
 child.stdin.write('q\n');const [code]=await exited;assert.equal(code,0,err);assert.equal(err,'');assert.deepEqual(browserErrors,[]);assert.equal(await readFile(join(cwd,'.local','sentinel'),'utf8'),'live untouched');await assert.rejects(stat(directory),{code:'ENOENT'});
 const audit=JSON.parse(out.match(/REHEARSAL_AUDIT (.+)/)[1]);assert.ok(audit.requests.length>0);assert.ok(audit.requests.every(r=>r.method==='GET'));assert.match(audit.upstream.apiBase,/^http:\/\/127\.0\.0\.1:/);
});
