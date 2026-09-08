import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {POSITIONS,SNAPSHOT_VERSION} from '../contracts.mjs';
import {loadContext,fingerprintConfig,requestSource,externalId,DEFAULT_API} from '../sleeper/client.mjs';
import {NFL_TEAMS,normalizePosition,normalizeTeam,extractEcrData,matchEcrPlayers} from './identity.mjs';
import {writeJsonAtomic,validateSnapshot} from './snapshot.mjs';
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const numeric=value=>typeof value==='number' && Number.isFinite(value)?value:null;
const adpValue=value=>numeric(value)!==null && value>0 && value!==999?value:null;
const text=value=>typeof value==='string'?value:null;
function updated(row){const value=row?.updated_at ?? row?.last_modified ?? null;return typeof value==='number'&&Number.isFinite(value)||typeof value==='string'?value:null;}
function requireValue(condition,message){if(!condition)throw new Error(message);}
function playerMap(players){
  requireValue(record(players) && Object.keys(players).length>0,'Invalid player map');
  const ids=new Set();
  for(const [key,p] of Object.entries(players)){
    requireValue(record(p),'Invalid player schema');const id=externalId(p.player_id,'player ID');
    requireValue(id===key && !ids.has(id),'Duplicate/mismatched player identity');ids.add(id);
    requireValue(p.fantasy_positions==null || (Array.isArray(p.fantasy_positions)&&p.fantasy_positions.every(x=>typeof x==='string')),'Invalid player fantasy positions');
  }
  return players;
}
function rowsById(rows,season,label){
  requireValue(Array.isArray(rows),`Invalid ${label} rows schema`);const result=new Map();
  for(const row of rows){
    requireValue(record(row),`Invalid ${label} row`);const id=externalId(row.player_id,`${label} player ID`);
    requireValue(!result.has(id),`Duplicate ${label} player ID: ${id}`);
    requireValue(String(row.season)===String(season),`${label} season mismatch`);
    requireValue(row.season_type==='regular' && row.sport==='nfl',`${label} sport/season type mismatch`);
    requireValue(record(row.stats),`Invalid ${label} stats schema`);result.set(id,row);
  }
  return result;
}
/** Normalize all identities; coverage and optional ECR are separate decisions. */
export function normalizeSources({players,projections,history=null,season}) {
  playerMap(players);
  const projected=rowsById(projections,season,'projections'),historic=history===null?new Map():rowsById(history,String(Number(season)-1),'history');
  const entries=Object.entries(players).map(([id,raw])=>{
    const fantasyPositions=[...new Set((raw.fantasy_positions ?? []).map(normalizePosition))],position=normalizePosition(raw.position)||null;
    const supported=fantasyPositions.filter(p=>POSITIONS.includes(p));
    const policyPosition=supported.includes(position)?position:POSITIONS.find(p=>supported.includes(p)) ?? null;
    const team=normalizeTeam(raw.team)||null,active=raw.active===true;
    const eligibleBase=active && NFL_TEAMS.includes(team) && policyPosition!==null;
    const projection=projected.get(id),past=historic.get(id),adp=adpValue(projection?.stats.adp_half_ppr);
    return [id,{id,name:raw.full_name ?? ([raw.first_name,raw.last_name].filter(Boolean).join(' ')||id),
      team,position,fantasyPositions,policyPosition,active,eligibleBase,eligible:eligibleBase && adp!==null,adp,adpBand:null,
      ecrRank:null,ecrTier:null,ecrSourceId:null,projectionPoints:numeric(projection?.stats.pts_half_ppr),historyPoints:numeric(past?.stats.pts_half_ppr),
      injuryStatus:text(raw.injury_status),injuryBodyPart:text(raw.injury_body_part),injuryNotes:text(raw.injury_notes),
      sourceUpdatedAt:{players:updated({updated_at:raw.news_updated}),projections:updated(projection),history:updated(past),ecr:null}}];
  });
  const result=Object.fromEntries(entries);
  const pool=Object.values(result).filter(p=>p.eligible).sort((a,b)=>a.adp-b.adp||(a.id<b.id?-1:a.id>b.id?1:0));
  pool.forEach((p,index)=>{p.adpBand=Math.floor(index/12);});return result;
}
export function validateCoverage(playersById){
  const floors={QB:14,RB:42,WR:42,TE:14,K:14,DEF:14},positions=Object.fromEntries(POSITIONS.map(p=>[p,0]));let total=0;
  for(const player of Object.values(playersById))if(player.eligibleBase && adpValue(player.adp)!==null){total++;positions[player.policyPosition]++;}
  requireValue(total>=400,`Insufficient ADP coverage: ${total}; require 400`);
  for(const [position,floor] of Object.entries(floors))requireValue(positions[position]>=floor,`Insufficient ${position} coverage: ${positions[position]}; require ${floor}`);
  return {total,positions};
}
export function isFreshPlayerCache(fetchedAt, now=Date.now()){
  if(typeof fetchedAt!=='string')return false;const age=now-Date.parse(fetchedAt);return Number.isFinite(age) && age>=0 && age<86400000;
}
function metadata(url,season,scoring,fetchedAt,status='ok',reason=null){return {url,season,scoring,fetchedAt,updatedAt:null,status,...(reason?{reason}:{})};}
/** Required source errors leave snapshot.json byte-identical. Optional sources degrade with explicit provenance. */
export async function prepareData({leagueId,userId,dataDir='.local',playersFile,playersFetchedAt,withoutEcr=false,sourceUrls={},now=Date.now,timeoutMs=30000}={}){
  const currentTime=now();requireValue(Number.isFinite(currentTime),'Invalid preparation clock');
  const preparedAt=new Date(currentTime).toISOString(),directory=resolve(dataDir),rawDir=join(directory,'sources');
  requireValue(Boolean(playersFile)===Boolean(playersFetchedAt),'--players-file and --players-fetched-at are required together');
  const config=await loadContext({leagueId,userId,sourceUrls,timeoutMs});const season=config.season;
  const api=sourceUrls.apiBase ?? DEFAULT_API,statsBase=sourceUrls.statsBase ?? 'https://api.sleeper.app';
  const urls={players:`${api}/players/nfl`,projections:`${statsBase}/projections/nfl/${season}?season_type=regular`,history:`${statsBase}/stats/nfl/${Number(season)-1}?season_type=regular`,ecr:sourceUrls.ecr ?? 'https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php'};
  const sources={},warnings=[];let players,cache;
  if(playersFile){
    requireValue(Number.isFinite(Date.parse(playersFetchedAt)) && Date.parse(playersFetchedAt)<=currentTime,'Invalid --players-fetched-at timestamp');
    const imported=playerMap(JSON.parse(await readFile(playersFile,'utf8')));
    if(isFreshPlayerCache(playersFetchedAt,currentTime)){players=imported;sources.players=metadata(urls.players,null,null,new Date(playersFetchedAt).toISOString());}
  }else{
    try{
      cache=JSON.parse(await readFile(join(rawDir,'players.json'),'utf8'));
      if(cache.schemaVersion===1 && cache.source?.url===urls.players && isFreshPlayerCache(cache.source?.fetchedAt,currentTime)){
        players=playerMap(cache.players);sources.players=cache.source;
      }
    }catch(error){if(error.code!=='ENOENT')warnings.push(`Player cache ignored: ${error.message}`);}
  }
  if(!players){players=playerMap(await requestSource(urls.players,{timeoutMs}));sources.players=metadata(urls.players,null,null,preparedAt);}
  await writeJsonAtomic(join(rawDir,'players.json'),{schemaVersion:1,source:sources.players,players});
  const projections=await requestSource(urls.projections,{timeoutMs});rowsById(projections,season,'projections');
  sources.projections=metadata(urls.projections,season,'HALF',preparedAt);
  await writeJsonAtomic(join(rawDir,'projections.json'),{source:sources.projections,rows:projections});
  let history=null,historyReport={status:'ok'};
  try{
    history=await requestSource(urls.history,{timeoutMs});rowsById(history,String(Number(season)-1),'history');
    sources.history=metadata(urls.history,String(Number(season)-1),'HALF',preparedAt);
    await writeJsonAtomic(join(rawDir,'history.json'),{source:sources.history,rows:history});
  }catch(error){history=null;historyReport={status:'unavailable',reason:error.message};sources.history=metadata(urls.history,String(Number(season)-1),'HALF',null,'unavailable',error.message);}
  const playersById=normalizeSources({players,projections,history,season});const coverage=validateCoverage(playersById);
  let ecrReport={rankingMode:'adp-only',matches:{},quarantine:[],reason:'Optional ECR disabled'};
  sources.ecr=metadata(urls.ecr,season,'HALF',null,'disabled','Optional ECR disabled');
  if(!withoutEcr){
    try{
      const html=await requestSource(urls.ecr,{timeoutMs,text:true}),ecr=extractEcrData(html);
      ecrReport=matchEcrPlayers(ecr,playersById,{season});
      sources.ecr=metadata(urls.ecr,season,'HALF',preparedAt,ecrReport.rankingMode==='ecr'?'ok':'unavailable',ecrReport.reason);
      sources.ecr.updatedAt=updated({updated_at:ecr.last_updated_ts ?? null});
      await writeJsonAtomic(join(rawDir,'ecr.json'),{source:sources.ecr,data:ecr});
    }catch(error){ecrReport={rankingMode:'adp-only',matches:{},quarantine:[],reason:error.message};sources.ecr=metadata(urls.ecr,season,'HALF',null,'unavailable',error.message);}
  }
  for(const [id,match] of Object.entries(ecrReport.matches)){
    const p=playersById[id];p.ecrRank=match.rank;p.ecrTier=match.tier;p.ecrSourceId=match.sourceId;p.sourceUpdatedAt.ecr=sources.ecr.updatedAt;p.eligible=p.eligibleBase;
  }
  const snapshot={schemaVersion:SNAPSHOT_VERSION,snapshotId:randomUUID(),preparedAt,config,configFingerprint:fingerprintConfig(config),sources,playersById,rankingMode:ecrReport.rankingMode,
    importReport:{coverage,ecr:{reason:ecrReport.reason,quarantine:ecrReport.quarantine},history:historyReport,warnings}};
  validateSnapshot(snapshot);await writeJsonAtomic(join(directory,'snapshot.json'),snapshot);return snapshot;
}
