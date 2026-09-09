import test from 'node:test';
import assert from 'node:assert/strict';
import {openSession,retryDelay,isOverdue,isProcessAlive} from '../../src/session.mjs';
import {runtimeFixture,until} from '../helpers/runtime.mjs';
import {readFile} from 'node:fs/promises';

test('retry policy is10/20/40/60 capped and honors only longer valid Retry-After',()=>{
 const now=Date.parse('2026-09-08T18:00:00Z');
 assert.deepEqual([1,2,3,4,5,9].map(n=>retryDelay(n,null,now)),[10000,20000,40000,60000,60000,60000]);
 assert.equal(retryDelay(1,'120',now),120000);assert.equal(retryDelay(2,'1',now),20000);
 assert.equal(retryDelay(1,'Tue, 08 Sep 2026 18:02:00 GMT',now),120000);
 for(const value of ['broken','-10','Tue, 08 Sep 2026 17:00:00 GMT'])assert.equal(retryDelay(1,value,now),10000);
});
test('overdue is exact15s active/pre-draft and40s complete; failure is immediately unhealthy',()=>{
 for(const status of ['pre_draft','drafting','paused']){
  assert.equal(isOverdue({status,lastCheckAt:1000,openedAt:0,lastError:null},15999),false);
  assert.equal(isOverdue({status,lastCheckAt:1000,openedAt:0,lastError:null},16000),true);
 }
 assert.equal(isOverdue({status:'complete',lastCheckAt:1000,openedAt:0,lastError:null},40999),false);
 assert.equal(isOverdue({status:'complete',lastCheckAt:1000,openedAt:0,lastError:null},41000),true);
 assert.equal(isOverdue({status:'complete',lastCheckAt:1000,openedAt:0,lastError:'503'},1001),true);
 assert.equal(isOverdue({status:'drafting',lastCheckAt:null,openedAt:1000,lastError:null},16000),true);
});
test('EPERM or uncertain PID probe never proves dead; only ESRCH permits reclaim',()=>{
 assert.equal(isProcessAlive(123,()=>{}),true);
 assert.equal(isProcessAlive(123,()=>{throw Object.assign(new Error('permission'),{code:'EPERM'});}),true);
 assert.equal(isProcessAlive(123,()=>{throw Object.assign(new Error('gone'),{code:'ESRCH'});}),false);
 assert.throws(()=>isProcessAlive(123,()=>{throw Object.assign(new Error('uncertain'),{code:'EIO'});}),/uncertain/);
});
test('startup/manual/multiple callers coalesce; known empty succeeds and next poll starts at exactly5s',async t=>{
 const f=await runtimeFixture(t),held=f.hold(f.picksPath),session=await openSession(f.options);t.after(()=>session.close());
 const initial=session.getBoard();assert.equal(initial.draft.availabilityKnown,false);assert.equal(initial.candidates.length,0);
 const first=session.refresh(),second=session.refresh();assert.equal(first,second);await held.entered;
 assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,1);held.release();await first;
 const board=session.getBoard();assert.equal(board.draft.availabilityKnown,true);assert.deepEqual(board.nextPicks,[1,28]);assert.equal(board.candidates.length,3);
 const count=f.requests.filter(r=>r.url===f.picksPath).length;await f.clock.advance(4999);assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,count);
 await f.clock.advance(1);await until(()=>!session.getBoard().refresh.inflight);
 assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,count+1);
 await session.close();assert.equal(f.clock.pending(),0);
});
test('hanging real request times out exactly4s and manual cannot bypass retry; success resets backoff',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 const held=f.hold(f.picksPath);let finished=false;const pending=session.refresh().then(()=>{finished=true;});await held.entered;
 await f.clock.advance(3999);assert.equal(finished,false);await f.clock.advance(1);await pending;
 assert.equal(session.getBoard().refresh.retryAt,f.clock.now()+10000);assert.equal(session.getBoard().freshness.connection,'error');held.release();
 f.responses.set(f.picksPath,{status:500,body:'private provider body'});
 for(const delay of [10000,20000,40000,60000,60000]){
  const before=f.requests.filter(r=>r.url===f.picksPath).length;
  await session.refresh();await f.clock.advance(delay-1);await session.refresh();assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,before);
  await f.clock.advance(1);await until(()=>!session.getBoard().refresh.inflight);
  assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,before+1);
 }
 f.responses.clear();await f.clock.advance(60000);await until(()=>!session.getBoard().refresh.inflight);
 assert.equal(session.getBoard().refresh.failures,0);assert.equal(session.getBoard().refresh.nextRefreshAt,f.clock.now()+5000);
 f.responses.set(f.picksPath,{status:429,headers:{'Retry-After':'120'}});await session.refresh();
 assert.equal(session.getBoard().refresh.retryAt,f.clock.now()+120000);
 const count=f.requests.length;await f.clock.advance(119999);await session.refresh();assert.equal(f.requests.length,count);
 await f.clock.advance(1);await until(()=>!session.getBoard().refresh.inflight);assert.ok(f.requests.length>count);
});
test('unchanged success/failure/recovery advance view only; committed action advances both revisions',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 await session.refresh();const first=session.getBoard();await session.refresh();const unchanged=session.getBoard();
 assert.equal(unchanged.revision,first.revision);assert.ok(unchanged.viewRevision>first.viewRevision);assert.equal(unchanged.freshness.connection,'checked');assert.equal(unchanged.freshness.lastChangedAt,first.freshness.lastChangedAt);
 f.responses.set(f.picksPath,{status:500});await session.refresh();const failed=session.getBoard();
 assert.equal(failed.revision,first.revision);assert.ok(failed.viewRevision>unchanged.viewRevision);assert.equal(failed.freshness.overdue,true);
 f.responses.clear();await f.clock.advance(10000);await until(()=>!session.getBoard().refresh.inflight);const recovered=session.getBoard();
 assert.equal(recovered.revision,first.revision);assert.ok(recovered.viewRevision>failed.viewRevision);assert.equal(recovered.freshness.lastError,null);
 const action=await session.act({expectedRevision:recovered.revision,action:{type:'taken',playerId:'10041'}});
 assert.equal(action.revision,recovered.revision+1);assert.ok(action.viewRevision>recovered.viewRevision);assert.equal(action.sessionId,first.sessionId);
});
test('saved empty acceptance restores known pick1 advice as stale, while a fresh session starts unknown',async t=>{
 const f=await runtimeFixture(t);let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 assert.equal(session.getBoard().draft.availabilityKnown,false);await session.refresh();const before=session.getBoard();await session.close();
 session=await openSession({...f.options,autoRefresh:false});const saved=session.getBoard();
 assert.equal(saved.draft.availabilityKnown,true);assert.equal(saved.draft.officialCount,0);assert.deepEqual(saved.nextPicks,[1,28]);assert.equal(saved.candidates.length,3);
 assert.equal(saved.freshness.stale,true);assert.equal(saved.revision,before.revision);assert.notEqual(saved.sessionId,before.sessionId);
 await session.refresh();assert.equal(session.getBoard().freshness.stale,false);
});

