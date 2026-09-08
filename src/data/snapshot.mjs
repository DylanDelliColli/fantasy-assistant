import {readFile,open,mkdir,rename,unlink} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SNAPSHOT_VERSION,POSITIONS} from '../contracts.mjs';
import {fingerprintConfig,externalId} from '../sleeper/client.mjs';
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const timestamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
const nullableNumber=value=>value===null || (typeof value==='number' && Number.isFinite(value));
function check(condition,message){if(!condition)throw new Error(`Invalid snapshot: ${message}`);}
export function validateSnapshot(snapshot, expected = {}) {
  check(record(snapshot) && snapshot.schemaVersion===SNAPSHOT_VERSION,'unsupported or absent schema version');
  check(typeof snapshot.snapshotId==='string' && snapshot.snapshotId.length>0,'snapshot ID');
  check(timestamp(snapshot.preparedAt),'prepared timestamp');
  const config=snapshot.config;check(record(config),'configuration');
  for(const key of ['leagueId','draftId','userId','rosterId'])check(typeof config[key]==='string' && externalId(config[key])===config[key],`configuration ${key}`);
  check(config.sport==='nfl' && config.type==='snake' && /^20\d{2}$/.test(config.season),'configuration sport/type/season');
  check(config.teams===14 && config.rounds===13 && config.reversalRound===0 && config.reserveSlots===1,'configuration rules');
  check(Array.isArray(config.rosterPositions) && config.rosterPositions.length===13 && record(config.scoring) && record(config.draftOrder) && record(config.slotToRosterId),'configuration maps/slots');
  check(Number.isInteger(config.ownSlot) && config.ownSlot>=1 && config.ownSlot<=14 && config.slotToRosterId[config.ownSlot]===config.rosterId && config.draftOrder[config.userId]===config.ownSlot,'configuration ownership');
  check(Array.isArray(config.ownPicks) && JSON.stringify(config.ownPicks)===JSON.stringify(Array.from({length:13},(_,i)=>i*14+(i%2?15-config.ownSlot:config.ownSlot))),'configuration own picks');
  check(snapshot.configFingerprint===fingerprintConfig(config),'configuration fingerprint');
  for(const key of ['leagueId','draftId','userId'])if(expected[key]!==undefined)check(config[key]===expected[key],`identity mismatch: ${key}`);
  if(expected.configFingerprint!==undefined)check(snapshot.configFingerprint===expected.configFingerprint,'configuration fingerprint mismatch');
  check(['ecr','adp-only'].includes(snapshot.rankingMode),'ranking mode');
  check(record(snapshot.sources),'sources');
  for(const key of ['players','projections','history','ecr']){
    const source=snapshot.sources[key];check(record(source) && typeof source.url==='string' && ['ok','unavailable','disabled'].includes(source.status),`${key} source metadata`);
    check(source.fetchedAt===null || timestamp(source.fetchedAt),`${key} fetch time`);
    if(key==='players'||key==='projections')check(source.status==='ok' && timestamp(source.fetchedAt),`${key} required source`);
  }
  check(record(snapshot.playersById) && Object.keys(snapshot.playersById).length>0,'players');
  for(const [id,p] of Object.entries(snapshot.playersById)){
    check(record(p) && p.id===id && typeof p.id==='string' && externalId(p.id)===id,'player identity mismatch');
    check(typeof p.name==='string' && Array.isArray(p.fantasyPositions) && p.fantasyPositions.every(x=>typeof x==='string'),'player name/eligibility');
    check(p.policyPosition===null || (POSITIONS.includes(p.policyPosition) && p.fantasyPositions.includes(p.policyPosition)),'player policy position');
    check(typeof p.active==='boolean' && typeof p.eligibleBase==='boolean' && typeof p.eligible==='boolean','player eligibility flags');
    for(const field of ['adp','ecrRank','ecrTier','projectionPoints','historyPoints'])check(nullableNumber(p[field]),`player ${field}`);
    check(p.adp===null || (p.adp>0 && p.adp!==999),'player ADP');
    check(p.adpBand===null || (Number.isInteger(p.adpBand) && p.adpBand>=0),'player ADP band');
    check(record(p.sourceUpdatedAt),'player source times');
    if(snapshot.rankingMode==='adp-only')check(p.ecrRank===null && p.ecrTier===null && p.ecrSourceId===null,'mixed unlabeled ranks');
  }
  check(record(snapshot.importReport) && record(snapshot.importReport.coverage) && record(snapshot.importReport.ecr) && record(snapshot.importReport.history),'import report');
  return snapshot;
}
export async function loadSnapshot(file, expected = {}) {
  return validateSnapshot(JSON.parse(await readFile(file,'utf8')), expected);
}
/** Publish via an exclusive same-directory temporary file. Failed writes/renames never remove the destination. */
export async function writeJsonAtomic(file, value) {
  const json=JSON.stringify(value);
  if(json===undefined)throw new Error('Cannot write undefined JSON');
  const directory=dirname(file);await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=join(directory,`.${basename(file)}.${randomUUID()}.tmp`);let handle;
  try {
    handle=await open(temporary,'wx',0o600);await handle.writeFile(json+'\n','utf8');await handle.sync();await handle.close();handle=null;
    await rename(temporary,file);
  } finally {
    if(handle)await handle.close();
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
