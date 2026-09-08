import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runPrepare} from '../../scripts/prepare-data.mjs';
import {loadSnapshot} from '../../src/data/snapshot.mjs';
import {fetchDraftSnapshot} from '../../src/sleeper/client.mjs';
import {createDraftState,reconcileDraft,applyLocalAction,deriveEffectiveDraft} from '../../src/draft/state.mjs';
import {recommend} from '../../src/draft/recommend.mjs';
import {upstream} from '../helpers/upstream.mjs';
import {DRAFT,NOW,pick} from '../fixtures/sleeper.mjs';

async function setup(t){
 const u=await upstream(t),dir=await mkdtemp(join(tmpdir(),'fantasy-rules-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await runPrepare(['--data-dir',dir],{sourceUrls:u.sourceUrls,now:()=>Date.parse(NOW)});
 const source=await loadSnapshot(join(dir,'snapshot.json'));let sequence=0;
 const refresh=async state=>{
  const envelope={requestSequence:++sequence,expectedRevision:state.revision,checkedAt:NOW};
  let snapshot;try{snapshot=await fetchDraftSnapshot(source.config,{sourceUrls:u.sourceUrls,now:()=>Date.parse(NOW)});}
  catch(error){return reconcileDraft(state,{...envelope,error:error.message});}
  return reconcileDraft(state,{...envelope,snapshot});
 };
 return {...u,source,refresh,board:state=>recommend(source,deriveEffectiveDraft(state,source.config)),
  setPicks:rows=>{u.routes[`/v1/draft/${DRAFT}/picks`]=rows;}};
}
function action(state,extra){return applyLocalAction(state,{expectedRevision:state.revision,...extra});}
const candidateIds=board=>board.candidates.map(c=>c.playerId);

test('offline without saved acceptance is unknown; real HTTP empty draft enables normal pick1 advice',async t=>{
 const f=await setup(t);let state=createDraftState(f.source);f.failures.add(`/v1/draft/${DRAFT}/picks`);
 state=await f.refresh(state);assert.equal(state.accepted,null);assert.equal(deriveEffectiveDraft(state,f.source.config).availabilityKnown,false);
 assert.equal(f.board(state).candidates.length,0);assert.match(f.board(state).reason,/unknown/i);assert.equal(f.board(state).players.length,400);
 assert.match(state.freshness.lastError,/503/);f.failures.clear();state=await f.refresh(state);
 assert.deepEqual(state.accepted.picks,[]);assert.equal(deriveEffectiveDraft(state,f.source.config).availabilityKnown,true);
 assert.deepEqual(f.board(state).nextPicks,[1,28]);assert.deepEqual(candidateIds(f.board(state)),['10001','10002','10003']);
 assert.equal(f.board(state).candidates[0].ecrRank,1);assert.equal(f.board(state).candidates[0].adp,1);
 assert.equal(state.freshness.lastError,null);assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('real0/1/27/28/29 replay removes opponent candidate and canonically confirms local28 once',async t=>{
 const f=await setup(t);let state=await f.refresh(createDraftState(f.source));
 assert.equal(state.accepted.picks.length,0);assert.deepEqual(f.board(state).nextPicks,[1,28]);
 f.setPicks([pick(1,'10041')]);state=await f.refresh(state);
 assert.equal(state.accepted.picks[0].rosterId,'5');assert.deepEqual(f.board(state).nextPicks,[28,29]);
 const previous=f.board(state).candidates[0].playerId;assert.equal(previous,'10001');
 state=action(state,{type:'my-pick',pickNo:28,playerId:'10151'});const correctionId=state.corrections[0].id;
 assert.equal(state.accepted.picks.length,1);assert.deepEqual(f.board(state).nextPicks,[29,56]);
 assert.ok(f.board(state).ownRoster.some(p=>p.id==='10151'));assert.ok(!candidateIds(f.board(state)).includes('10151'));
 const rows=[pick(1,'10041'),{...pick(2,previous),roster_id:3,picked_by:f.source.config.userId},...Array.from({length:25},(_,i)=>pick(i+3,String(10200+i)))];
 f.setPicks(rows);state=await f.refresh(state);assert.equal(state.accepted.picks.length,27);
 assert.equal(state.accepted.picks[1].rosterId,'3');assert.ok(!f.board(state).ownRoster.some(p=>p.id===previous));
 assert.ok(!candidateIds(f.board(state)).includes(previous));assert.deepEqual(f.board(state).nextPicks,[29,56]);
 assert.equal(state.corrections.length,1);
 rows.push(pick(28,'10151'));f.setPicks(rows);state=await f.refresh(state);
 assert.equal(state.accepted.picks.length,28);assert.equal(state.corrections.length,0);assert.deepEqual(f.board(state).nextPicks,[29,56]);
 assert.equal(f.board(state).ownRoster.filter(p=>p.id==='10151').length,1);
 assert.equal(state.notices.filter(n=>n.code==='confirmed'&&n.correctionId===correctionId).length,1);
 state=await f.refresh(state);assert.equal(f.board(state).ownRoster.filter(p=>p.id==='10151').length,1);
 assert.equal(state.notices.filter(n=>n.correctionId===correctionId).length,1);
 rows.push(pick(29,'10152'));f.setPicks(rows);state=await f.refresh(state);
 assert.equal(state.accepted.picks.length,29);assert.deepEqual(f.board(state).nextPicks,[56,57]);
 assert.deepEqual(f.board(state).ownRoster.map(p=>p.id),['10041','10151','10152']);
 assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('real invalid, gapped and503 responses preserve last usable accepted roster and shortlist',async t=>{
 const f=await setup(t);f.setPicks([pick(1,'10041')]);let state=await f.refresh(createDraftState(f.source));
 const accepted=structuredClone(state.accepted),before=f.board(state);
 for(const rows of [[pick(1,'10041'),pick(3,'10042')],[pick(1,'10041'),pick(2,'10041')],[{...pick(1,'10041'),round:2}]]){
  f.setPicks(rows);state=await f.refresh(state);assert.deepEqual(state.accepted,accepted);assert.ok(state.freshness.lastError);
  assert.deepEqual(candidateIds(f.board(state)),candidateIds(before));assert.deepEqual(f.board(state).ownRoster,before.ownRoster);
 }
 f.failures.add(`/v1/draft/${DRAFT}/picks`);state=await f.refresh(state);
 assert.match(state.freshness.lastError,/503/);assert.deepEqual(state.accepted,accepted);assert.deepEqual(f.board(state).nextPicks,[28,29]);
});
test('real non-extension needs exact pending adoption, clearing local corrections and recomputing availability',async t=>{
 const f=await setup(t);f.setPicks([pick(1,'10041'),pick(2,'10042')]);let state=await f.refresh(createDraftState(f.source));
 state=action(state,{type:'my-pick',pickNo:28,playerId:'10151'});state=action(state,{type:'taken',playerId:'10152'});
 const accepted=structuredClone(state.accepted);f.setPicks([pick(1,'10041')]);state=await f.refresh(state);
 assert.deepEqual(state.accepted,accepted);assert.equal(state.pending.diff.firstChangedPick,2);const oldToken=state.pending.revision;
 f.setPicks([pick(1,'10043')]);state=await f.refresh(state);assert.equal(state.pending.diff.firstChangedPick,1);
 assert.throws(()=>action(state,{type:'accept-pending',pendingRevision:oldToken}),e=>e.status===409);
 const cleared=state.corrections.map(c=>c.id);state=action(state,{type:'accept-pending',pendingRevision:state.pending.revision});
 assert.equal(state.pending,null);assert.deepEqual(state.accepted.picks.map(p=>p.playerId),['10043']);
 assert.deepEqual(state.corrections,[]);assert.deepEqual(state.notices.at(-1).clearedCorrectionIds,cleared);
 assert.deepEqual(f.board(state).ownRoster.map(p=>p.id),['10043']);assert.deepEqual(f.board(state).nextPicks,[28,29]);
 const effective=deriveEffectiveDraft(state,f.source.config);assert.ok(!effective.unavailableIds.includes('10041'));assert.ok(!effective.unavailableIds.includes('10152'));
 assert.equal(f.board(state).candidates.length,3);
});
