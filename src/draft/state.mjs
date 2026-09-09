import {STATE_VERSION} from '../contracts.mjs';
import {fingerprintConfig} from '../sleeper/client.mjs';

/** Start with unknown availability. Prepared identities/config are read-only context. */
export function createDraftState(snapshot) {
 return {schemaVersion:STATE_VERSION,config:snapshot.config,playersById:snapshot.playersById,
  configFingerprint:snapshot.configFingerprint,revision:0,accepted:null,pending:null,
  corrections:[],nextCorrectionId:1,pendingRevision:0,lastRequestSequence:0,
  requiresPreparation:false,notices:[],freshness:{lastAttemptAt:null,lastCheckAt:null,
   lastChangedAt:null,lastError:null,connection:'unknown'}};
}

function samePick(a,b) {
 return a?.pickNo===b?.pickNo && a?.playerId===b?.playerId && a?.rosterId===b?.rosterId;
}
function firstDifference(before,after) {
 let i=0;while(i<Math.min(before.length,after.length)&&samePick(before[i],after[i]))i++;
 return i;
}
function retireCorrections(state,snapshot) {
 const byPlayer=new Map(snapshot.picks.map(p=>[p.playerId,p]));
 const bySlot=new Map(snapshot.picks.map(p=>[p.pickNo,p]));
 const notices=[...state.notices],corrections=[];
 for(const correction of state.corrections){
  const player=byPlayer.get(correction.playerId),slot=bySlot.get(correction.pickNo);
  if(correction.type==='taken'&&player){
   notices.push({code:'confirmed',correctionId:correction.id,
    message:`Sleeper confirmed ${correction.playerId} at pick ${player.pickNo}.`});
  }else if(correction.type==='my-pick'&&player?.pickNo===correction.pickNo&&player.rosterId===state.config.rosterId){
   notices.push({code:'confirmed',correctionId:correction.id,
    message:`Sleeper confirmed your ${correction.playerId} at pick ${correction.pickNo}.`});
  }else if(player){
   notices.push({code:'official-player-conflict',correctionId:correction.id,
    message:`Sleeper assigns ${correction.playerId} to roster ${player.rosterId} at pick ${player.pickNo}; cleared local ${correction.id}.`});
  }else if(slot){
   notices.push({code:'official-slot-conflict',correctionId:correction.id,
    message:`Sleeper pick ${slot.pickNo} is ${slot.playerId} for roster ${slot.rosterId}; cleared local ${correction.id}.`});
  }else corrections.push(correction);
 }
 return {corrections,notices};
}

/**
 * Reconcile a validated client result. The caller supplies request sequence,
 * starting domain revision and check time; this module never reads a clock.
 * Failures carry error instead of snapshot and retain the last usable acceptance.
 */
export function reconcileDraft(previous,incoming) {
 const {requestSequence,expectedRevision,checkedAt,snapshot,error}=incoming;
 if(expectedRevision!==previous.revision || !Number.isSafeInteger(requestSequence) ||
    requestSequence<=previous.lastRequestSequence)return previous;
 const freshness={...previous.freshness,lastAttemptAt:checkedAt};
 const state={...previous,lastRequestSequence:requestSequence,freshness};
 if(error || !snapshot){
  freshness.lastError=String(error?.message??error??'No validated draft snapshot');
  freshness.connection='error';
  return {...state,requiresPreparation:state.requiresPreparation||incoming.requiresPreparation===true};
 }
 if(snapshot.configFingerprint!==state.configFingerprint || snapshot.draftId!==state.config.draftId){
  freshness.lastError='Draft configuration changed; prepare again before personalized advice.';
  freshness.connection='error';return {...state,requiresPreparation:true};
 }
 freshness.lastCheckAt=checkedAt;freshness.lastError=null;freshness.connection='checked';
 const before=state.accepted?.picks??[],after=snapshot.picks;
 const first=firstDifference(before,after);
 if(state.accepted && first<before.length){
  // Identical held content keeps the token the user is reviewing across checks.
  const samePending=state.pending && state.pending.snapshot.picks.length===after.length &&
   firstDifference(state.pending.snapshot.picks,after)===after.length;
  const pendingRevision=samePending?state.pending.revision:state.pendingRevision+1;
  return {...state,pendingRevision,pending:{revision:pendingRevision,snapshot,
   diff:{firstChangedPick:first+1,removed:before.slice(first),added:after.slice(first)}}};
 }
 if(state.accepted && before.length===after.length){
  // Status and check/source metadata may change without a new action revision.
  return {...state,accepted:{...state.accepted,status:snapshot.status,fetchedAt:snapshot.fetchedAt}};
 }
 freshness.lastChangedAt=checkedAt;
 return {...state,accepted:snapshot,pending:null,revision:state.revision+1,
  ...retireCorrections(state,snapshot)};
}

