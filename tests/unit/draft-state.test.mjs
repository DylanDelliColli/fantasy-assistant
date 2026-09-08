import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftState,reconcileDraft,applyLocalAction,deriveEffectiveDraft} from '../../src/draft/state.mjs';
import {recommend} from '../../src/draft/recommend.mjs';
import {normalizePicks} from '../../src/sleeper/client.mjs';
import {pick,NOW} from '../fixtures/sleeper.mjs';
import {rulePlayer,ruleSnapshot,fullStarters} from '../fixtures/rankings.mjs';

const schedule=[1,28,29,56,57,84,85,112,113,140,141,168,169];
function fixture(){return ruleSnapshot([...fullStarters(),...Array.from({length:190},(_,i)=>rulePlayer(String(10001+i),['QB','RB','WR','TE','K','DEF'][i%6]))]);}
function draft(s,rows=[]){return {draftId:s.config.draftId,configFingerprint:s.configFingerprint,status:'drafting',fetchedAt:NOW,picks:normalizePicks(rows,s.config)};}
function receive(state,snapshot,extra={}){return reconcileDraft(state,{snapshot,requestSequence:state.lastRequestSequence+1,expectedRevision:state.revision,checkedAt:NOW,...extra});}
function act(s,action){return applyLocalAction(s,{expectedRevision:s.revision,...action});}
function effective(s){return deriveEffectiveDraft(s,s.config);}
function rows(n){return Array.from({length:n},(_,i)=>pick(i+1));}

