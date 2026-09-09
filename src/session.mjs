import {readFile,open,mkdir,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BOARD_VERSION,STATE_VERSION} from './contracts.mjs';
import {loadSnapshot,writeJsonAtomic} from './data/snapshot.mjs';
import {loadContext,fetchDraftSnapshot,fingerprintConfig,normalizePicks} from './sleeper/client.mjs';
import {createDraftState,reconcileDraft,applyLocalAction,deriveEffectiveDraft} from './draft/state.mjs';
import {recommend} from './draft/recommend.mjs';

const realClock={now:Date.now,setTimeout,clearTimeout};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stamp=value=>value===null||(typeof value==='string'&&Number.isFinite(Date.parse(value)));
const error=(code,message,status=500)=>Object.assign(new Error(message),{code,status});
const savedKeys=['schemaVersion','configFingerprint','revision','accepted','pending','corrections','nextCorrectionId',
 'pendingRevision','lastRequestSequence','requiresPreparation','notices','freshness'];
const serialize=state=>Object.fromEntries(savedKeys.map(key=>[key,state[key]]));

export function retryDelay(failures,retryAfter,now){
 const base=Math.min(60000,10000*2**Math.min(3,Math.max(0,failures-1)));
 let requested=0;
 if(typeof retryAfter==='string'){
  if(/^\d+(?:\.\d+)?$/.test(retryAfter.trim()))requested=Number(retryAfter)*1000;
  else if(/[A-Za-z]/.test(retryAfter))requested=Date.parse(retryAfter)-now;
 }
 return Math.max(base,Number.isFinite(requested)?requested:0);
}
export function isOverdue({status,lastCheckAt,openedAt,lastError},now){
 return Boolean(lastError)||now-(lastCheckAt??openedAt)>=(status==='complete'?40000:15000);
}
export function isProcessAlive(pid,probe=process.kill){
 try{probe(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;}
}

async function acquireLock(directory){
 await mkdir(directory,{recursive:true,mode:0o700});
 const file=join(directory,'session.lock'),recovery=join(directory,'session.recovery.lock');
 const owner={pid:process.pid,token:randomUUID()},bytes=JSON.stringify(owner)+'\n';
 const create=async()=>{const handle=await open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}};
 const deadOwner=async()=>{
  let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){
   if(e.code==='ENOENT')return null;
   throw error('LOCKED','Draft ownership is uncertain; preserve the lock for recovery.');
  }
  if(!record(previous)||!Number.isSafeInteger(previous.pid)||previous.pid<=0||typeof previous.token!=='string'||!previous.token)throw error('LOCKED','Draft ownership is uncertain; preserve the lock for recovery.');
  let live;try{live=isProcessAlive(previous.pid);}catch{throw error('LOCKED','Draft ownership is uncertain; preserve the lock for recovery.');}
  if(live)throw error('LOCKED','Another process owns this draft.');
  return previous;
 };
 try{await create();}catch(e){
  if(e.code!=='EEXIST')throw e;
  // Refuse a live or uncertain owner before making any recovery writes.
  await deadOwner();
  let guard;
  // Serialize reclaimers so two dead-PID readers cannot unlink a newly live lock.
  try{guard=await open(recovery,'wx',0o600);}catch{throw error('LOCKED','Another process owns or is recovering this draft.');}
  try{
   if(await deadOwner())await unlink(file);
   await create();
  }catch(e){if(e.code==='EEXIST')throw error('LOCKED','Another process owns this draft.');throw e;}
  finally{await guard.close();await unlink(recovery).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 return async()=>{
  try{if(await readFile(file,'utf8')===bytes)await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 };
}

/** Validate the persisted domain boundary using the existing pick reader. */
function restore(saved,source){
 const check=condition=>{if(!condition)throw error('RECOVERY_REQUIRED','Saved session is invalid; preserve it and recover before saving.');};
 check(record(saved)&&saved.schemaVersion===STATE_VERSION&&saved.configFingerprint===source.configFingerprint);
 for(const key of ['revision','pendingRevision','lastRequestSequence'])check(Number.isSafeInteger(saved[key])&&saved[key]>=0);
 check(Number.isSafeInteger(saved.nextCorrectionId)&&saved.nextCorrectionId>=1&&typeof saved.requiresPreparation==='boolean');
 function draft(value){
  if(value===null)return;
  check(record(value)&&value.configFingerprint===source.configFingerprint&&value.draftId===source.config.draftId&&stamp(value.fetchedAt)&&value.fetchedAt!==null);
  check(['pre_draft','drafting','paused','complete'].includes(value.status)&&Array.isArray(value.picks));
  const normalized=normalizePicks(value.picks.map(p=>({pick_no:p.pickNo,round:p.round,draft_slot:p.draftSlot,player_id:p.playerId,roster_id:p.rosterId,picked_by:p.pickedBy})),source.config);
  check(normalized.length===value.picks.length&&normalized.every((p,i)=>Object.keys(p).every(key=>p[key]===value.picks[i][key])));
 }
 draft(saved.accepted);
 check(Array.isArray(saved.corrections)&&Array.isArray(saved.notices)&&record(saved.freshness));
 for(const key of ['lastAttemptAt','lastCheckAt','lastChangedAt'])check(stamp(saved.freshness[key]));
 check(saved.freshness.lastError===null||typeof saved.freshness.lastError==='string');
 check(['unknown','checked','error'].includes(saved.freshness.connection));
 const ids=new Set(),players=new Set((saved.accepted?.picks??[]).map(p=>p.playerId)),slots=new Set((saved.accepted?.picks??[]).map(p=>p.pickNo));
 for(const c of saved.corrections){
  check(record(c)&&typeof c.id==='string'&&/^local-[1-9]\d*$/.test(c.id)&&!ids.has(c.id)&&Number(c.id.slice(6))<saved.nextCorrectionId);
  check(['taken','my-pick'].includes(c.type)&&typeof c.playerId==='string'&&Object.hasOwn(source.playersById,c.playerId)&&!players.has(c.playerId));
  if(c.type==='my-pick'){check(saved.accepted!==null&&source.config.ownPicks.includes(c.pickNo)&&!slots.has(c.pickNo));slots.add(c.pickNo);}
  else check(c.pickNo===undefined);
  ids.add(c.id);players.add(c.playerId);
 }
 check(saved.notices.every(n=>record(n)&&typeof n.code==='string'&&typeof n.message==='string'));
 const state={...createDraftState(source),...serialize(saved)};
 if(saved.pending!==null){
  check(record(saved.pending)&&Number.isSafeInteger(saved.pending.revision)&&saved.pending.revision>0&&saved.pending.revision<=saved.pendingRevision&&saved.accepted!==null);
  draft(saved.pending.snapshot);
  const reconciled=reconcileDraft({...state,pending:null},{snapshot:saved.pending.snapshot,requestSequence:state.lastRequestSequence+1,expectedRevision:state.revision,checkedAt:state.freshness.lastCheckAt});
  check(reconciled.pending!==null&&JSON.stringify(reconciled.pending.diff)===JSON.stringify(saved.pending.diff));
 }
 return state;
}

function publicUpstreamError(cause,phase){
 const preparation=cause.code==='PREPARE_REQUIRED'||(!cause.status&&cause.name!=='TimeoutError'&&cause.name!=='AbortError'&&!(cause instanceof SyntaxError)&&
  (phase==='context'&&!(cause instanceof TypeError)||/^(Unsupported draft|Unsupported reversal|Draft (identity|season|configuration)|Assigned keepers|Missing draft order|Incomplete draft order|Owner\/roster|Invalid\/duplicate roster slot)/.test(cause.message)));
 if(preparation)return error('PREPARE_REQUIRED','Sleeper configuration changed; prepare again before personalized advice.');
 return error('UPSTREAM_ERROR',cause.name==='TimeoutError'?'Sleeper request timed out.':cause.status?`Sleeper check failed (HTTP ${cause.status}).`:'Sleeper check failed or returned invalid data.');
}

/**
 * One lock, serialized durable owner and background refresh cycle.
 * clock controls scheduling. Optional beforeRename/onRefreshQueued hooks observe
 * real persistence and consumption boundaries; they do not replace I/O.
 */
export async function openSession(options={}){
 const dataDirectory=resolve(options.dataDirectory??'.local'),clock=options.clock??realClock;
 const source=await loadSnapshot(join(dataDirectory,'snapshot.json'));
 const directory=join(dataDirectory,'drafts',source.config.draftId),file=join(directory,'session.json');
 const unlock=await acquireLock(directory),openedAt=clock.now(),sessionId=randomUUID();
 let state=createDraftState(source),restored=false,recovery=false,visibleError=null;
 try{state=restore(JSON.parse(await readFile(file,'utf8')),source);restored=true;}
 catch(e){if(e.code!=='ENOENT'){recovery=true;visibleError=error('RECOVERY_REQUIRED','Saved session needs recovery; its bytes have been preserved.');}}
 let persistedPreparation=state.requiresPreparation;
 let viewRevision=0,inflight=null,timer=null,closing=null,closed=false,failures=0,retryAt=null,nextRefreshAt=null,needsContext=true;
 let requestSequence=state.lastRequestSequence,queue=Promise.resolve();
 let effective=deriveEffectiveDraft(state,source.config),advice=recommend(source,effective),lastOverdue;
 const bump=()=>{viewRevision++;};
 const refreshAdvice=()=>{effective=deriveEffectiveDraft(state,source.config);advice=recommend(source,effective);};
 function overdue(){return isOverdue({status:state.accepted?.status,lastCheckAt:state.freshness.lastCheckAt===null?null:Date.parse(state.freshness.lastCheckAt),openedAt,lastError:state.freshness.lastError},clock.now());}
 lastOverdue=overdue();
 function getBoard(){
  const current=overdue();if(current!==lastOverdue){lastOverdue=current;bump();}
  const issue=visibleError??(state.requiresPreparation?error('PREPARE_REQUIRED','Sleeper configuration changed; prepare again before personalized advice.'):null);
  return structuredClone({...advice,schemaVersion:BOARD_VERSION,revision:state.revision,sessionId,viewRevision,
   league:{id:source.config.leagueId,name:source.config.leagueName,username:source.config.username,rosterId:source.config.rosterId,ownSlot:source.config.ownSlot,
    teams:source.config.teams,rounds:source.config.rounds,rosterPositions:source.config.rosterPositions,scoring:source.config.scoring,reserveSlots:source.config.reserveSlots},
   draft:{id:source.config.draftId,status:state.accepted?.status??'unknown',officialCount:state.accepted?.picks.length??0,availabilityKnown:state.accepted!==null,remainingSelections:effective.remainingSelections},
   corrections:state.corrections,pending:state.pending,notices:state.notices,
   freshness:{...state.freshness,preparedAt:source.preparedAt,sources:source.sources,stale:restored||state.freshness.lastCheckAt===null,overdue:current},
   refresh:{inflight:inflight!==null,retryAt,nextRefreshAt,failures},error:issue?{code:issue.code,message:issue.message}:null});
 }
 function enqueue(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
 async function commit(next){
  if(recovery)throw visibleError;
  try{await writeJsonAtomic(file,serialize(next),{beforeRename:options.beforeRename});}
  catch{visibleError=error('PERSISTENCE_FAILED','Unable to save the local draft state.');bump();throw visibleError;}
  persistedPreparation=next.requiresPreparation;
  const changed=next.revision!==state.revision||next.requiresPreparation!==state.requiresPreparation;
  state=next;visibleError=null;if(changed)refreshAdvice();bump();
 }
 function schedule(delay){
  if(closed)return;
  nextRefreshAt=clock.now()+delay;
  timer=clock.setTimeout(()=>{timer=null;void refresh().catch(()=>{});},delay);timer?.unref?.();
 }
 function refresh({context=false}={}){
  if(closed)return Promise.reject(error('CLOSED','Session is closed.'));
  if(context)needsContext=true;
  if(inflight)return inflight;
  if(retryAt!==null&&clock.now()<retryAt)return Promise.resolve(getBoard());
  if(timer!==null){clock.clearTimeout(timer);timer=null;}nextRefreshAt=null;
  const expectedRevision=state.revision,sequence=++requestSequence;
  inflight=(async()=>{
   let incoming,cause=null,phase='context';
   try{
    if(needsContext){
     const config=await loadContext({leagueId:source.config.leagueId,userId:source.config.userId,sourceUrls:options.sourceUrls,timeoutMs:4000});
     if(fingerprintConfig(config)!==source.configFingerprint)throw error('PREPARE_REQUIRED','Configuration changed.');
     needsContext=false;
    }
    phase='draft';const snapshot=await fetchDraftSnapshot(source.config,{sourceUrls:options.sourceUrls,timeoutMs:4000,now:clock.now});
    incoming={snapshot};
   }catch(e){cause=e;const issue=publicUpstreamError(e,phase);incoming={error:issue.message,requiresPreparation:issue.code==='PREPARE_REQUIRED',issue};}
   const result=enqueue(async()=>{
    if(closed)return;
    const next=reconcileDraft(state,{...incoming,requestSequence:sequence,expectedRevision,checkedAt:new Date(clock.now()).toISOString()});
    if(next===state)return;
    if(incoming.error){
     const changed=next.requiresPreparation!==state.requiresPreparation;state=next;
     if(!recovery)visibleError=incoming.issue;if(changed)refreshAdvice();bump();
     // Keep known incompatibility disabled even if saving fails; retry its durability, not every error's metadata.
     if(state.requiresPreparation&&!persistedPreparation)await commit(state);
    }else{await commit(next);restored=false;}
   });
   options.onRefreshQueued?.({requestSequence:sequence});
   try{await result;}catch(e){cause=e;}
   if(cause){failures++;retryAt=clock.now()+retryDelay(failures,cause.retryAfter,clock.now());}
   else{failures=0;retryAt=null;}
   inflight=null;schedule(cause?retryAt-clock.now():state.accepted?.status==='complete'?30000:5000);bump();return getBoard();
  })();bump();return inflight;
 }
 function act({expectedRevision,action}={}){
  return enqueue(async()=>{
   if(closed)throw error('CLOSED','Session is closed.');if(recovery)throw visibleError;
   let next;try{next=applyLocalAction(state,{...action,expectedRevision});}
   catch(e){throw error(e.status===409?'STALE_REVISION':'INVALID_ACTION',e.status===409?'The board revision or pending review is obsolete.':'Invalid local draft action.',e.status===409?409:422);}
   await commit(next);return getBoard();
  });
 }
 function close(){
  if(closing)return closing;closed=true;if(timer!==null){clock.clearTimeout(timer);timer=null;}nextRefreshAt=null;
  closing=(async()=>{await inflight;await queue;await unlock();})();return closing;
 }
 const session={getBoard,refresh,act,close};if(options.autoRefresh!==false)void refresh({context:true}).catch(()=>{});return session;
}
