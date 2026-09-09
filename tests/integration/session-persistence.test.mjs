import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,rm,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {watch} from 'node:fs';
import {openSession} from '../../src/session.mjs';
import {runtimeFixture,barrier,until} from '../helpers/runtime.mjs';
import {pick} from '../fixtures/sleeper.mjs';
import {createApp} from '../../src/server.mjs';

async function child(code,args=[]){
 const p=spawn(process.execPath,['--input-type=module','-e',code,...args],{stdio:['ignore','pipe','pipe']});let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const [exit]=await once(p,'exit');assert.equal(exit,0,err);return out;
}
test('save/close/restart restores picks, revision and corrections stale with a new presentation identity; confirmation is once-only',async t=>{
 const f=await runtimeFixture(t);f.routes[f.picksPath]=[pick(1,'10041')];let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 await session.refresh();await session.act({expectedRevision:session.getBoard().revision,action:{type:'my-pick',pickNo:28,playerId:'10151'}});
 assert.equal(session.getBoard().corrections.length,1);
 const before=session.getBoard(),disk=JSON.parse(await readFile(f.file,'utf8'));
 assert.equal(disk.revision,before.revision);assert.equal(disk.accepted.picks.length,1);assert.equal(disk.corrections.length,1);
 assert.equal('sessionId' in disk,false);assert.equal('viewRevision' in disk,false);assert.equal('playersById' in disk,false);
 await session.close();await assert.rejects(readFile(f.lock),{code:'ENOENT'});
 session=await openSession({...f.options,autoRefresh:false});const restored=session.getBoard();
 assert.notEqual(restored.sessionId,before.sessionId);assert.equal(restored.viewRevision,0);assert.equal(restored.revision,before.revision);
 assert.equal(restored.freshness.stale,true);assert.deepEqual(restored.nextPicks,[29,56]);assert.equal(restored.draft.officialCount,1);
 assert.deepEqual(restored.corrections,before.corrections);assert.deepEqual(restored.ownRoster.map(p=>p.id),['10041','10151']);
 const rows=[pick(1,'10041'),...Array.from({length:26},(_,i)=>pick(i+2,String(10200+i))),pick(28,'10151')];
 f.routes[f.picksPath]=rows;await session.refresh();await session.refresh();
 assert.equal(session.getBoard().corrections.length,0);assert.equal(session.getBoard().ownRoster.filter(p=>p.id==='10151').length,1);
 assert.equal(session.getBoard().notices.filter(n=>n.code==='confirmed').length,1);assert.equal(session.getBoard().freshness.stale,false);
});
test('a second real session process is refused without touching saved data or the live owner lock',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());await session.refresh();
 const bytes=await readFile(f.file),lock=await readFile(f.lock),module=new URL('../../src/session.mjs',import.meta.url).href;
 const writes=[],watcher=watch(f.sessionDirectory,(_event,name)=>writes.push(name));t.after(()=>watcher.close());
 const output=await child(`import {openSession} from ${JSON.stringify(module)};try {const s=await openSession({dataDirectory:process.argv[1],autoRefresh:false});await s.close();console.log('unexpected owner');}catch(e){console.log(e.code);}`,[f.dir]);
 assert.equal(output.trim(),'LOCKED');assert.deepEqual(await readFile(f.file),bytes);assert.deepEqual(await readFile(f.lock),lock);
 watcher.close();
 assert.deepEqual(writes,[],'refusing a live owner must not create even a temporary recovery lock');
});
test('live PID ownership blocks, a proven dead owned child PID recovers, and close preserves a replacement lock',async t=>{
 const f=await runtimeFixture(t),p=spawn(process.execPath,['-e',"process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(p.exitCode===null&&p.signalCode===null){p.kill();await once(p,'exit');}});await once(p,'message');
 await mkdir(f.sessionDirectory,{recursive:true});const lock=JSON.stringify({pid:p.pid,token:'owned-child'});await writeFile(f.lock,lock);
 await assert.rejects(openSession({...f.options,autoRefresh:false}),e=>e.code==='LOCKED');assert.equal(await readFile(f.lock,'utf8'),lock);
 p.kill();await once(p,'exit');const session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 assert.equal(JSON.parse(await readFile(f.lock,'utf8')).pid,process.pid);
 const replacement=JSON.stringify({pid:process.pid,token:'replacement-owner'});await writeFile(f.lock,replacement);await session.close();
 assert.equal(await readFile(f.lock,'utf8'),replacement);
});
test('corrupt JSON, schema, configuration and invalid saved picks/corrections preserve bytes and require explicit recovery',async t=>{
 const f=await runtimeFixture(t);let session=await openSession({...f.options,autoRefresh:false});await session.refresh();await session.close();
 const valid=JSON.parse(await readFile(f.file,'utf8'));
 const cases=['{broken',JSON.stringify({...valid,schemaVersion:99}),JSON.stringify({...valid,configFingerprint:'other'}),
  JSON.stringify({...valid,accepted:{...valid.accepted,picks:[{pickNo:2,round:1,draftSlot:2,playerId:'10001',rosterId:'5',pickedBy:''}]}}),
  JSON.stringify({...valid,corrections:[{id:'local-1',type:'my-pick',pickNo:28,playerId:'unknown'}]})];
 for(const bytes of cases){
  await writeFile(f.file,bytes);session=await openSession({...f.options,autoRefresh:false});
  try{assert.equal(session.getBoard().error.code,'RECOVERY_REQUIRED');assert.equal(session.getBoard().players.length,400);
   assert.equal(session.getBoard().draft.availabilityKnown,false);await session.refresh();
   await assert.rejects(session.act({expectedRevision:session.getBoard().revision,action:{type:'taken',playerId:'10041'}}),e=>e.code==='RECOVERY_REQUIRED');
   assert.equal(await readFile(f.file,'utf8'),bytes);
  }finally{await session.close();}
 }
});
test('real destination/rename conflict prevents acknowledgement and retains prior durable revision/corrections',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());await session.refresh();
 const before=session.getBoard(),bytes=await readFile(f.file);await rename(f.file,f.file+'.retained');await mkdir(f.file);
 await assert.rejects(session.act({expectedRevision:before.revision,action:{type:'taken',playerId:'10041'}}),e=>e.code==='PERSISTENCE_FAILED'&&e.status===500);
 assert.equal(session.getBoard().revision,before.revision);assert.deepEqual(session.getBoard().corrections,before.corrections);assert.deepEqual(await readFile(f.file+'.retained'),bytes);
 await rm(f.file,{recursive:true});await rename(f.file+'.retained',f.file);
 const accepted=await session.act({expectedRevision:before.revision,action:{type:'taken',playerId:'10041'}});assert.equal(accepted.revision,before.revision+1);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).corrections.length,1);
});
test('deferred real atomic rename serializes an arriving HTTP result behind the unacknowledged action',async t=>{
 const f=await runtimeFixture(t),entered=barrier(),release=barrier(),queued=barrier();let defer=false;
 const session=await openSession({...f.options,autoRefresh:false,
  onRefreshQueued:()=>{if(defer)queued.release();},
  beforeRename:async({temporary})=>{if(defer){assert.equal(JSON.parse(await readFile(temporary,'utf8')).corrections.length,1);entered.release();await release.promise;}}});
 t.after(()=>release.release());t.after(()=>session.close());f.routes[f.picksPath]=[pick(1,'10041')];await session.refresh();
 const before=session.getBoard(),bytes=await readFile(f.file),held=f.hold(f.picksPath);f.routes[f.picksPath]=[pick(1,'10041'),pick(2,'10042')];
 const poll=session.refresh();await held.entered;defer=true;let acknowledged=false;
 const action=session.act({expectedRevision:before.revision,action:{type:'my-pick',pickNo:28,playerId:'10151'}}).then(b=>{acknowledged=true;return b;});await entered.promise;
 held.release();await queued.promise; // Real client result has reached the serialized session queue.
 assert.equal(acknowledged,false);assert.deepEqual(await readFile(f.file),bytes);assert.equal(session.getBoard().revision,before.revision);
 defer=false;release.release();await action;await poll;
 assert.equal(session.getBoard().revision,before.revision+1);assert.equal(session.getBoard().draft.officialCount,1);assert.deepEqual(session.getBoard().nextPicks,[29,56]);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).corrections.length,1);
 await session.refresh();assert.equal(session.getBoard().draft.officialCount,2);assert.equal(session.getBoard().corrections.length,1);
});