for(const origin of ['context','shape'])test(`C1 ${origin} invalidation survives held startup without advancing the action revision`,async t=>{
 const f=await runtimeFixture(t);let session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 await session.refresh();const before=session.getBoard();assert.equal(before.candidates.length,3);
 if(origin==='context')f.c.league.scoring_settings.rush_yd=0.25;else f.c.draft.settings.rounds=12;
 await session.refresh({context:origin==='context'});const invalid=session.getBoard();
 assert.equal(invalid.error.code,'PREPARE_REQUIRED');assert.equal(invalid.candidates.length,0);assert.equal(invalid.players.length,400);
 assert.equal(invalid.revision,before.revision);assert.ok(invalid.viewRevision>before.viewRevision);
 assert.equal(invalid.freshness.lastCheckAt,before.freshness.lastCheckAt);assert.equal(invalid.freshness.lastChangedAt,before.freshness.lastChangedAt);
 await assert.rejects(session.act({expectedRevision:before.revision,action:{type:'my-pick',pickNo:1,playerId:'10041'}}),e=>e.status===422);
 await session.close();const bytes=await readFile(f.file),held=f.hold(`/v1/league/${f.source.config.leagueId}`);
 session=await openSession(f.options);const startup=session.refresh();await held.entered;
 try{
  const restored=session.getBoard();assert.equal(restored.candidates.length,0);assert.equal(restored.error.code,'PREPARE_REQUIRED');
  assert.equal(restored.players.length,400);assert.equal(restored.draft.availabilityKnown,true);assert.equal(restored.draft.officialCount,0);
  assert.equal(restored.freshness.stale,true);assert.equal(restored.revision,before.revision);assert.notEqual(restored.sessionId,invalid.sessionId);
  await assert.rejects(session.act({expectedRevision:restored.revision,action:{type:'my-pick',pickNo:1,playerId:'10041'}}),e=>e.status===422);
  assert.deepEqual(await readFile(f.file),bytes);const saved=JSON.parse(bytes);
  assert.equal(saved.requiresPreparation,true);assert.equal(saved.revision,before.revision);assert.deepEqual(saved.accepted.picks,[]);assert.deepEqual(saved.corrections,[]);
 }finally{held.release();await startup;}
 assert.equal(session.getBoard().error.code,'PREPARE_REQUIRED');assert.ok(f.requests.every(r=>r.method==='GET'));
});
