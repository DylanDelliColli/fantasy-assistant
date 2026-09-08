import {externalId} from '../sleeper/client.mjs';
export const NFL_TEAMS = Object.freeze('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
const TEAM_ALIASES = {JAC:'JAX',WSH:'WAS',WFT:'WAS',LA:'LAR',STL:'LAR',SD:'LAC',OAK:'LV',FA:''};
export function normalizeTeam(value) {const team=String(value ?? '').toUpperCase();return TEAM_ALIASES[team] ?? team;}
export function normalizePosition(value) {const pos=String(value ?? '').toUpperCase();return ({PK:'K',DST:'DEF','D/ST':'DEF'})[pos] ?? pos;}
export function normalizeName(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[.'’`-]/g,'').replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' ').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
}
/** Scan one JSON object, respecting string escapes. No eval, Function or script execution. */
export function extractEcrData(html) {
  const marker=/\bvar\s+ecrData\s*=\s*/g.exec(html);
  if (!marker) throw new Error('Missing ecrData JSON');
  const start=marker.index+marker[0].length;
  if(html[start]!=='{')throw new Error('ecrData must be a JSON object');
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<html.length;i++){
    const char=html[i];
    if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue;}
    if(char==='"')inString=true;
    else if(char==='{')depth++;
    else if(char==='}' && --depth===0)return JSON.parse(html.slice(start,i+1));
  }
  throw new Error('Unterminated ecrData JSON');
}
const REVIEWED = Object.freeze({'18226':'5848','24901':'8122'});
export function matchEcrPlayers(ecr,playersById,{season='2026'}={}) {
  const quarantine=[];
  const fallback=reason=>({rankingMode:'adp-only',matches:{},quarantine,reason});
  try {
    if(!ecr || String(ecr.year)!==String(season) || String(ecr.week)!=='0' || ecr.scoring!=='HALF' || !Array.isArray(ecr.players) || !ecr.players.length)throw new Error('Invalid ECR year/week/scoring/rows');
    const ids=new Set(),index=new Map();
    for(const [key,p] of Object.entries(playersById)){
      const id=externalId(p.id,'canonical player ID');
      if(key!==id || ids.has(id))throw new Error('Duplicate or mismatched canonical player identity');ids.add(id);
      for(const position of new Set(p.fantasyPositions.map(normalizePosition))){
        const team=normalizeTeam(p.team),name=position==='DEF'?'':normalizeName(p.name);
        const matchKey=JSON.stringify([position,team,name]);const bucket=index.get(matchKey) ?? [];bucket.push(id);index.set(matchKey,bucket);
      }
    }
    const sourceIds=new Set(),ranks=new Set(),joins=new Set(),matches={};
    for(const row of ecr.players){
      const sourceId=externalId(row.player_id,'ECR source ID'),rank=Number(row.rank_ecr);
      if(!['string','number'].includes(typeof row.rank_ecr) || !Number.isSafeInteger(rank) || rank<1 || sourceIds.has(sourceId) || ranks.has(rank))throw new Error('Duplicate or invalid ECR source ID/rank');
      const tier=row.tier==null?null:Number(row.tier);
      if(tier!==null && (!['string','number'].includes(typeof row.tier) || !Number.isSafeInteger(tier) || tier<1))throw new Error('Invalid ECR tier');
      if(typeof row.player_name!=='string' || !row.player_name.trim())throw new Error('Invalid ECR player name');
      sourceIds.add(sourceId);ranks.add(rank);
      const position=normalizePosition(row.player_position_id),team=normalizeTeam(row.player_team_id);
      let candidates=index.get(JSON.stringify([position,team,position==='DEF'?'':normalizeName(row.player_name)])) ?? [];
      const alias=REVIEWED[sourceId.replace(/^FP/,'')];
      if(alias && playersById[alias] && playersById[alias].fantasyPositions.map(normalizePosition).includes(position) && normalizeTeam(playersById[alias].team)===team)candidates=[alias];
      if(candidates.length!==1){
        const reason=candidates.length?'ambiguous':'unresolved';quarantine.push({sourceId,rank,name:row.player_name,reason,candidates:[...candidates]});
        if(rank<=400)throw new Error(`ECR top400 ${reason} identity: ${sourceId}`);
        continue;
      }
      const id=candidates[0];if(joins.has(id))throw new Error(`Duplicate ECR canonical join: ${id}`);joins.add(id);
      matches[id]={sourceId,rank,tier};
    }
    return {rankingMode:'ecr',matches,quarantine,reason:null};
  } catch(error) {return fallback(error.message);}
}