function reject(status,message){throw Object.assign(new Error(message),{status});}

/** Apply one validated local intent without modifying the caller's state. */
export function applyLocalAction(state,action) {
 if(action?.expectedRevision!==state.revision)reject(409,'Obsolete expectedRevision; refresh the board.');
 const {type}=action;
 if(type==='undo'){
  if(!state.corrections.some(c=>c.id===action.correctionId))reject(422,'No such local correction; official picks cannot be undone.');
  return {...state,revision:state.revision+1,corrections:state.corrections.filter(c=>c.id!==action.correctionId)};
 }
 if(type==='accept-pending'){
  if(!state.pending)reject(422,'No pending draft to adopt.');
  if(action.pendingRevision!==state.pending.revision)reject(409,'Obsolete pending revision; review the current pending board.');
  const {snapshot,diff}=state.pending;
  const cleared=state.corrections.filter(c=>c.type==='taken'||c.pickNo>=diff.firstChangedPick);
  const retained=state.corrections.filter(c=>!cleared.includes(c));
  const reconciled=retireCorrections({...state,corrections:retained},snapshot);
  return {...state,...reconciled,accepted:snapshot,pending:null,revision:state.revision+1,
   freshness:{...state.freshness,lastChangedAt:state.freshness.lastCheckAt},
   notices:[...reconciled.notices,{code:'pending-adopted',clearedCorrectionIds:cleared.map(c=>c.id),
    message:`Adopted reviewed Sleeper board from pick ${diff.firstChangedPick}; cleared ${cleared.length} local corrections.`}]};
 }
 if(type!=='taken'&&type!=='my-pick')reject(422,'Unknown local action.');
 if(typeof action.playerId!=='string'||!Object.hasOwn(state.playersById,action.playerId))reject(422,'Unknown player identity.');
 const effective=deriveEffectiveDraft(state,state.config);
 if(effective.unavailableIds.includes(action.playerId))reject(422,'Player is already picked or locally marked unavailable.');
 if(type==='my-pick'){
  if(!effective.availabilityKnown)reject(422,'Draft availability is unknown; accept a validated board first.');
  if(!effective.personalizationAvailable)reject(422,effective.unavailableReason);
  if(!Number.isSafeInteger(action.pickNo)||!state.config.ownPicks.includes(action.pickNo))reject(422,'Invalid or non-owned pick slot.');
  if(action.pickNo!==effective.remainingPicks[0])reject(422,'Own pick must occupy the next unfilled selection; slot is occupied or out of sequence.');
 }
 const correction={id:`local-${state.nextCorrectionId}`,type,playerId:action.playerId,
  ...(type==='my-pick'?{pickNo:action.pickNo}:{})};
 return {...state,revision:state.revision+1,nextCorrectionId:state.nextCorrectionId+1,
  corrections:[...state.corrections,correction]};
}

/** Derive schedule and authoritative ownership, without inventing opponent picks. */
export function deriveEffectiveDraft(state,config) {
 const official=state.accepted?.picks??[];
 const ownPicks=[...official.filter(p=>p.rosterId===config.rosterId).map(p=>({...p,source:'official'})),
  ...state.corrections.filter(c=>c.type==='my-pick').map(c=>({playerId:c.playerId,pickNo:c.pickNo,rosterId:config.rosterId,source:'local',correctionId:c.id}))]
  .sort((a,b)=>a.pickNo-b.pickNo);
 const occupied=new Set([...official.map(p=>p.pickNo),...ownPicks.map(p=>p.pickNo)]);
 const remainingPicks=config.ownPicks.filter(n=>!occupied.has(n));
 const ownPlayerIds=ownPicks.map(p=>p.playerId);
 const unknownOwnPlayerIds=ownPlayerIds.filter(id=>!Object.hasOwn(state.playersById,id));
 const availabilityKnown=state.accepted!==null;
 let unavailableReason=null;
 if(state.requiresPreparation||fingerprintConfig(config)!==state.configFingerprint)unavailableReason='Configuration changed; prepare again.';
 else if(!availabilityKnown)unavailableReason='Draft availability is unknown until a validated or saved board is accepted.';
 else if(unknownOwnPlayerIds.length)unavailableReason=`Unknown own player identities: ${unknownOwnPlayerIds.join(', ')}.`;
 return {revision:state.revision,configFingerprint:state.configFingerprint,availabilityKnown,
  personalizationAvailable:unavailableReason===null,unavailableReason,officialCount:official.length,
  ownPicks,ownPlayerIds,unknownOwnPlayerIds,remainingPicks,remainingSelections:remainingPicks.length,
  nextPicks:remainingPicks.slice(0,2),unavailableIds:[...new Set([...official.map(p=>p.playerId),...state.corrections.map(c=>c.playerId)])].sort(),
  corrections:state.corrections,notices:state.notices,freshness:state.freshness};
}
