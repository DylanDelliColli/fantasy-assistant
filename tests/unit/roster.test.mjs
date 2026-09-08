import test from 'node:test';
import assert from 'node:assert/strict';
import {assignRoster,canCompleteRoster,canAddUnderCaps} from '../../src/draft/roster.mjs';
import {rulePlayer as p,fullStarters,ruleSnapshot} from '../fixtures/rankings.mjs';

test('maximum matching assigns dualRB/WR to WR, RB-only to RB and TE-only to FLEX',()=>{
 const players=[p('a-dual','RB',{fantasyPositions:['RB','WR']}),p('b-rb','RB'),p('c-te','TE')];
 const result=assignRoster(players,['RB','WR','FLEX']);
 assert.equal(result.filledCount,3);assert.deepEqual(result.starters.map(s=>s.playerId),['b-rb','a-dual','c-te']);
 assert.deepEqual(result.missingSlots,[]);assert.deepEqual(assignRoster([...players].reverse(),['RB','WR','FLEX']),result);
});
test('one dual fills one slot only, with stable dedicated-before-FLEX and slot/player ties',()=>{
 const dual=p('dual','RB',{fantasyPositions:['RB','WR']});
 const result=assignRoster([dual],['FLEX','WR','RB']);
 assert.equal(result.filledCount,1);assert.deepEqual(result.starters.map(s=>s.playerId),[null,'dual',null]);
 const two=assignRoster([p('9','RB'),p('10','RB')],['RB','FLEX']);
 assert.deepEqual(two.starters.map(s=>s.playerId),['10','9']);
 assert.equal(assignRoster([dual,dual],['RB','WR']).filledCount,1);
});
test('completion requires distinct available players: one dual cannot fill two missing RB/WR',()=>{
 const dual=p('dual','RB',{fantasyPositions:['RB','WR']});
 const input={owned:[],available:[dual],rosterPositions:['RB','WR'],remainingSelections:2};
 assert.equal(canCompleteRoster(input).feasible,false);
 assert.equal(canCompleteRoster({...input,available:[dual,dual]}).feasible,false);
 assert.equal(canCompleteRoster({...input,available:[dual,p('rb','RB')]}).feasible,true);
 assert.equal(canCompleteRoster({...input,available:[dual,p('rb','RB')],remainingSelections:1}).feasible,false);
});
test('completion can reassign owned dual eligibility and excludes ineligible future identities',()=>{
 const owned=[p('dual','RB',{fantasyPositions:['RB','WR']})];
 const input={owned,available:[p('rb','RB')],rosterPositions:['RB','WR'],remainingSelections:1};
 assert.equal(canCompleteRoster(input).feasible,true);
 assert.equal(canCompleteRoster({...input,available:[owned[0]]}).feasible,false);
 assert.equal(canCompleteRoster({...input,available:[p('rb','RB',{eligible:false})]}).feasible,false);
});
test('actual thirteen slots contain nine starters and four bench; reserve is never draft capacity',()=>{
 const starters=fullStarters(),snapshot=ruleSnapshot(starters);
 const players=[...starters,...Array.from({length:4},(_,i)=>p(`bench-${i}`,'WR'))];
 const result=assignRoster(players,snapshot.config.rosterPositions);
 assert.equal(result.filledCount,9);assert.equal(result.bench.length,4);assert.equal(result.benchCapacity,4);
 assert.equal(result.draftCapacity,13);assert.equal(result.overflow.length,0);
 const extra=assignRoster([...players,p('reserve-is-not-bench','RB')],snapshot.config.rosterPositions);
 assert.equal(extra.bench.length,4);assert.equal(extra.overflow.length,1);assert.equal(extra.draftCapacity,13);
});
test('caps count one canonical policyPosition; existing excess rejects only additions in that position',()=>{
 const owned=[p('dual','QB',{fantasyPositions:['QB','TE']}),p('q2','QB'),p('q3','QB'),p('k','K'),p('d','DEF'),p('t1','TE'),p('t2','TE')];
 const counts=assignRoster(owned,['QB','TE','K','DEF','BN','BN','BN']).policyCounts;
 assert.equal(counts.QB,3);assert.equal(counts.TE,2);assert.equal(counts.K,1);assert.equal(counts.DEF,1);
 for(const pos of ['QB','TE','K','DEF'])assert.equal(canAddUnderCaps(owned,p(`new-${pos}`,pos)),false,pos);
 for(const pos of ['RB','WR'])assert.equal(canAddUnderCaps(owned,p(`new-${pos}`,pos)),true,pos);
 assert.equal(canAddUnderCaps([owned[0]],p('te','TE')),true);
});
test('completion respects future policy caps even when extra eligibility could fill the missing slot',()=>{
 const owned=[p('q1','QB'),p('q2','QB')],dual=p('dual','QB',{fantasyPositions:['QB','WR']});
 const input={owned,available:[dual],rosterPositions:['QB','WR','BN'],remainingSelections:1};
 assert.equal(canCompleteRoster(input).feasible,false);
 assert.equal(canCompleteRoster({...input,available:[p('wr','WR')]}).feasible,true);
 // Three existing QBs do not poison an otherwise feasible WR addition.
 assert.equal(canCompleteRoster({...input,owned:[...owned,p('q3','QB')],available:[p('wr','WR')]}).feasible,true);
});
