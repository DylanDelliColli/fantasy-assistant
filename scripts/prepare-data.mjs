import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareData} from '../src/data/sources.mjs';
import {DEFAULT_LEAGUE,DEFAULT_USER} from '../src/sleeper/client.mjs';
export async function runPrepare(argv=process.argv.slice(2),options={}){
  const {values}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    league:{type:'string',default:DEFAULT_LEAGUE},user:{type:'string',default:DEFAULT_USER},'data-dir':{type:'string',default:'.local'},
    'players-file':{type:'string'},'players-fetched-at':{type:'string'},'without-ecr':{type:'boolean',default:false}}});
  if(Boolean(values['players-file'])!==Boolean(values['players-fetched-at']))throw new Error('--players-file and --players-fetched-at are required together');
  return prepareData({...options,leagueId:values.league,userId:values.user,dataDir:values['data-dir'],playersFile:values['players-file'],playersFetchedAt:values['players-fetched-at'],withoutEcr:values['without-ecr']});
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const snapshot=await runPrepare();console.log(`Prepared ${snapshot.importReport.coverage.total} ADP identities for ${snapshot.config.season}; mode=${snapshot.rankingMode}; snapshot=${snapshot.snapshotId}`);
    for(const source of ['ecr','history'])if(snapshot.sources[source].status!=='ok')console.log(`${source}: ${snapshot.sources[source].reason}`);
    for(const warning of snapshot.importReport.warnings)console.warn(warning);
  }catch(error){console.error(`Preparation failed; previous snapshot retained: ${error.message}`);process.exitCode=1;}
}
