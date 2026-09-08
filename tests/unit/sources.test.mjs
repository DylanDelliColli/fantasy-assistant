import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSources, validateCoverage, isFreshPlayerCache} from '../../src/data/sources.mjs';
import {sourceFixture, NOW, TEAMS} from '../fixtures/sleeper.mjs';
const provenance={players:{url:'https://fixture/players',fetchedAt:NOW},projections:{url:'https://fixture/projections',season:'2026',scoring:'HALF',fetchedAt:NOW},history:{url:'https://fixture/history',season:'2025',scoring:'HALF',fetchedAt:NOW}};
function normalize(f=sourceFixture()){return normalizeSources({...f,season:'2026',sources:provenance});}

test('ADP rejects absent, null, nonfinite, nonpositive, sentinel and nonnumeric values; zero points remain zero',()=>{
 for(const value of [undefined,null,NaN,Infinity,-Infinity,0,-1,999,'12','']){
  const f=sourceFixture(); f.projections[0].stats.adp_half_ppr=value;
  const p=normalize(f)['10001']; assert.equal(p.adp,null); assert.equal(p.projectionPoints,0); assert.equal(p.eligible,false);
 }
 const f=sourceFixture();delete f.projections[0].stats.pts_half_ppr;f.history[0].stats.pts_half_ppr=0;
 const p=normalize(f)['10001'];assert.equal(p.projectionPoints,null);assert.equal(p.historyPoints,0);
 f.projections[0].stats.pts_half_ppr=Infinity;assert.equal(normalize(f)['10001'].projectionPoints,null);
});
test('source-specific times, eligibility, primary position and fixed ADP bands survive normalization',()=>{
 const f=sourceFixture();f.players['10001'].position='DB';f.players['10001'].fantasy_positions=['DB','WR'];f.players['10001'].news_updated=77;
 f.projections[0].updated_at=null;f.projections[0].last_modified=55;
 const p=normalize(f);assert.equal(p['10001'].policyPosition,'WR');assert.deepEqual(p['10001'].fantasyPositions,['DB','WR']);
 assert.equal(p['10001'].sourceUpdatedAt.players,77);assert.equal(p['10001'].sourceUpdatedAt.projections,55);
 assert.equal(p['10001'].sourceUpdatedAt.history,123);assert.equal(p['10001'].adpBand,0);assert.equal(p['10013'].adpBand,1);
 f.players['10002'].active=false;f.players['10003'].team=null;f.players['10004'].team='FA';f.players['10005'].fantasy_positions=['DB'];
 const excluded=normalize(f);for(const id of ['10002','10003','10004','10005']){assert.ok(excluded[id]);assert.equal(excluded[id].eligible,false);assert.equal(excluded[id].adpBand,null);}
 f.players['10001'].position='QB';f.players['10001'].fantasy_positions=['WR','QB'];assert.equal(normalize(f)['10001'].policyPosition,'QB');
});
test('gp values never generate per-game fields or alter points',()=>{
 const f=sourceFixture();const a=normalize(f)['10001'];f.projections[0].stats.gp=1;f.history[0].stats.gp=18;
 assert.deepEqual(normalize(f)['10001'],a);assert.equal(Object.keys(a).some(k=>/per.?game/i.test(k)),false);
});
test('ADP sorting moves a first-input player at value400 into band33',()=>{
 const f=sourceFixture();f.projections[0].stats.adp_half_ppr=400;const p=normalize(f);
 assert.equal(p['10001'].adpBand,33);assert.equal(p['10013'].adpBand,0);assert.equal(p['10014'].adpBand,1);
});
test('ADP lexical string IDs10 and9 split tied ordinal positions12 and13 across bands0 and1',()=>{
 const f=sourceFixture();
 for(const [oldId,newId] of [['10001','9'],['10013','10']]){
  f.players[newId]={...f.players[oldId],player_id:newId};delete f.players[oldId];
  for(const rows of [f.projections,f.history])rows.find(p=>p.player_id===oldId).player_id=newId;
  f.projections.find(p=>p.player_id===newId).stats.adp_half_ppr=12;
 }
 f.projections.find(p=>p.player_id==='10012').stats.adp_half_ppr=11.5;
 const p=normalize(f);assert.equal(p['10'].adpBand,0);assert.equal(p['9'].adpBand,1);
 assert.equal(p['10012'].adpBand,0);assert.equal(p['10014'].adpBand,1);
});
test('exactly 400 eligible ADP identities passes and 399 fails',()=>{
 const p=normalize();assert.equal(validateCoverage(p).total,400);p['10001'].adp=null;
 assert.throws(()=>validateCoverage(p),/400|coverage/i);
});
for(const [pos,floor] of Object.entries({QB:14,RB:42,WR:42,TE:14,K:14,DEF:14})){
 test(`coverage enforces independent ${pos} minimum ${floor} even above 400 total`,()=>{
  const p=normalize();const keep=Object.values(p).filter(x=>x.policyPosition===pos);
  for(const item of keep.slice(floor-1)) item.adp=null;
  for(let i=0;i<200;i++)p[`extra${i}`]={...p['10041'],id:`extra${i}`,policyPosition:pos==='RB'?'WR':'RB',adp:500+i};
  assert.throws(()=>validateCoverage(p),new RegExp(pos));
  keep[floor-1].adp=20;assert.ok(validateCoverage(p).total>=400);
 });
}
test('wrong season, duplicate source IDs, malformed player map and key/ID mismatch reject',()=>{
 for(const field of ['projections','history']){
  const f=sourceFixture();f[field][0].season='2024';assert.throws(()=>normalize(f),/season/i);
  const duplicate=sourceFixture();duplicate[field].push({...duplicate[field][0]});assert.throws(()=>normalize(duplicate),/duplicate/i);
 }
 const f=sourceFixture();f.players['10001'].player_id='different';assert.throws(()=>normalize(f),/identity|ID/i);
 assert.throws(()=>normalize({...sourceFixture(),players:[]}),/player/i);
 const invalid=sourceFixture();invalid.projections[0].stats=null;assert.throws(()=>normalize(invalid),/stats|schema/i);
});
test('optional history absence leaves current data intact and metadata separate',()=>{
 const f=sourceFixture();f.history=null;const p=normalize(f)['10001'];assert.equal(p.historyPoints,null);assert.equal(p.sourceUpdatedAt.history,null);
 assert.equal(p.adp,1);assert.equal(p.projectionPoints,0);
 assert.equal(TEAMS.length,32);
});
test('player cache expires at exactly 24 hours and future/invalid timestamps do not count as fresh',()=>{
 const now=Date.parse(NOW);assert.equal(isFreshPlayerCache(new Date(now-86400000+1).toISOString(),now),true);
 for(const value of [new Date(now-86400000).toISOString(),new Date(now+1).toISOString(),'bad',null])assert.equal(isFreshPlayerCache(value,now),false);
});