test('null acceptance is unknown; validated empty is known and permits pick1 with the full schedule',()=>{
 const source=fixture(),initial=createDraftState(source),before=structuredClone(initial);
 assert.equal(initial.accepted,null);assert.equal(effective(initial).availabilityKnown,false);
 assert.equal(recommend(source,effective(initial)).candidates.length,0);
 const state=receive(initial,draft(source));assert.deepEqual(initial,before);
 assert.deepEqual(state.accepted?.picks,[]);assert.equal(effective(state).availabilityKnown,true);
 assert.deepEqual(effective(state).remainingPicks,schedule);assert.deepEqual(effective(state).nextPicks,[1,28]);
 assert.equal(recommend(source,effective(state)).candidates.length,3);
});
test('taken and named Undo change availability only, never official count or ownership',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));const initial=effective(state);
 state=act(state,{type:'taken',playerId:'10002'});const correction=state.corrections[0];
 assert.equal(effective(state).officialCount,1);assert.deepEqual(effective(state).ownPicks,initial.ownPicks);
 assert.deepEqual(effective(state).nextPicks,[28,29]);assert.ok(effective(state).unavailableIds.includes('10002'));
 state=act(state,{type:'taken',playerId:'10003'});state=act(state,{type:'undo',correctionId:correction.id});
 assert.equal(effective(state).unavailableIds.includes('10002'),false);assert.ok(effective(state).unavailableIds.includes('10003'));
 assert.equal(state.corrections.length,1);assert.deepEqual(effective(state).ownPicks,initial.ownPicks);assert.equal(state.accepted.picks.length,1);
 assert.throws(()=>act(state,{type:'undo',correctionId:'official-1'}),/local|correction/i);
});
test('local28 immediately yields29/56 with only official1; confirmation retires it exactly once',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));
 state=act(state,{type:'my-pick',playerId:'10028',pickNo:28});
 assert.equal(effective(state).officialCount,1);assert.equal(state.accepted.picks.length,1);
 assert.deepEqual(effective(state).nextPicks,[29,56]);assert.deepEqual(effective(state).ownPlayerIds,['10001','10028']);
 const id=state.corrections[0].id;state=receive(state,draft(source,rows(28)));
 assert.equal(state.corrections.length,0);assert.deepEqual(effective(state).ownPlayerIds,['10001','10028']);
 assert.deepEqual(state.notices.map(n=>[n.code,n.correctionId]),[['confirmed',id]]);
 const revision=state.revision;state=receive(state,draft(source,rows(28)));
 assert.equal(state.revision,revision);assert.equal(state.notices.filter(n=>n.correctionId===id).length,1);
 assert.equal(effective(state).ownPlayerIds.filter(id=>id==='10028').length,1);
});
test('accepted player ownership and occupied local slot override corrections with specific notices',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));
 state=act(state,{type:'my-pick',playerId:'10028',pickNo:28});
 state=receive(state,draft(source,[pick(1),{...pick(2,'10028'),roster_id:3,picked_by:source.config.userId}]));
 assert.equal(state.corrections.length,0);assert.deepEqual(effective(state).ownPlayerIds,['10001']);
 assert.equal(state.notices[0].code,'official-player-conflict');assert.match(state.notices[0].message,/10028.*3/);
 state=act(state,{type:'my-pick',playerId:'10029',pickNo:28});
 const official=rows(28);official[1]={...pick(2,'10028'),roster_id:3};official[27]=pick(28,'10030');
 state=receive(state,draft(source,official));assert.equal(state.corrections.length,0);
 assert.deepEqual(effective(state).ownPlayerIds,['10001','10030']);assert.deepEqual(effective(state).nextPicks,[29,56]);
 assert.equal(state.notices.at(-1).code,'official-slot-conflict');assert.match(state.notices.at(-1).message,/28.*10030/);
});
test('official taken confirmation removes only the corresponding local marker',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source));
 state=act(state,{type:'taken',playerId:'10001'});state=act(state,{type:'taken',playerId:'10002'});
 state=receive(state,draft(source,rows(1)));assert.deepEqual(state.corrections.map(c=>c.playerId),['10002']);
 assert.ok(effective(state).unavailableIds.includes('10001'));
});
test('all invalid local actions reject without mutation, including obsolete revision',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));
 state=act(state,{type:'taken',playerId:'10002'});const before=structuredClone(state);
 for(const action of [
  {type:'taken',playerId:'missing'},{type:'taken',playerId:'10001'},{type:'taken',playerId:'10002'},
  {type:'my-pick',playerId:'missing',pickNo:28},{type:'my-pick',playerId:'10002',pickNo:28},
  ...[0,-1,1,2,29,183,28.5,'28',null].map(pickNo=>({type:'my-pick',playerId:'10003',pickNo})),
  {type:'undo',correctionId:'missing'},{type:'accept-pending',pendingRevision:1},{type:'wat'},
 ]){assert.throws(()=>act(state,action),e=>e.status===422,JSON.stringify(action));assert.deepEqual(state,before);}
 assert.throws(()=>act(state,{type:'taken',playerId:'10003',expectedRevision:state.revision-1}),e=>e.status===409);
 assert.throws(()=>applyLocalAction(state,{type:'taken',playerId:'10003'}),e=>e.status===409);
 const unknown=createDraftState(source);assert.throws(()=>act(unknown,{type:'my-pick',playerId:'10001',pickNo:1}),/unknown|accept/i);
});
test('smaller, changed player and changed owner snapshots are held with exact differences',()=>{
 const source=fixture(),state=receive(createDraftState(source),draft(source,rows(2)));
 for(const incoming of [rows(1),[pick(1,'10003'),pick(2)],[{...pick(1),roster_id:3},pick(2)]]){
  const held=receive(state,draft(source,incoming));assert.deepEqual(held.accepted,state.accepted);
  const first=incoming.length===1?2:1;assert.equal(held.pending.diff.firstChangedPick,first);
  assert.equal(held.pending.diff.removed[0].pickNo,first);
  assert.deepEqual(held.pending.snapshot.picks,normalizePicks(incoming,source.config));
  assert.equal(held.revision,state.revision);assert.equal(held.pending.revision,1);
 }
});
test('pending exact revision protects reviewed board; adoption clears later own picks and all taken markers',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source));
 state=act(state,{type:'my-pick',playerId:'10001',pickNo:1});
 state=receive(state,draft(source,[{...pick(1,'10002'),roster_id:3}]));
 // Official1 retires local1; local28 remains before the rollback boundary at29.
 state=act(state,{type:'my-pick',playerId:'10028',pickNo:28});
 state=act(state,{type:'my-pick',playerId:'10029',pickNo:29});
 state=act(state,{type:'my-pick',playerId:'10056',pickNo:56});
 state=act(state,{type:'taken',playerId:'10080'});
 const old=rows(29);old[0]={...pick(1,'10002'),roster_id:3};old[1]=pick(2,'10090');old[27]={...pick(28,'10091'),roster_id:3};old[28]=pick(29,'10092');
 // A non-extension is held before these official slots can override the local corrections.
 const changed=rows(29);changed[0]={...pick(1,'10003'),roster_id:3};changed[2]=pick(3,'10090');
 state=receive(state,draft(source,changed));const staleToken=state.pending.revision;
 state=receive(state,draft(source,old)); // Strict extension: adopts; local slots confirm/conflict.
 assert.equal(state.pending,null);
 // Construct a later local correction; rollback of pick29 must preserve earlier accepted own history.
 state=act(state,{type:'my-pick',playerId:'10057',pickNo:57});
 state=act(state,{type:'taken',playerId:'10081'});
 const rollback=old.slice(0,28);state=receive(state,draft(source,rollback));
 const token=state.pending.revision;assert.ok(token>staleToken);
 const revised=structuredClone(rollback);revised[27]={...pick(28,'10093'),roster_id:3};
 state=receive(state,draft(source,revised));assert.ok(state.pending.revision>token);
 assert.throws(()=>act(state,{type:'accept-pending',pendingRevision:token}),e=>e.status===409);
 const cleared=state.corrections.map(c=>c.id);
 state=act(state,{type:'accept-pending',pendingRevision:state.pending.revision});
 assert.equal(state.pending,null);assert.deepEqual(state.accepted.picks,normalizePicks(revised,source.config));
 assert.equal(state.corrections.length,0);assert.deepEqual(state.notices.at(-1).clearedCorrectionIds,cleared);
 assert.deepEqual(effective(state).nextPicks,[29,56]);
});
test('rollback after a preserved local selection clears only my-picks at or after first change',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));
 state=act(state,{type:'my-pick',playerId:'10028',pickNo:28});state=act(state,{type:'my-pick',playerId:'10029',pickNo:29});
 // Feed reaches27, then a held replacement changes only pick27: both later corrections clear.
 state=receive(state,draft(source,rows(27)));const replacement=rows(27);replacement[26]=pick(27,'10070');
 state=receive(state,draft(source,replacement));state=act(state,{type:'accept-pending',pendingRevision:state.pending.revision});
 assert.equal(state.corrections.length,0);assert.deepEqual(effective(state).nextPicks,[28,29]);
 // A saved local earlier selection can coexist with authoritative non-own slot ownership.
 const saved={...state,corrections:[{id:'earlier',type:'my-pick',pickNo:28,playerId:'10028'},{id:'later',type:'my-pick',pickNo:56,playerId:'10056'},{id:'marker',type:'taken',playerId:'10080'}],
  pending:{revision:9,snapshot:draft(source,replacement),diff:{firstChangedPick:29,removed:[],added:[]}}};
 const adopted=act(saved,{type:'accept-pending',pendingRevision:9});assert.deepEqual(adopted.corrections.map(c=>c.id),['earlier']);
 assert.deepEqual(adopted.notices.at(-1).clearedCorrectionIds,['later','marker']);
});
test('configuration changes require preparation and retain accepted board; mismatched derivation disables advice',()=>{
 const source=fixture(),state=receive(createDraftState(source),draft(source,rows(1)));
 const changed=receive(state,{...draft(source,rows(2)),configFingerprint:'different-shape'});
 assert.deepEqual(changed.accepted,state.accepted);assert.equal(changed.requiresPreparation,true);
 assert.match(effective(changed).unavailableReason,/prepar|config/i);assert.equal(recommend(source,effective(changed)).candidates.length,0);
 const mismatched=deriveEffectiveDraft(state,{...source.config,rounds:12});assert.equal(mismatched.personalizationAvailable,false);
});
test('obsolete request sequence or action revision cannot overwrite a newer state or pending board',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)),{requestSequence:2});
 const oldRevision=state.revision;state=act(state,{type:'taken',playerId:'10080'});
 assert.equal(state.revision,oldRevision+1);assert.equal(state.corrections.length,1);
 assert.deepEqual(receive(state,draft(source,rows(2)),{expectedRevision:oldRevision,requestSequence:3}),state);
 state=receive(state,draft(source,rows(2)),{requestSequence:4});
 assert.deepEqual(receive(state,draft(source,rows(1)),{requestSequence:3}),state);
 assert.deepEqual(receive(state,null,{requestSequence:4,error:'late error'}),state);
});
test('failed versus unchanged checks retain distinct last successful check and pick-change metadata',()=>{
 const source=fixture();let state=receive(createDraftState(source),draft(source,rows(1)));
 const revision=state.revision,accepted=state.accepted;
 state=receive(state,null,{checkedAt:'2026-09-08T18:00:05.000Z',error:'503 unavailable'});
 assert.equal(state.revision,revision);assert.deepEqual(state.accepted,accepted);
 assert.equal(state.freshness.lastCheckAt,NOW);assert.equal(state.freshness.lastChangedAt,NOW);
 assert.equal(state.freshness.lastAttemptAt,'2026-09-08T18:00:05.000Z');assert.match(state.freshness.lastError,/503/);
 state=receive(state,{...draft(source,rows(1)),status:'complete'},{checkedAt:'2026-09-08T18:00:10.000Z'});
 assert.equal(state.revision,revision);assert.equal(state.freshness.lastCheckAt,'2026-09-08T18:00:10.000Z');
 assert.equal(state.freshness.lastChangedAt,NOW);assert.equal(state.freshness.lastError,null);assert.equal(state.accepted.status,'complete');
});
test('unknown opponent identity stays unavailable; unknown own identity disables advice while retaining browsing',()=>{
 const source=fixture();const opponent=receive(createDraftState(source),draft(source,[pick(1),pick(2,'unknown-opponent')]));
 assert.ok(effective(opponent).unavailableIds.includes('unknown-opponent'));assert.equal(effective(opponent).personalizationAvailable,true);
 assert.equal(recommend(source,effective(opponent)).candidates.length,3);
 const own=receive(createDraftState(source),draft(source,[pick(1,'unknown-own')]));
 assert.deepEqual(effective(own).unknownOwnPlayerIds,['unknown-own']);assert.equal(effective(own).personalizationAvailable,false);
 const result=recommend(source,effective(own));assert.equal(result.candidates.length,0);assert.match(result.reason,/unknown.*own|own.*unknown/i);
 assert.equal(result.players.length,Object.keys(source.playersById).length);
});
