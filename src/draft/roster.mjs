import {POSITIONS} from '../contracts.mjs';

const CAPS=Object.freeze({QB:2,TE:2,K:1,DEF:1});
const lexical=(a,b)=>a<b?-1:a>b?1:0;
const unique=players=>[...new Map(players.map(p=>[p.id,p])).values()].sort((a,b)=>lexical(a.id,b.id));
const fits=(player,position)=>position==='FLEX'
 ? player.fantasyPositions.some(p=>['RB','WR','TE'].includes(p))
 : player.fantasyPositions.includes(position);
const startingSlots=positions=>positions.map((position,slotIndex)=>({position,slotIndex}))
 .filter(s=>POSITIONS.includes(s.position)||s.position==='FLEX');
function policyCounts(players){
 const counts=Object.fromEntries(POSITIONS.map(p=>[p,0]));
 for(const player of unique(players))if(Object.hasOwn(counts,player.policyPosition))counts[player.policyPosition]++;
 return counts;
}
export function canAddUnderCaps(owned,candidate) {
 return !Object.hasOwn(CAPS,candidate.policyPosition)||policyCounts(owned)[candidate.policyPosition]<CAPS[candidate.policyPosition];
}

// Cardinality oracle for deterministic tie resolution, using augmenting paths.
function maximumCount(players,slots) {
 const assigned=new Map();
 function place(player,visited){
  for(const slot of slots){
   if(visited.has(slot.slotIndex)||!fits(player,slot.position))continue;
   visited.add(slot.slotIndex);
   if(!assigned.has(slot.slotIndex)||place(assigned.get(slot.slotIndex),visited)){
    assigned.set(slot.slotIndex,player);return true;
   }
  }
  return false;
 }
 for(const player of players)place(player,new Set());
 return assigned.size;
}

/** Maximum starter matching, then dedicated/slot/player lexical tie preference. */
export function assignRoster(input,rosterPositions) {
 const players=unique(input),slots=startingSlots(rosterPositions);
 const ordered=[...slots].sort((a,b)=>(a.position==='FLEX')-(b.position==='FLEX')||a.slotIndex-b.slotIndex);
 let remaining=players,needed=maximumCount(players,slots);
 const assignment=new Map();
 for(let i=0;i<ordered.length;i++){
  const slot=ordered[i],rest=ordered.slice(i+1);
  const player=remaining.find(p=>fits(p,slot.position)&&maximumCount(remaining.filter(q=>q.id!==p.id),rest)>=needed-1);
  if(player&&needed>0){assignment.set(slot.slotIndex,player.id);remaining=remaining.filter(p=>p.id!==player.id);needed--;}
 }
 const starters=slots.map(s=>({...s,playerId:assignment.get(s.slotIndex)??null}));
 const missingSlots=starters.filter(s=>s.playerId===null),benchCapacity=rosterPositions.filter(p=>p==='BN').length;
 return {starters,missingSlots,filledCount:assignment.size,
  offensiveFilled:starters.filter(s=>s.playerId!==null&&!['K','DEF'].includes(s.position)).length,
  offensiveMissing:missingSlots.filter(s=>!['K','DEF'].includes(s.position)).length,
  bench:remaining.slice(0,benchCapacity).map(p=>p.id),overflow:remaining.slice(benchCapacity).map(p=>p.id),
  benchCapacity,draftCapacity:slots.length+benchCapacity,policyCounts:policyCounts(players)};
}

/**
 * Can all starters be matched using at most remainingSelections future players?
 * A small min-cost flow counts owned identities at cost0 and future ones at cost1.
 * Future players with identical eligibility/policy share a capacity node; distinct
 * IDs are counted once. Policy-group capacities enforce only NEW additions.
 */
export function canCompleteRoster({owned,available,rosterPositions,remainingSelections}) {
 const slots=startingSlots(rosterPositions),players=unique(owned),ownedIds=new Set(players.map(p=>p.id));
 const graph=[];
 const node=()=>{graph.push([]);return graph.length-1;};
 const add=(from,to,capacity,cost=0)=>{
  const forward={to,capacity,cost,reverse:graph[to].length};
  const reverse={to:from,capacity:0,cost:-cost,reverse:graph[from].length};
  graph[from].push(forward);graph[to].push(reverse);
 };
 const source=node(),sink=node(),slotNodes=slots.map(()=>node());
 for(const slot of slotNodes)add(slot,sink,1);
 const connectSlots=(from,player)=>slots.forEach((slot,i)=>{if(fits(player,slot.position))add(from,slotNodes[i],1);});
 for(const player of players){const id=node();add(source,id,1);connectSlots(id,player);}
 const counts=policyCounts(players),groups=new Map();
 for(const player of unique(available)){
  if(ownedIds.has(player.id)||!player.eligible||!player.eligibleBase)continue;
  const mask=slots.map(s=>fits(player,s.position)?'1':'0').join('');
  const key=`${player.policyPosition}:${mask}`;
  const group=groups.get(key)??{player,count:0};group.count++;groups.set(key,group);
 }
 const policies=new Map();
 for(const {player,count} of groups.values()){
  const policy=player.policyPosition;
  if(!policies.has(policy)){
   const id=node();policies.set(policy,id);
   add(source,id,Object.hasOwn(CAPS,policy)?Math.max(0,CAPS[policy]-counts[policy]):slots.length,1);
  }
  const id=node();add(policies.get(policy),id,count);connectSlots(id,player);
 }
 let flow=0,cost=0;
 while(flow<slots.length){
  const distance=Array(graph.length).fill(Infinity),path=Array(graph.length);distance[source]=0;
  // Reverse residual edges can cost -1; Bellman-Ford permits reassignment.
  for(let pass=0;pass<graph.length-1;pass++){
   let changed=false;
   for(let from=0;from<graph.length;from++)for(let i=0;i<graph[from].length;i++){
    const edge=graph[from][i];
    if(edge.capacity>0&&distance[from]+edge.cost<distance[edge.to]){
     distance[edge.to]=distance[from]+edge.cost;path[edge.to]=[from,i];changed=true;
    }
   }
   if(!changed)break;
  }
  if(!Number.isFinite(distance[sink]))break;
  for(let to=sink;to!==source;){const [from,index]=path[to],edge=graph[from][index];edge.capacity--;graph[to][edge.reverse].capacity++;to=from;}
  flow++;cost+=distance[sink];
 }
 const feasible=flow===slots.length&&cost<=remainingSelections;
 return {feasible,neededSelections:flow===slots.length?cost:null,
  reason:feasible?null:flow<slots.length?'Cannot complete starters with distinct eligible available players under policy caps.'
   :`Cannot complete starters: need ${cost} selections, only ${remainingSelections} remain.`};
}
