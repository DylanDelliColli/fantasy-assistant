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
import {rankingsFixture,rankingsHtml,effectiveFixture} from '../fixtures/rankings.mjs';
import {openSession} from '../../src/session.mjs';
import {runtimeFixture,until} from '../helpers/runtime.mjs';

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

for(const mode of ['ecr','adp-only'])test(`prepared ${mode} unranked exact ADP beats opposing lexical IDs within one group`,async t=>{
 const u=await upstream(t),dir=await mkdtemp(join(tmpdir(),'fantasy-rules-adp-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 u.s.projections.find(p=>p.player_id==='10044').stats.adp_half_ppr=44.8;
 u.s.projections.find(p=>p.player_id==='10045').stats.adp_half_ppr=44.2;
 const ecr=rankingsFixture(u.s.players);ecr.players=[ecr.players[0]];u.routes['/ecr']=rankingsHtml(ecr);
 await runPrepare(['--data-dir',dir,...(mode==='adp-only'?['--without-ecr']:[])],{sourceUrls:u.sourceUrls,now:()=>Date.parse(NOW)});
 const source=await loadSnapshot(join(dir,'snapshot.json'));
 assert.equal(source.rankingMode,mode);assert.equal(Object.keys(source.playersById).length,400);
 const available=['10044','10045'],pair=available.map(id=>source.playersById[id]);
 assert.deepEqual(pair.map(p=>p.adp),[44.8,44.2]);assert.deepEqual(pair.map(p=>p.adpBand),[3,3]);
 assert.ok(pair.every(p=>p.ecrRank===null&&p.ecrTier===null&&p.policyPosition==='RB'&&p.eligible));
 // Real prepared/reloaded records; constructed effective roster isolates this comparator.
 // This seam does not represent session persistence or browser behavior.
 const owned=['10001','10041','10042','10151','10152','10281','10043','10337','ARI'].map(id=>source.playersById[id]);
 const effective=effectiveFixture(source,{owned,unavailable:Object.keys(source.playersById).filter(id=>!available.includes(id))});
 const result=recommend(source,effective);
 assert.equal(result.status,'ready');assert.equal(result.candidates.length,2);
 assert.ok(result.candidates.every(c=>c.deferral==='ordinary'&&!c.fillsStarter));
 assert.deepEqual(candidateIds(result),['10045','10044']);
 assert.deepEqual(result.candidates.map(c=>c.adp),[44.2,44.8]);
 assert.ok(u.requests.some(r=>r.url==='/projections/nfl/2026?season_type=regular'));
 assert.ok(u.requests.every(r=>r.method==='GET'));
});

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

test('session keeps unknown versus accepted empty distinct and retains the usable board across500/429/malformed/gapped/hanging responses',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());
 assert.equal(session.getBoard().draft.availabilityKnown,false);assert.equal(session.getBoard().candidates.length,0);
 await session.refresh();assert.equal(session.getBoard().draft.availabilityKnown,true);assert.deepEqual(session.getBoard().nextPicks,[1,28]);
 f.routes[f.picksPath]=[pick(1,'10041')];await session.refresh();const before=session.getBoard();
 for(const response of [{status:500,body:'secret body'},{status:429,headers:{'Retry-After':'20'}},{body:'{broken'},{body:JSON.stringify([pick(2,'10042')])}]){
  f.responses.set(f.picksPath,response);await session.refresh();const failed=session.getBoard();
  assert.equal(failed.revision,before.revision);assert.equal(failed.draft.officialCount,1);assert.deepEqual(candidateIds(failed),candidateIds(before));
  assert.equal(failed.freshness.connection,'error');assert.ok(failed.freshness.lastError);assert.doesNotMatch(JSON.stringify(failed.error),/secret body|127\.0\.0\.1|stack/);
  f.responses.clear();await f.clock.advance(failed.refresh.retryAt-f.clock.now());await until(()=>!session.getBoard().refresh.inflight);
 }
 const held=f.hold(f.picksPath),pending=session.refresh();await held.entered;await f.clock.advance(4000);await pending;held.release();
 assert.equal(session.getBoard().draft.officialCount,1);assert.equal(session.getBoard().freshness.connection,'error');assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('session completed polling uses30s/40s, immediate failure and observed reopen restores5s/15s',async t=>{
 const f=await runtimeFixture(t);f.c.draft.status='complete';const session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());await session.refresh();
 assert.equal(session.getBoard().refresh.nextRefreshAt,f.clock.now()+30000);
 await f.clock.advance(29999);assert.equal(session.getBoard().freshness.overdue,false);
 await f.clock.advance(1);await until(()=>!session.getBoard().refresh.inflight);assert.equal(session.getBoard().freshness.overdue,false);
 const held=f.hold(f.picksPath),poll=session.refresh();await held.entered;f.clock.jump(39999);assert.equal(session.getBoard().freshness.overdue,false);
 f.clock.jump(1);assert.equal(session.getBoard().freshness.overdue,true);held.release();await poll;
 f.responses.set(f.picksPath,{status:500});await session.refresh();assert.equal(session.getBoard().freshness.overdue,true);
 f.responses.clear();f.c.draft.status='drafting';await f.clock.advance(10000);await until(()=>!session.getBoard().refresh.inflight);
 assert.equal(session.getBoard().draft.status,'drafting');assert.equal(session.getBoard().refresh.nextRefreshAt,f.clock.now()+5000);
 f.clock.jump(14999);assert.equal(session.getBoard().freshness.overdue,false);f.clock.jump(1);assert.equal(session.getBoard().freshness.overdue,true);
});
test('held older poll cannot overwrite newer persisted local28; session pending adoption needs current token',async t=>{
 const f=await runtimeFixture(t);f.routes[f.picksPath]=[pick(1,'10041')];const session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());await session.refresh();
 const held=f.hold(f.picksPath);f.routes[f.picksPath]=[pick(1,'10041'),pick(2,'10042')];const poll=session.refresh();await held.entered;
 const changed=await session.act({expectedRevision:session.getBoard().revision,action:{type:'my-pick',pickNo:28,playerId:'10151'}});held.release();await poll;
 assert.equal(session.getBoard().revision,changed.revision);assert.equal(session.getBoard().draft.officialCount,1);assert.deepEqual(session.getBoard().nextPicks,[29,56]);
 await session.refresh();assert.equal(session.getBoard().draft.officialCount,2);
 f.routes[f.picksPath]=[pick(1,'10041')];await session.refresh();const token=session.getBoard().pending.revision;
 f.routes[f.picksPath]=[];await session.refresh();assert.ok(session.getBoard().pending.revision>token);
 await assert.rejects(session.act({expectedRevision:session.getBoard().revision,action:{type:'accept-pending',pendingRevision:token}}),e=>e.status===409);
 await session.act({expectedRevision:session.getBoard().revision,action:{type:'accept-pending',pendingRevision:session.getBoard().pending.revision}});
 assert.equal(session.getBoard().pending,null);assert.equal(session.getBoard().draft.officialCount,0);assert.equal(session.getBoard().corrections.length,0);assert.deepEqual(session.getBoard().nextPicks,[1,28]);
});
test('startup/explicit context and each-cycle draft shape changes require preparation without losing browsing',async t=>{
 const f=await runtimeFixture(t),session=await openSession({...f.options,autoRefresh:false});t.after(()=>session.close());await session.refresh();
 const before=session.getBoard();f.c.league.scoring_settings.rush_yd=0.2;await session.refresh({context:true});
 assert.equal(session.getBoard().error.code,'PREPARE_REQUIRED');assert.equal(session.getBoard().candidates.length,0);assert.equal(session.getBoard().players.length,400);assert.equal(session.getBoard().draft.availabilityKnown,true);
 assert.equal(session.getBoard().draft.officialCount,before.draft.officialCount);await session.close();
 const held=f.hold(`/v1/league/${f.source.config.leagueId}`);
 const restarted=await openSession({...f.options,autoRefresh:false});t.after(()=>restarted.close());
 const startup=restarted.refresh();await held.entered;
 try{
  assert.equal(restarted.getBoard().candidates.length,0);assert.equal(restarted.getBoard().error.code,'PREPARE_REQUIRED');
  assert.equal(restarted.getBoard().players.length,400);assert.equal(restarted.getBoard().freshness.stale,true);
  assert.equal(restarted.getBoard().revision,before.revision);
 }finally{held.release();await startup;}
 await restarted.refresh();assert.equal(restarted.getBoard().error.code,'PREPARE_REQUIRED');await restarted.close();
 f.c.league.scoring_settings.rush_yd=0.1;
 // A separately prepared private directory has no sticky prior mismatch.
 const g=await runtimeFixture(t),other=await openSession({...g.options,autoRefresh:false});t.after(()=>other.close());await other.refresh();g.c.draft.settings.rounds=12;await other.refresh();
 assert.equal(other.getBoard().error.code,'PREPARE_REQUIRED');assert.equal(other.getBoard().candidates.length,0);assert.equal(other.getBoard().players.length,400);
});
