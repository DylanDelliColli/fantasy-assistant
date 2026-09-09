import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {watch} from 'node:fs';
import {openSession} from '../../src/session.mjs';
import {runtimeFixture,barrier} from '../helpers/runtime.mjs';
import {pick} from '../fixtures/sleeper.mjs';

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
