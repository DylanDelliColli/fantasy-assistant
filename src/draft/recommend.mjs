import {assignRoster,canCompleteRoster,canAddUnderCaps} from './roster.mjs';

const lexical=(a,b)=>a<b?-1:a>b?1:0;
const value=n=>n??Infinity;
const positive=n=>Number.isFinite(n)&&n>0;

function compare(a,b,mode){
 const group=a.group-b.group;
 if(group)return group;
 if(mode==='ecr'){
  const aRanked=positive(a.player.ecrRank),bRanked=positive(b.player.ecrRank);
  if(aRanked!==bRanked)return aRanked?-1:1;
  if(aRanked){
   const ranked=value(a.player.ecrTier)-value(b.player.ecrTier)||Number(b.fillsStarter)-Number(a.fillsStarter)||a.player.ecrRank-b.player.ecrRank;
   if(ranked)return ranked;
  }
 }else{
  const band=value(a.player.adpBand)-value(b.player.adpBand)||Number(b.fillsStarter)-Number(a.fillsStarter);
  if(band)return band;
 }
 return value(a.player.adp)-value(b.player.adp)||lexical(a.player.id,b.player.id);
}

function candidateResult({player,fillsStarter,filledPosition,group},mode){
 const source=mode==='ecr'&&positive(player.ecrRank)
  ?`ECR tier ${player.ecrTier??'unavailable'}, rank ${player.ecrRank}; ADP ${player.adp??'unavailable'}.`
  :mode==='ecr'?`No ECR rank; ADP ${player.adp}.`
   :`ADP ${player.adp}; fixed prepared band ${player.adpBand+1} (12 places).`;
 const roster=fillsStarter?`Fills ${filledPosition} starter.`:`Adds ${player.policyPosition} depth.`;
 const deferred=group===1?'Backup QB/TE deferred while offensive starters are missing.':group===2?'K/DEF deferred until the final two own selections.':null;
 return {playerId:player.id,name:player.name,policyPosition:player.policyPosition,
  fantasyPositions:player.fantasyPositions,ecrRank:player.ecrRank,ecrTier:player.ecrTier,
  ecrSourceId:player.ecrSourceId,adp:player.adp,adpBand:player.adpBand,fillsStarter,
  deferral:['ordinary','backup','early-specialist'][group],reasons:[source,roster,...(deferred?[deferred]:[])]};
}

/** Pure deterministic shortlist over the prepared source and effective acceptance. */
export function recommend(snapshot,effectiveState) {
 const {playersById,config,rankingMode}=snapshot;
 const unavailable=new Set(effectiveState.unavailableIds);
 const players=Object.values(playersById).sort((a,b)=>lexical(a.id,b.id))
  .map(p=>({...p,available:effectiveState.availabilityKnown?!unavailable.has(p.id):null}));
 const ownRoster=effectiveState.ownPlayerIds.map(id=>playersById[id]??{id,name:`Unknown player ${id}`,unknown:true});
 const base={rankingMode,ownRoster,nextPicks:effectiveState.nextPicks,players,candidates:[]};
 if(snapshot.configFingerprint!==effectiveState.configFingerprint)return {...base,status:'unavailable',reason:'Configuration changed; prepare again.'};
 if(!effectiveState.availabilityKnown)return {...base,status:'unavailable',reason:'Draft availability is unknown until a validated or saved board is accepted.'};
 if(!effectiveState.personalizationAvailable)return {...base,status:'unavailable',reason:effectiveState.unavailableReason??'Own identity or configuration is unresolved.'};
 const remainingSelections=effectiveState.remainingSelections;
 if(remainingSelections===0)return {...base,status:'complete',reason:'Your draft selections are complete.'};
 const available=players.filter(p=>p.eligible&&p.eligibleBase&&!unavailable.has(p.id)&&
  (rankingMode==='ecr'?(positive(p.ecrRank)||positive(p.adp)):positive(p.adp)));
 const completion=canCompleteRoster({owned:ownRoster,available,rosterPositions:config.rosterPositions,remainingSelections});
 if(!completion.feasible)return {...base,status:'unavailable',reason:completion.reason};
 const before=assignRoster(ownRoster,config.rosterPositions),survivors=[];
 for(const player of available){
  if(!canAddUnderCaps(ownRoster,player))continue;
  const afterOwned=[...ownRoster,player];
  if(!canCompleteRoster({owned:afterOwned,available:available.filter(p=>p.id!==player.id),
   rosterPositions:config.rosterPositions,remainingSelections:remainingSelections-1}).feasible)continue;
  const after=assignRoster(afterOwned,config.rosterPositions);
  const fillsStarter=after.filledCount>before.filledCount;
  const fillsOffense=after.offensiveFilled>before.offensiveFilled;
  const filledPosition=before.missingSlots.find(slot=>after.starters.some(s=>s.slotIndex===slot.slotIndex&&s.playerId!==null))?.position;
  let group=0;
  if(['K','DEF'].includes(player.policyPosition)&&remainingSelections>2)group=2;
  else if(['QB','TE'].includes(player.policyPosition)&&before.offensiveMissing>0&&!fillsOffense)group=1;
  survivors.push({player,fillsStarter,filledPosition,group});
 }
 survivors.sort((a,b)=>compare(a,b,rankingMode));
 const candidates=survivors.slice(0,3).map(candidate=>candidateResult(candidate,rankingMode));
 return {...base,candidates,status:candidates.length?'ready':'unavailable',
  reason:candidates.length?null:'No available candidate permits starter completion under policy caps.'};
}
