export function rankingsFixture(players) {
 return {year:'2026',week:'0',scoring:'HALF',players:Object.values(players).map((p,i)=>({player_id:String(50000+i),player_name:p.full_name,player_team_id:p.team,player_position_id:p.position==='DEF'?'DST':p.position,rank_ecr:i+1,tier:Math.floor(i/12)+1}))};
}
export function rankingsHtml(ecr) {return `<script>globalThis.sourceExecuted=true; var ecrData = ${JSON.stringify(ecr)}; globalThis.sourceExecuted=true;</script>`;}
import {normalizeContext, fingerprintConfig} from '../../src/sleeper/client.mjs';
import {contextFixture, NOW} from './sleeper.mjs';

// Small normalized records for pure rule tests; HTTP integration prepares real sources.
export function rulePlayer(id, position, extra = {}) {
 return {id, name:`Fictional ${id}`, team:'ARI', position, fantasyPositions:[position],
  policyPosition:position, active:true, eligibleBase:true, eligible:true,
  adp:100, adpBand:8, ecrRank:100, ecrTier:10, ecrSourceId:`ecr-${id}`,
  projectionPoints:null, historyPoints:null, injuryStatus:null, injuryBodyPart:null,
  injuryNotes:null, sourceUpdatedAt:{players:null,projections:null,history:null,ecr:null}, ...extra};
}
export function ruleSnapshot(players, extra = {}) {
 const config=normalizeContext(contextFixture());
 return {schemaVersion:1,snapshotId:'fictional-rules',preparedAt:NOW,config,
  configFingerprint:fingerprintConfig(config),sources:{},rankingMode:'ecr',
  playersById:Object.fromEntries(players.map(p=>[p.id,p])),importReport:{},...extra};
}
export function effectiveFixture(snapshot, {owned=[],unavailable=[],remainingSelections=13-owned.length,...extra} = {}) {
 const remainingPicks=snapshot.config.ownPicks.slice(13-remainingSelections);
 return {revision:1,configFingerprint:snapshot.configFingerprint,availabilityKnown:true,
  personalizationAvailable:true,unavailableReason:null,officialCount:owned.length,
  ownPlayerIds:owned.map(p=>p.id),unknownOwnPlayerIds:[],
  ownPicks:owned.map((p,i)=>({playerId:p.id,pickNo:snapshot.config.ownPicks[i],rosterId:'5',source:'official'})),
  unavailableIds:[...new Set([...owned.map(p=>p.id),...unavailable])],
  remainingPicks,remainingSelections,nextPicks:remainingPicks.slice(0,2),corrections:[],notices:[],...extra};
}
export function fullStarters() {
 return ['QB','RB','RB','WR','WR','TE','RB','K','DEF'].map((p,i)=>rulePlayer(`own-${i}`,p));
}