async function serveSession(t,session){
 const app=createApp({session});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.shutdown());
 const base=`http://127.0.0.1:${app.address().port}`;
 return {app,board:async()=>{const r=await fetch(base+'/api/board');assert.equal(r.status,200);return r.json();},
  act:async body=>{const r=await fetch(base+'/api/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}};
}
for(const origin of ['context','shape'])test(`C1 ${origin} invalidation rejects HTTP own-pick across held restart and preserves saved picks/corrections`,async t=>{
 const f=await runtimeFixture(t);f.routes[f.picksPath]=[pick(1,'10041')];
 let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());let http=await serveSession(t,session);
 await session.refresh();await session.act({expectedRevision:session.getBoard().revision,action:{type:'my-pick',pickNo:28,playerId:'10151'}});
 const before=await http.board(),original=JSON.parse(await readFile(f.file,'utf8'));
 const action={expectedRevision:before.revision,action:{type:'my-pick',pickNo:29,playerId:'10152'}};
 if(origin==='context')f.c.league.scoring_settings.rush_yd=0.25;else f.c.draft.settings.rounds=12;
 await session.refresh({context:origin==='context'});const invalid=await http.board();
 assert.equal(invalid.error.code,'PREPARE_REQUIRED');assert.equal(invalid.candidates.length,0);assert.equal(invalid.players.length,400);
 assert.equal(invalid.revision,before.revision);assert.ok(invalid.viewRevision>before.viewRevision);
 const bytes=await readFile(f.file);assert.equal((await http.act(action)).status,422);assert.deepEqual(await readFile(f.file),bytes);
 await http.app.shutdown();const held=f.hold(`/v1/league/${f.source.config.leagueId}`);
 session=await openSession(f.options);const startup=session.refresh();http=await serveSession(t,session);await held.entered;
 try{
  const restored=await http.board(),reply=await http.act(action),after=await readFile(f.file);
  assert.equal(reply.status,422,'known incompatible own-pick must remain rejected before startup validation responds');
  assert.equal(reply.body.error.code,'INVALID_ACTION');assert.equal(reply.body.revision,before.revision);
  assert.equal(restored.error.code,'PREPARE_REQUIRED');assert.equal(restored.candidates.length,0);assert.equal(restored.players.length,400);
  assert.equal(restored.freshness.stale,true);assert.notEqual(restored.sessionId,before.sessionId);assert.equal(restored.revision,before.revision);
  assert.deepEqual(restored.ownRoster,before.ownRoster);assert.deepEqual(restored.corrections,before.corrections);assert.deepEqual(restored.nextPicks,[29,56]);
  assert.deepEqual(after,bytes);const saved=JSON.parse(after);assert.equal(saved.requiresPreparation,true);
  assert.equal(saved.revision,original.revision);assert.deepEqual(saved.accepted,original.accepted);assert.deepEqual(saved.corrections,original.corrections);
 }finally{held.release();await startup;}
 assert.equal((await http.board()).error.code,'PREPARE_REQUIRED');assert.ok(f.requests.every(r=>r.method==='GET'));await http.app.shutdown();
});
for(const origin of ['context','shape'])test(`C1 ${origin} invalidation save conflict retains bytes and disabled advice, then retries the unsaved flag`,async t=>{
 const f=await runtimeFixture(t);let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 await session.refresh();await session.act({expectedRevision:session.getBoard().revision,action:{type:'taken',playerId:'10151'}});
 const before=session.getBoard(),bytes=await readFile(f.file),original=JSON.parse(bytes);
 await rename(f.file,f.file+'.retained');await mkdir(f.file);await writeFile(f.file+'/sentinel','retain this conflict');
 if(origin==='context')f.c.league.scoring_settings.rush_yd=0.25;else f.c.draft.settings.rounds=12;
 const failed=await session.refresh({context:origin==='context'});
 assert.equal(failed.error.code,'PERSISTENCE_FAILED','failed invalidation save must not be reported as durable success');
 assert.doesNotMatch(failed.error.message,/EISDIR|ENOTEMPTY|fantasy-session/);assert.equal(failed.candidates.length,0);assert.equal(failed.players.length,400);
 assert.equal(failed.revision,before.revision);assert.ok(failed.viewRevision>before.viewRevision);assert.deepEqual(failed.corrections,before.corrections);
 await assert.rejects(session.act({expectedRevision:before.revision,action:{type:'my-pick',pickNo:1,playerId:'10041'}}),e=>e.status===422);
 assert.deepEqual(await readFile(f.file+'.retained'),bytes);assert.equal(await readFile(f.file+'/sentinel','utf8'),'retain this conflict');
 assert.equal((await readdir(f.sessionDirectory)).some(p=>p.endsWith('.tmp')),false);
 await rm(f.file,{recursive:true});await rename(f.file+'.retained',f.file);
 // Retry must save the already-known invalidation even when the new error is only transient.
 f.c.league.scoring_settings.rush_yd=0.1;f.c.draft.settings.rounds=13;f.responses.set(f.picksPath,{status:500});
 await f.clock.advance(10000);await until(()=>!session.getBoard().refresh.inflight);
 const recovered=await readFile(f.file),saved=JSON.parse(recovered);
 assert.equal(saved.requiresPreparation,true);assert.equal(saved.revision,original.revision);
 assert.deepEqual(saved.accepted,original.accepted);assert.deepEqual(saved.corrections,original.corrections);
 assert.equal(session.getBoard().error.code,'PREPARE_REQUIRED');assert.equal(session.getBoard().candidates.length,0);
 // Once durable, further transient errors must not broaden into metadata writes.
 await f.clock.advance(20000);await until(()=>!session.getBoard().refresh.inflight);assert.deepEqual(await readFile(f.file),recovered);
 await session.close();session=await openSession({...f.options,autoRefresh:false});
 assert.equal(session.getBoard().error.code,'PREPARE_REQUIRED');assert.equal(session.getBoard().candidates.length,0);
 assert.deepEqual(session.getBoard().corrections,before.corrections);assert.equal(session.getBoard().revision,before.revision);
 assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('C1 compatible transient failure leaves saved empty bytes intact and permits an own-pick during held startup',async t=>{
 const f=await runtimeFixture(t);let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 await session.refresh();const before=session.getBoard(),bytes=await readFile(f.file);
 f.responses.set(f.picksPath,{status:500});await session.refresh();
 assert.equal(session.getBoard().error.code,'UPSTREAM_ERROR');assert.equal(session.getBoard().candidates.length,3);assert.deepEqual(await readFile(f.file),bytes);
 await session.close();f.responses.clear();const held=f.hold(`/v1/league/${f.source.config.leagueId}`);
 session=await openSession(f.options);const startup=session.refresh(),http=await serveSession(t,session);await held.entered;
 try{
  const restored=await http.board();assert.equal(restored.error,null);assert.equal(restored.candidates.length,3);assert.equal(restored.players.length,400);
  assert.equal(restored.freshness.stale,true);assert.equal(restored.draft.availabilityKnown,true);assert.equal(restored.draft.officialCount,0);
  assert.equal(restored.revision,before.revision);assert.deepEqual(restored.nextPicks,[1,28]);
  const reply=await http.act({expectedRevision:restored.revision,action:{type:'my-pick',pickNo:1,playerId:'10041'}});assert.equal(reply.status,200);
  const saved=JSON.parse(await readFile(f.file,'utf8'));assert.equal(saved.requiresPreparation,false);assert.equal(saved.revision,before.revision+1);
  assert.deepEqual(saved.accepted.picks,[]);assert.equal(saved.corrections.length,1);assert.equal(saved.corrections[0].playerId,'10041');
 }finally{held.release();await startup;}
 assert.ok(f.requests.every(r=>r.method==='GET'));await http.app.shutdown();
});
