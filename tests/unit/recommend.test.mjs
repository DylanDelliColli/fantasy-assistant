import test from 'node:test';
import assert from 'node:assert/strict';
import {recommend} from '../../src/draft/recommend.mjs';
import {normalizeSources} from '../../src/data/sources.mjs';
import {sourceFixture} from '../fixtures/sleeper.mjs';
import {rulePlayer as p,ruleSnapshot,effectiveFixture,fullStarters} from '../fixtures/rankings.mjs';

function board(owned,candidates,options={}){
 const snapshot=ruleSnapshot([...owned,...candidates],{rankingMode:options.mode??'ecr'});
 const effective=effectiveFixture(snapshot,{owned,...options});return {snapshot,effective,result:recommend(snapshot,effective)};
}
const ids=result=>result.candidates.map(c=>c.playerId);
function needingWR(){return fullStarters().filter(p=>p.id!=='own-4');}
const noEcr={ecrRank:null,ecrTier:null,ecrSourceId:null};

for(const n of [0,1,2,3,4])test(`returns ${Math.min(n,3)} distinct surviving candidates from ${n} available`,()=>{
 const owned=fullStarters(),candidates=Array.from({length:n},(_,i)=>p(`rb-${i}`,'RB',{ecrRank:i+1}));
 const {result}=board(owned,candidates);assert.equal(result.candidates.length,Math.min(n,3));
 assert.equal(new Set(ids(result)).size,result.candidates.length);assert.deepEqual(ids(result),candidates.slice(0,3).map(p=>p.id));
 if(!n){assert.equal(result.status,'unavailable');assert.match(result.reason,/candidate|feasible/i);}
});
test('hard eligibility and accepted/local availability exclude every rejected identity without padding',()=>{
 const owned=fullStarters(),bad=[
  p('inactive','RB',{active:false,eligibleBase:false,eligible:false}),
  p('teamless','RB',{team:null,eligibleBase:false,eligible:false}),
  p('unsupported','DB',{policyPosition:null,eligibleBase:false,eligible:false}),
  p('no-rank','RB',{...noEcr,adp:null,adpBand:null,eligible:false}),
  p('official','RB'),p('local-taken','RB'),p('local-own','RB'),
  p('second-k','K'),p('second-def','DEF')];
 const good=p('good','RB',{ecrRank:900});
 const {result}=board(owned,[...bad,good],{unavailable:['official','local-taken','local-own']});
 assert.deepEqual(ids(result),['good']);assert.equal(result.players.length,owned.length+bad.length+1);
 assert.equal(result.players.find(p=>p.id==='local-taken').available,false);
});
test('same-tier WR starter beats a better-ranked RB when RB/FLEX full, without crossing ordinary tiers',()=>{
 const owned=needingWR(),rb=p('rb','RB',{ecrRank:1,ecrTier:1}),wr=p('wr','WR',{ecrRank:2,ecrTier:1});
 let {result}=board(owned,[rb,wr]);assert.deepEqual(ids(result),['wr','rb']);
 assert.equal(result.candidates[0].fillsStarter,true);assert.match(result.candidates[0].reasons.join(' '),/WR.*starter|starter.*WR/);
 result=board(owned,[rb,{...wr,ecrTier:2}]).result;assert.deepEqual(ids(result),['rb','wr']);
});
test('ECR ties use rank then exact ADP and lexical ID; missing ECR follows ranked within group',()=>{
 const owned=fullStarters();const candidates=[p('9','RB',{ecrRank:2,adp:12}),p('10','RB',{ecrRank:2,adp:12}),p('best','RB',{ecrRank:1,adp:99}),p('unranked','RB',{...noEcr,adp:1})];
 assert.deepEqual(ids(board(owned,candidates).result),['best','10','9']);
 const {result}=board(owned,[candidates[0],candidates[3],p('unranked-later','WR',{...noEcr,adp:2})]);
 assert.deepEqual(ids(result),['9','unranked','unranked-later']);assert.equal(result.candidates[1].ecrTier,null);
});
for(const mode of ['ecr','adp-only'])test(`${mode} unranked exact ADP beats opposing lexical IDs within one group`,()=>{
 const candidates=[p('10044','RB',{...noEcr,adp:44.8,adpBand:3}),p('10045','RB',{...noEcr,adp:44.2,adpBand:3})];
 const {result}=board(fullStarters(),candidates,{mode});
 assert.equal(result.status,'ready');assert.equal(result.candidates.length,2);
 assert.ok(result.candidates.every(c=>c.ecrRank===null&&c.ecrTier===null&&c.adpBand===3&&c.deferral==='ordinary'&&!c.fillsStarter));
 assert.deepEqual(ids(result),['10045','10044']);
 assert.deepEqual(result.candidates.map(c=>c.adp),[44.2,44.8]);
});
test('fixed prepared ADP12/13 bands and lexical ties survive earlier removals',()=>{
 const owned=needingWR();const early=Array.from({length:11},(_,i)=>p(`early-${i}`,'RB',{...noEcr,adp:i+1,adpBand:0}));
 const band12=p('10','RB',{...noEcr,adp:12,adpBand:0}),band13=p('9','WR',{...noEcr,adp:12,adpBand:1});
 const {result}=board(owned,[...early,band12,band13,p('later','WR',{...noEcr,adp:14,adpBand:1})],{mode:'adp-only',unavailable:early.map(p=>p.id)});
 assert.deepEqual(ids(result),['10','9','later']);assert.equal(result.candidates[0].adpBand,0);assert.equal(result.candidates[1].adpBand,1);
 // Within the same fixed band starter fit precedes exact ADP.
 assert.deepEqual(ids(board(owned,[band12,{...band13,adpBand:0}],{mode:'adp-only'}).result),['9','10']);
 const ties=board(fullStarters(),[p('9','RB',{...noEcr,adp:12,adpBand:1}),p('10','RB',{...noEcr,adp:12,adpBand:1})],{mode:'adp-only'}).result;
 assert.deepEqual(ids(ties),['10','9']);
});
test('backup QB/TE defers while offense has holes; dual offensive starter escapes deferral',()=>{
 const owned=needingWR(),backup=p('backup','QB',{ecrRank:1,ecrTier:1}),dual=p('dual','QB',{fantasyPositions:['QB','WR'],ecrRank:2,ecrTier:1});
 const ordinary=p('ordinary','WR',{ecrRank:100,ecrTier:20}),te=p('backup-te','TE',{ecrRank:3,ecrTier:1});
 let {result}=board(owned,[backup,dual,ordinary,te]);assert.deepEqual(ids(result),['dual','ordinary','backup']);
 assert.equal(result.candidates[0].deferral,'ordinary');assert.equal(result.candidates[2].deferral,'backup');
 result=board(fullStarters(),[backup,ordinary,te]).result;assert.deepEqual(ids(result),['backup','backup-te','ordinary']);
});
test('early K/DEF are last outer group; final two selections lift deferral in ECR and ADP-only',()=>{
 const owned=fullStarters().filter(p=>!['K','DEF'].includes(p.policyPosition));
 const candidates=[p('k','K',{ecrRank:1,ecrTier:1,adp:1,adpBand:0}),p('def','DEF',{ecrRank:2,ecrTier:1,adp:2,adpBand:0}),p('rb','RB',{ecrRank:80,ecrTier:10,adp:80,adpBand:6})];
 for(const mode of ['ecr','adp-only']){
  const early=board(owned,candidates,{mode,remainingSelections:6}).result;assert.deepEqual(ids(early),['rb','k','def']);
  const late=board([...owned,...Array.from({length:4},(_,i)=>p(`bench-${i}`,'WR'))],candidates,{mode,remainingSelections:2}).result;
  assert.deepEqual(ids(late),['k','def']);assert.ok(late.candidates.every(c=>c.deferral==='ordinary'));
 }
 // Deferral can lift with only one missing specialist and a spare final selection.
 const lateOwned=[...fullStarters().filter(p=>p.policyPosition!=='K'),p('b1','WR'),p('b2','WR'),p('b3','WR')];
 assert.deepEqual(ids(board(lateOwned,[candidates[0],candidates[2]],{remainingSelections:2}).result),['k','rb']);
});
test('ordinary unranked RB precedes deferred ranked DEF; same-group ranked still precedes unranked',()=>{
 const owned=fullStarters().filter(p=>p.policyPosition!=='DEF');
 const ranked=p('ranked-rb','RB',{ecrRank:500,ecrTier:40}),unranked=p('unranked-rb','RB',{...noEcr,adp:1}),def=p('def','DEF',{ecrRank:1,ecrTier:1});
 assert.deepEqual(ids(board(owned,[def,unranked,ranked]).result),['ranked-rb','unranked-rb','def']);
});
test('QB/TE caps exclude additions without poisoning unrelated candidates or double-counting duals',()=>{
 const owned=[...fullStarters(),p('q2','QB'),p('q3','QB'),p('t2','TE')];
 const candidates=[p('qb','QB'),p('te','TE'),p('k','K'),p('def','DEF'),p('rb','RB')];
 assert.deepEqual(ids(board(owned,candidates,{remainingSelections:1}).result),['rb']);
 const dualOwned=fullStarters().map(x=>x.policyPosition==='QB'?{...x,fantasyPositions:['QB','TE']}:x);
 assert.deepEqual(ids(board(dualOwned,[p('te2','TE')]).result),['te2']);
});
test('eleven owned missing K/DEF force those positions; an RB cannot consume their reserved selections',()=>{
 const owned=[...fullStarters().filter(p=>!['K','DEF'].includes(p.policyPosition)),...Array.from({length:4},(_,i)=>p(`b${i}`,'RB'))];
 const {result}=board(owned,[p('rb','RB',{ecrRank:1,ecrTier:1}),p('k','K',{ecrRank:100}),p('def','DEF',{ecrRank:101})]);
 assert.deepEqual(ids(result),['k','def']);assert.equal(result.ownRoster.length,11);assert.deepEqual(result.nextPicks,[168,169]);
});
test('impossible distinct-player completion preserves browsing and returns no padded shortlist',()=>{
 const owned=fullStarters().filter(p=>!['own-1','own-3'].includes(p.id));
 const dual=p('only-dual','RB',{fantasyPositions:['RB','WR']});
 const {result}=board(owned,[dual]);assert.deepEqual(result.candidates,[]);assert.equal(result.status,'unavailable');
 assert.match(result.reason,/complet.*starter|starter.*complet/i);assert.equal(result.players.length,owned.length+1);
});
test('source points/history/injury are context only; deterministic candidates and exact reasons contain no derived claims',()=>{
 const owned=fullStarters(),a=p('a','RB',{ecrRank:1,ecrTier:2,adp:22}),b=p('b','RB',{ecrRank:2,ecrTier:2,adp:23});
 const first=board(owned,[a,b]);const second=board(owned,[{...a,projectionPoints:-999,historyPoints:0,injuryStatus:'Out',injuryNotes:'Provider tag only'}, {...b,projectionPoints:9000,historyPoints:9999,injuryStatus:'Healthy?'}]);
 assert.deepEqual(ids(first.result),['a','b']);assert.deepEqual(ids(second.result),ids(first.result));
 assert.deepEqual(second.result.candidates.map(c=>c.reasons),first.result.candidates.map(c=>c.reasons));
 assert.deepEqual(recommend(first.snapshot,first.effective),first.result);
 assert.equal(first.result.candidates[0].ecrRank,1);assert.equal(first.result.candidates[0].ecrTier,2);assert.equal(first.result.candidates[0].adp,22);
 assert.match(first.result.candidates[0].reasons.join(' '),/ECR.*2.*1/);assert.match(first.result.candidates[0].reasons.join(' '),/RB.*depth|depth.*RB/);
 assert.doesNotMatch(second.result.candidates.map(c=>c.reasons.join(' ')).join(' '),/healthy|per.game|surviv|odds|percent|penalty/i);
 assert.equal(second.result.players.find(p=>p.id==='a').injuryStatus,'Out');
 const before=structuredClone(first);recommend(first.snapshot,first.effective);assert.deepEqual(first,before);
});
test('unknown availability, unresolved own/config identity and completed draft have separate results',()=>{
 const snapshot=ruleSnapshot([...fullStarters(),p('rb','RB')]);
 for(const extra of [{availabilityKnown:false},{personalizationAvailable:false,unavailableReason:'Unknown own identity'}, {configFingerprint:'changed'}]){
  const result=recommend(snapshot,effectiveFixture(snapshot,extra));assert.equal(result.status,'unavailable');assert.equal(result.candidates.length,0);assert.ok(result.reason);assert.equal(result.players.length,10);
 }
 const complete=recommend(snapshot,effectiveFixture(snapshot,{owned:fullStarters(),remainingSelections:0}));
 assert.equal(complete.status,'complete');assert.deepEqual(complete.candidates,[]);assert.deepEqual(complete.nextPicks,[]);assert.equal(complete.ownRoster.length,9);assert.match(complete.reason,/complete/i);
});
test('one full normalized400-player calculation is deterministic and respects prepared ADP bands',()=>{
 const raw=sourceFixture(),playersById=normalizeSources({...raw,season:'2026'});
 const snapshot=ruleSnapshot(Object.values(playersById),{rankingMode:'adp-only'}),effective=effectiveFixture(snapshot);
 const before=structuredClone(snapshot),result=recommend(snapshot,effective);
 assert.equal(result.players.length,400);assert.deepEqual(ids(result),['10001','10002','10003']);
 assert.equal(result.candidates[0].adp,1);assert.equal(result.candidates[0].adpBand,0);
 assert.deepEqual(recommend(snapshot,effective),result);assert.deepEqual(snapshot,before);
});
