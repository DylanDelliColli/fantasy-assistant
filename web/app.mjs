export const formatNumber=value=>Number.isFinite(value)?String(value):'—';
export function formatAge(value,now=Date.now()){
  if(value===null||value===undefined)return '—';
  const time=typeof value==='number'?value:Date.parse(value);
  if(!Number.isFinite(time))return '—';
  const seconds=Math.max(0,Math.floor((now-time)/1000));
  return seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:`${Math.floor(seconds/3600)}h ago`;
}
export const injuryLabel=value=>value||'Not reported';
export function freshnessLabels(board,now=Date.now()){
  const f=board.freshness;
  return {check:formatAge(f.lastCheckAt,now),changed:formatAge(f.lastChangedAt,now),prepared:formatAge(f.preparedAt,now),
    sources:Object.entries(f.sources??{}).map(([name,s])=>({name,fetched:formatAge(s.fetchedAt,now),updated:formatAge(s.updatedAt,now)}))};
}
export function statusText(board,now=Date.now(),connected=true){
  if(!connected)return 'App connection lost. Last displayed board retained; reconnect to check actions.';
  if(!board)return 'Connecting to the local app…';
  const f=board.freshness,parts=[];
  if(board.error)parts.push(`${board.error.code}: ${board.error.message}`);
  if(f.lastError)parts.push(`Sleeper check failed: ${f.lastError}`);
  if(board.reason)parts.push(board.reason);
  if(f.stale)parts.push('Saved board is stale; awaiting a successful check.');
  const elapsed=f.lastCheckAt===null?0:now-Date.parse(f.lastCheckAt);
  if(f.overdue||elapsed>=(board.draft.status==='complete'?40000:15000))parts.push('Sleeper check overdue.');
  else if(f.lastCheckAt&&!f.lastError)parts.push('Checked; Sleeper may lag behind the draft.');
  return parts.join(' ')||'Draft availability is unknown.';
}
export const actionRequest=(board,action)=>({expectedRevision:board.revision,action:{...action}});
export const refreshRequest=()=>({method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
export function acceptBoard(previous,board,sequence){
  if(previous){
    if(previous.retired.includes(board.sessionId))return previous;
    if(board.sessionId===previous.board.sessionId){if(board.viewRevision<=previous.board.viewRevision)return previous;}
    else if(sequence<=previous.maxAppliedRequestSequence)return previous;
  }
  return {board,maxAppliedRequestSequence:Math.max(sequence,previous?.maxAppliedRequestSequence??0),
    retired:previous?(board.sessionId===previous.board.sessionId?previous.retired:[...previous.retired,previous.board.sessionId]):[]};
}

/** Explicit browser entry. Formatting and HTTP ordering only; BoardView owns all draft policy. */
export function initApp(){
  const $=id=>document.getElementById(id),signatures=new Map();
  let current=null,sequence=0,reading=null,connected=true,actionError='',active=0;
  const busy=delta=>{active+=delta;document.querySelector('main').setAttribute('aria-busy',String(active>0));};
  const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  const button=(label,fn)=>{const e=element('button',label);e.type='button';e.addEventListener('click',fn);return e;};
  function region(id,value,render){
    const signature=JSON.stringify(value);if(signatures.get(id)===signature)return;
    signatures.set(id,signature);$(id).replaceChildren(...render());
  }
  function metadata(){
    const board=current?.board; $('draft-status').textContent=statusText(board,Date.now(),connected);
    $('action-error').hidden=!actionError;$('action-error').textContent=actionError;
    if(!board)return;
    const f=freshnessLabels(board);$('last-check').textContent=f.check;$('last-change').textContent=f.changed;$('prepared').textContent=f.prepared;
    region('source-ages',f.sources,()=>f.sources.map(s=>element('p',`${s.name}: source updated ${s.updated}; fetched ${s.fetched}`)));
  }
  function playerActions(player,board){
    const mine=button('Record my pick',()=>act(actionRequest(board,{type:'my-pick',playerId:player.id,pickNo:board.nextPicks[0]})));
    mine.dataset.action='my-pick';mine.disabled=player.available!==true||!board.nextPicks.length;
    const taken=button('Mark taken',()=>act(actionRequest(board,{type:'taken',playerId:player.id})));
    taken.dataset.action='taken';taken.disabled=player.available!==true;
    return [mine,taken];
  }
  function details(player){
    $('detail-title').textContent=player.name;
    $('detail-body').replaceChildren(...[
      `${player.team??'No current team'} · ${(player.fantasyPositions??[]).join('/')}`,
      `ADP ${formatNumber(player.adp)} · ECR ${formatNumber(player.ecrRank)} · Tier ${formatNumber(player.ecrTier)}`,
      `Sleeper half-PPR projection ${formatNumber(player.projectionPoints)}`,
      `Prior actual points ${formatNumber(player.historyPoints)}`,
      `Injury: ${injuryLabel(player.injuryStatus)}`,
      player.injuryBodyPart,player.injuryNotes,
      ...Object.entries(player.sourceUpdatedAt??{}).map(([name,time])=>`${name} source updated ${formatAge(time)}`),
      'Projection and history are season context, not custom-league scores.'
    ].filter(Boolean).map(text=>element('p',text)));
    document.querySelector('dialog').showModal();
  }
  function renderPlayers(){
    if(!current)return;const board=current.board,query=$('search').value.toLowerCase(),position=$('position').value;
    const matches=board.players.filter(p=>(position==='ALL'||p.fantasyPositions.includes(position))&&`${p.name} ${p.team??''}`.toLowerCase().includes(query));
    $('player-count').textContent=`${matches.length} players`;
    region('players',[board.sessionId,board.revision,board.nextPicks,matches,query,position],()=>matches.map(p=>{
      const row=element('tr');row.dataset.playerId=p.id;
      const identity=element('td');identity.append(element('strong',p.name,'player-name'),element('span',`${p.team??'—'} · ${p.fantasyPositions.join('/')}`,'player-context'));
      const more=button('Details',()=>details(p));more.dataset.details='';more.setAttribute('aria-label',`Details for ${p.name}`);identity.append(more);
      const actions=element('td');actions.className='actions';actions.append(...playerActions(p,board));
      row.append(identity,element('td',formatNumber(p.adp)),element('td',p.available===null?'Unknown':p.available?'Available':'Taken'),actions);return row;
    }));
  }
  function render(){
    const board=current.board;
    $('league').textContent=board.league.name;
    $('league-summary').textContent=`${board.league.teams} teams · half-PPR · ${board.league.rounds} rounds · Roster ${board.league.rosterId}, slot ${board.league.ownSlot} · ${board.league.rosterPositions.join(' / ')}`;
    $('next-picks').textContent=board.nextPicks.length?board.nextPicks.slice(0,2).join(' · '):'Complete';
    $('observed').textContent=`${board.draft.officialCount} observed picks · ${board.draft.status.replaceAll('_',' ')}`;
    $('ranking-mode').textContent=board.rankingMode==='ecr'?'ECR + ADP':'ADP only';
    region('candidates',[board.sessionId,board.revision,board.candidates],()=>board.candidates.map((c,i)=>{
      const p=board.players.find(p=>p.id===c.playerId),card=element('article',undefined,'candidate');card.dataset.playerId=c.playerId;
      card.append(element('span',String(i+1).padStart(2,'0'),'rank'),element('h3',c.name),element('p',`${p?.team??'—'} · ${c.fantasyPositions.join('/')}`,'player-context'));
      const reasons=element('ul');reasons.append(...c.reasons.map(r=>element('li',r)));card.append(reasons);
      if(p){const actions=element('div',undefined,'actions');actions.append(...playerActions(p,board));card.append(actions);}return card;
    }));
    region('own-roster',board.ownRoster,()=>board.ownRoster.length?board.ownRoster.map(p=>{const e=element('p',`${p.name} · ${(p.fantasyPositions??[]).join('/')}`);e.dataset.playerId=p.id;return e;}):[element('p','No selections recorded yet.','muted')]);
    region('corrections',[board.sessionId,board.revision,board.corrections],()=>board.corrections.length?board.corrections.map(c=>{
      const name=board.players.find(p=>p.id===c.playerId)?.name??c.playerId,label=`${c.type==='taken'?'Marked taken':`Own pick ${c.pickNo}`} · ${name}`,e=element('p',label);
      const undo=button('Undo',()=>act(actionRequest(board,{type:'undo',correctionId:c.id})));undo.setAttribute('aria-label',`Undo ${label}`);e.append(undo);return e;
    }):[element('p','No local corrections.','muted')]);
    region('notices',board.notices,()=>board.notices.map(n=>element('p',n.message)));
    $('pending').hidden=!board.pending;
    region('pending',[board.sessionId,board.revision,board.pending],()=>{
      if(!board.pending)return [];const pending=board.pending;
      const nodes=[element('h2','Sleeper board changed'),element('p',`Review from pick ${pending.diff.firstChangedPick}. Your accepted board remains in use until you choose.`)];
      for(const [label,items] of [['Remove',pending.diff.removed],['Add',pending.diff.added]])for(const p of items)nodes.push(element('p',`${label} pick ${p.pickNo}: ${board.players.find(x=>x.id===p.playerId)?.name??p.playerId}`));
      nodes.push(button('Use this Sleeper board',()=>act(actionRequest(board,{type:'accept-pending',pendingRevision:pending.revision}))));return nodes;
    });
    renderPlayers();metadata();document.body.dataset.session=board.sessionId;document.body.dataset.view=board.viewRevision;document.body.dataset.ready='true';
  }
  function apply(board,requestSequence){
    connected=true;const accepted=acceptBoard(current,board,requestSequence);
    if(accepted!==current){current=accepted;render();}else metadata();
  }
  function readBoard(){
    if(reading)return reading;const requestSequence=++sequence;busy(1);
    reading=(async()=>{
      try{const response=await fetch('/api/board');if(!response.ok)throw new Error('Board unavailable');apply(await response.json(),requestSequence);}
      catch{connected=false;metadata();}finally{reading=null;busy(-1);}
    })();return reading;
  }
  async function act(request){
    const requestSequence=++sequence;actionError='';metadata();busy(1);
    try{
      const response=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}),result=await response.json();
      if(response.ok)apply(result,requestSequence);
      else{actionError=`Action not saved: ${result.error?.message??`HTTP ${response.status}`}`;metadata();}
    }catch{connected=false;actionError='Action not confirmed: connection lost. Check the current board before trying again.';metadata();}
    // Join the outstanding read, then fetch once more so an action always gets a subsequent check.
    if(reading)await reading;await readBoard();busy(-1);
  }
  async function refresh(){
    busy(1);
    try{
      const response=await fetch('/api/refresh',refreshRequest()),result=await response.json();
      if(!response.ok){actionError=`Refresh failed: ${result.error?.message??response.status}`;metadata();}
    }catch{connected=false;metadata();}
    if(reading)await reading;await readBoard();busy(-1);
  }
  $('refresh').addEventListener('click',()=>{void refresh();});
  $('search').addEventListener('input',renderPlayers);$('position').addEventListener('change',renderPlayers);
  $('close-details').addEventListener('click',()=>document.querySelector('dialog').close());
  window.addEventListener('focus',()=>{if(document.visibilityState==='visible')void readBoard();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void readBoard();});
  const timer=setInterval(()=>{metadata();if(document.visibilityState==='visible')void readBoard();},1000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  void readBoard();
}
