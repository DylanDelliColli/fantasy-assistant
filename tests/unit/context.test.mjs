import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeContext,fingerprintConfig,normalizePicks} from '../../src/sleeper/client.mjs';
import {contextFixture,pick,LEAGUE,USER} from '../fixtures/sleeper.mjs';
function config(c=contextFixture()){return normalizeContext(c,{leagueId:LEAGUE,userId:USER});}
test('resolves roster5 separately from slot1, draft rounds13 and league season over clock',()=>{
 const c=config();assert.equal(c.rosterId,'5');assert.equal(c.ownSlot,1);assert.equal(c.rounds,13);assert.equal(c.teams,14);assert.equal(c.season,'2026');assert.equal(c.userId,USER);
 assert.deepEqual(c.ownPicks,[1,28,29,56,57,84,85,112,113,140,141,168,169]);assert.equal(c.reserveSlots,1);assert.equal(c.scoring.rec,0.5);
 const f=contextFixture();f.league.season='2027';f.draft.season='2027';assert.equal(config(f).season,'2027');
});
const unsupported={
 owner:c=>c.user.user_id='other',missingOwner:c=>c.rosters[4].owner_id='other',duplicateOwner:c=>c.rosters[0].owner_id=USER,
 leagueId:c=>c.league.league_id='other',draftLeague:c=>c.draft.league_id='other',draftId:c=>c.draft.draft_id='other',
 sport:c=>c.league.sport='nba',draftSport:c=>c.draft.sport='nba',badSeason:c=>c.league.season='bad',mismatchedSeason:c=>c.draft.season='2025',seasonType:c=>c.league.season_type='post',
 type:c=>c.draft.type='linear',teams:c=>c.draft.settings.teams=12,leagueTeams:c=>c.league.total_rosters=12,rounds:c=>c.draft.settings.rounds=3,reversal:c=>c.draft.settings.reversal_round=3,
 slots:c=>c.league.roster_positions.push('BN'),reserve:c=>c.league.settings.reserve_slots=2,ppr:c=>c.league.scoring_settings.rec=1,passTd:c=>c.league.scoring_settings.pass_td=6,
 badScoring:c=>c.league.scoring_settings.rush_yd='NaN',keeper:c=>c.draft.keepers={1:['10001']},rosterKeeper:c=>c.rosters[0].keepers=['10001'],trade:c=>c.tradedPicks.push({round:1}),leagueTrade:c=>c.leagueTradedPicks.push({round:1}),
 rosterCount:c=>c.rosters.pop(),duplicateRoster:c=>c.rosters[0].roster_id=5,missingOrder:c=>delete c.draft.draft_order[USER],duplicateSlot:c=>c.draft.draft_order[USER]=2,
 slotMismatch:c=>c.draft.slot_to_roster_id['1']=3,unsafeId:c=>c.user.user_id=9007199254740992,
 missingRounds:c=>delete c.draft.settings.rounds,missingReversal:c=>delete c.draft.settings.reversal_round
};
for(const [name,mutate] of Object.entries(unsupported))test(`unsupported configuration: ${name}`,()=>{const c=contextFixture();mutate(c);assert.throws(()=>config(c));});
test('fingerprint ignores display/status/time/map order, changes for scoring and order rules',()=>{
 const c=config(),a=fingerprintConfig(c),raw=contextFixture();raw.league.name='renamed';raw.draft.status='drafting';raw.draft.start_time=777;
 raw.league.scoring_settings=Object.fromEntries(Object.entries(raw.league.scoring_settings).reverse());raw.draft.draft_order=Object.fromEntries(Object.entries(raw.draft.draft_order).reverse());
 assert.equal(fingerprintConfig(config(raw)),a);assert.notEqual(fingerprintConfig({...c,scoring:{...c.scoring,rush_yd:0.2}}),a);
 for(const field of ['leagueId','draftId','userId','rosterId','season','sport','type','teams','rounds','reversalRound','rosterPositions','draftOrder','slotToRosterId','keepers','tradedPicks']){
  const changed=structuredClone(c);changed[field]=Array.isArray(c[field])?[...c[field],'changed']:typeof c[field]==='object'?{...c[field],extra:1}:'changed';assert.notEqual(fingerprintConfig(changed),a,field);
 }
});
test('picks sort contiguous unordered rows and normalize structural strings and authoritative roster IDs',()=>{
 const c=config();const p=pick(1,'90071992547409931234');p.pick_no='1';p.round='1';p.draft_slot='1';
 const picks=normalizePicks([pick(2,'unknown-opponent'),p],c);assert.deepEqual(picks.map(p=>p.pickNo),[1,2]);assert.equal(picks[0].playerId,'90071992547409931234');assert.equal(picks[0].rosterId,'5');assert.equal(picks[0].pickedBy,'');
 const own=pick(1);own.roster_id=3;assert.equal(normalizePicks([own],c)[0].rosterId,'3');assert.deepEqual(normalizePicks([],c),[]);
});
test('complete pick validation rejects gaps, duplicates and illegal fields',()=>{
 const c=config();const bad=[
 [pick(2)],[pick(1),pick(1)],[pick(1),pick(2,'10001')],
 ...[{pick_no:0},{pick_no:183},{pick_no:1.5},{round:2},{draft_slot:14},{player_id:''},{player_id:null},{player_id:{}},{player_id:9007199254740992},{roster_id:99},{picked_by:{}},{round:'1x'},{draft_slot:null},{pick_no:true}].map(change=>[{...pick(1),...change}])
 ];for(const rows of bad)assert.throws(()=>normalizePicks(rows,c),JSON.stringify(rows));
 assert.throws(()=>normalizePicks({},c));
 const rows=Array.from({length:28},(_,i)=>pick(i+1));assert.equal(normalizePicks(rows,c)[27].draftSlot,1);
 rows[27].draft_slot=14;assert.throws(()=>normalizePicks(rows,c),/slot/i);
});
test('supplied league/user rejects a coherent ownership remap from the confirmed roster5',()=>{
 const c=contextFixture(),other=c.rosters[0].owner_id;c.rosters[0].owner_id=USER;c.rosters[4].owner_id=other;
 const otherSlot=c.draft.draft_order[other];c.draft.slot_to_roster_id['1']=1;c.draft.slot_to_roster_id[otherSlot]=5;
 assert.throws(()=>config(c),/ownership|confirmed/i);
});
test('supplied league/user rejects a coherent draft-slot change from the confirmed slot1',()=>{
 const c=contextFixture(),other=Object.keys(c.draft.draft_order).find(id=>c.draft.draft_order[id]===2);c.draft.draft_order[USER]=2;c.draft.draft_order[other]=1;
 [c.draft.slot_to_roster_id['1'],c.draft.slot_to_roster_id['2']]=[c.draft.slot_to_roster_id['2'],c.draft.slot_to_roster_id['1']];
 assert.throws(()=>config(c),/slot|confirmed/i);
});
