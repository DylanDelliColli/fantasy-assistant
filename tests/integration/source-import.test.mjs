import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {runPrepare} from '../../scripts/prepare-data.mjs';
import {loadSnapshot,writeJsonAtomic} from '../../src/data/snapshot.mjs';
import {loadContext,fetchDraftSnapshot} from '../../src/sleeper/client.mjs';
import {upstream} from '../helpers/upstream.mjs';
import {LEAGUE,USER,DRAFT,NOW,pick} from '../fixtures/sleeper.mjs';
import {rankingsFixture,rankingsHtml} from '../fixtures/rankings.mjs';
async function setup(t){const u=await upstream(t);const dir=await mkdtemp(join(tmpdir(),'fantasy-import-'));t.after(()=>rm(dir,{recursive:true,force:true}));const args=['--data-dir',dir];const options={sourceUrls:u.sourceUrls,now:()=>Date.parse(NOW)};return {...u,dir,args,options,prepare:(more=[])=>runPrepare([...args,...more],options)};}
test('actual CLI parser composes HTTP, identity and disk with exact provenance and GET-only requests',async t=>{
 const s=await setup(t);delete globalThis.sourceExecuted;const result=await s.prepare();const disk=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.deepEqual(result,disk);assert.deepEqual(Object.keys(disk).sort(),['schemaVersion','snapshotId','preparedAt','config','configFingerprint','sources','playersById','rankingMode','importReport'].sort());
 assert.equal(disk.schemaVersion,1);assert.equal(disk.config.leagueId,LEAGUE);assert.equal(disk.config.rosterId,'5');assert.equal(disk.config.ownSlot,1);assert.equal(disk.config.rounds,13);assert.equal(disk.config.season,'2026');
 assert.equal(disk.rankingMode,'ecr');assert.equal(disk.importReport.coverage.total,400);assert.equal(Object.keys(disk.playersById).length,400);assert.equal(disk.playersById['10001'].ecrRank,1);assert.equal(disk.playersById.JAX.policyPosition,'DEF');
 assert.equal(disk.sources.projections.url,`${s.sourceUrls.statsBase}/projections/nfl/2026?season_type=regular`);assert.equal(disk.sources.history.season,'2025');assert.equal(disk.sources.projections.scoring,'HALF');assert.equal(disk.sources.players.fetchedAt,NOW);
 assert.equal(disk.playersById['10001'].sourceUpdatedAt.projections,123456);assert.equal(globalThis.sourceExecuted,undefined);assert.ok(s.requests.every(r=>r.method==='GET'));assert.ok((await readdir(join(s.dir,'sources'))).length>=4);
 const before=s.requests.filter(r=>r.url==='/v1/players/nfl').length;await s.prepare(['--league',LEAGUE,'--user',USER]);assert.equal(s.requests.filter(r=>r.url==='/v1/players/nfl').length,before);
 for(const args of [['--unknown'],['--league'],['--players-file','missing'],['--players-fetched-at',NOW],['--without-ecr','false']])await assert.rejects(s.prepare(args),/option|argument|together|requires|file|ENOENT/i);
});
test('explicit research player import retains original time, no download; cache expires exactly at24h',async t=>{
 const s=await setup(t);const playersFile=join(s.dir,'research.json');await writeFile(playersFile,JSON.stringify(s.s.players));const original='2026-09-08T16:28:00.000Z';
 let result=await s.prepare(['--players-file',playersFile,'--players-fetched-at',original,'--without-ecr']);assert.equal(result.sources.players.fetchedAt,original);assert.equal(result.rankingMode,'adp-only');assert.equal(s.requests.some(r=>r.url==='/v1/players/nfl'),false);assert.equal(s.requests.some(r=>r.url==='/ecr'),false);
 s.options.now=()=>Date.parse(original)+86400000-1;await runPrepare(s.args,s.options);assert.equal(s.requests.some(r=>r.url==='/v1/players/nfl'),false);
 s.options.now=()=>Date.parse(original)+86400000;result=await runPrepare(s.args,s.options);assert.equal(s.requests.filter(r=>r.url==='/v1/players/nfl').length,1);assert.equal(result.sources.players.fetchedAt,'2026-09-09T16:28:00.000Z');
});
test('required HTTP, schema, context and coverage failures retain previous snapshot bytes',async t=>{
 const s=await setup(t);await s.prepare();const file=join(s.dir,'snapshot.json'),bytes=await readFile(file);
 const path='/projections/nfl/2026?season_type=regular',original=s.routes[path];s.failures.add(path);await assert.rejects(s.prepare(),/503/);s.failures.clear();assert.deepEqual(await readFile(file),bytes);
 for(const invalid of [{bad:true},original.slice(1),[...original,original[0]],original.map(r=>({...r,season:'2025'}))]){
  s.routes[path]=invalid;await assert.rejects(s.prepare());assert.deepEqual(await readFile(file),bytes);
 }
 s.routes[path]=original;s.c.draft.settings.rounds=3;await assert.rejects(s.prepare(),/round/i);assert.deepEqual(await readFile(file),bytes);
});
test('optional HTTP and schema failures are explicit and never leave mixed ranks or invalidate current ADP',async t=>{
 const s=await setup(t);s.failures.add('/ecr');s.failures.add('/stats/nfl/2025?season_type=regular');let result=await s.prepare();
 assert.equal(result.rankingMode,'adp-only');assert.equal(result.sources.ecr.status,'unavailable');assert.equal(result.sources.history.status,'unavailable');assert.match(result.importReport.ecr.reason,/503/);assert.equal(result.playersById['10001'].adp,1);assert.equal(result.playersById['10001'].historyPoints,null);assert.ok(Object.values(result.playersById).every(p=>p.ecrRank===null));
 s.failures.clear();s.routes['/ecr']='var ecrData = {broken};';s.routes['/stats/nfl/2025?season_type=regular']=[{bad:true}];result=await s.prepare();assert.equal(result.rankingMode,'adp-only');assert.equal(result.sources.history.status,'unavailable');assert.ok(result.importReport.history.reason);assert.equal(result.playersById['10001'].historyPoints,null);
});
test('unresolved top400 rejects entire optional ECR; lower rows quarantine and retain valid canonical joins',async t=>{
 const s=await setup(t);let ecr=rankingsFixture(s.s.players);ecr.players[0].player_name='No such fictional person';s.routes['/ecr']=rankingsHtml(ecr);let result=await s.prepare();
 assert.equal(result.rankingMode,'adp-only');assert.ok(Object.values(result.playersById).every(p=>p.ecrRank===null&&p.ecrTier===null));assert.match(result.importReport.ecr.reason,/400|unresolved/i);
 ecr=rankingsFixture(s.s.players);ecr.players.push({...ecr.players[0],player_id:'lower',player_name:'Unmatched lower row',rank_ecr:401});s.routes['/ecr']=rankingsHtml(ecr);result=await s.prepare();assert.equal(result.rankingMode,'ecr');assert.equal(result.importReport.ecr.quarantine.length,1);assert.equal(result.playersById['10001'].ecrRank,1);
});
test('loadContext and fetchDraftSnapshot use real GET routes and validate full picks and draft identity',async t=>{
 const s=await setup(t);const c=await loadContext({leagueId:LEAGUE,userId:USER,sourceUrls:s.sourceUrls});s.routes[`/v1/draft/${DRAFT}/picks`]=[pick(2,'unknown'),pick(1)];const snapshot=await fetchDraftSnapshot(c,{sourceUrls:s.sourceUrls,now:()=>Date.parse(NOW)});
 assert.equal(snapshot.draftId,DRAFT);assert.equal(snapshot.fetchedAt,NOW);assert.deepEqual(snapshot.picks.map(p=>p.pickNo),[1,2]);assert.equal(snapshot.picks[0].rosterId,'5');assert.ok(s.requests.every(r=>r.method==='GET'));
 s.routes[`/v1/draft/${DRAFT}/picks`]=[pick(2)];await assert.rejects(fetchDraftSnapshot(c,{sourceUrls:s.sourceUrls}),/gap|contiguous/i);
 s.routes[`/v1/draft/${DRAFT}/picks`]=[];s.c.draft.settings.rounds=12;await assert.rejects(fetchDraftSnapshot(c,{sourceUrls:s.sourceUrls}),/configuration|round/i);
});
test('atomic reader sees only complete old/new JSON; actual rename conflict preserves previous data',async t=>{
 const s=await setup(t);const file=join(s.dir,'atomic.json');const old={version:1,payload:'a'.repeat(40000)},next={version:2,payload:'b'.repeat(40000)};await writeJsonAtomic(file,old);let active=true,reads=0;
 const reader=(async()=>{while(active){const data=JSON.parse(await readFile(file,'utf8'));assert.ok(data.version===1||data.version===2);assert.equal(data.payload,(data.version===1?'a':'b').repeat(40000));reads++;}})();
 try{for(let i=0;i<12;i++)await writeJsonAtomic(file,i%2?old:next);}finally{active=false;await reader;}assert.ok(reads>0);
 const dir=join(s.dir,'conflict');await mkdir(dir);const retained=join(dir,'previous.json');await writeFile(retained,JSON.stringify(old));const bytes=await readFile(retained);await assert.rejects(writeJsonAtomic(dir,next),/EISDIR|ENOTEMPTY|EPERM/);assert.deepEqual(await readFile(retained),bytes);assert.equal((await readdir(s.dir)).some(x=>x.endsWith('.tmp')),false);
 const original=await readFile(file);await assert.rejects(writeJsonAtomic(file,{bad:BigInt(1)}));assert.deepEqual(await readFile(file),original);
});
test('real git ignore rules exclude private sources and runtime state',()=>{
 for(const path of ['.local/sources/players.json','.local/snapshot.json','.local/drafts/123/session.json','node_modules/example','test-results/output.json'])assert.equal(execFileSync('git',['check-ignore',path],{encoding:'utf8'}).trim(),path);
});
test('teamless exact ECR identity is retained and joined but never becomes a candidate',async t=>{
 const s=await setup(t);s.s.players.freeagent={player_id:'freeagent',full_name:'Fictional Free Agent',position:'WR',fantasy_positions:['WR'],active:true,team:null};
 const ecr=rankingsFixture(s.s.players);const free=ecr.players.find(r=>r.player_name==='Fictional Free Agent');const displaced=ecr.players.find(r=>r.rank_ecr===1);displaced.rank_ecr=401;free.rank_ecr=1;free.player_team_id='FA';s.routes['/ecr']=rankingsHtml(ecr);
 const result=await s.prepare();assert.equal(result.rankingMode,'ecr');assert.equal(result.playersById.freeagent.ecrRank,1);assert.equal(result.playersById.freeagent.eligible,false);assert.equal(result.importReport.coverage.total,400);
});
test('CLI identity overrides and league-derived years change the actual requested routes',async t=>{
 const s=await setup(t),league='8000000000000000001',user='8000000000000000002',draft='8000000000000000003';
 s.c.league.league_id=league;s.c.league.draft_id=draft;s.c.league.season='2027';s.c.user.user_id=user;s.c.draft.league_id=league;s.c.draft.draft_id=draft;s.c.draft.season='2027';
 s.c.draft.draft_order[user]=s.c.draft.draft_order[USER];delete s.c.draft.draft_order[USER];s.c.rosters.forEach(r=>{r.league_id=league;if(r.owner_id===USER)r.owner_id=user;});
 for(const [from,to] of [[LEAGUE,league],[USER,user],[DRAFT,draft]])for(const key of Object.keys(s.routes))if(key.includes(from)){s.routes[key.replace(from,to)]=s.routes[key];delete s.routes[key];}
 const p='/projections/nfl/2026?season_type=regular',h='/stats/nfl/2025?season_type=regular';s.routes[p].forEach(r=>r.season='2027');s.routes[h].forEach(r=>r.season='2026');s.routes[p.replace('2026','2027')]=s.routes[p];delete s.routes[p];s.routes[h.replace('2025','2026')]=s.routes[h];delete s.routes[h];
 const result=await s.prepare(['--league',league,'--user',user,'--without-ecr']);assert.equal(result.config.leagueId,league);assert.equal(result.config.userId,user);assert.equal(result.config.draftId,draft);assert.equal(result.config.season,'2027');assert.equal(result.sources.history.season,'2026');assert.ok(s.requests.some(r=>r.url.includes('/projections/nfl/2027')));assert.ok(s.requests.every(r=>!r.url.includes(LEAGUE)&&!r.url.includes(USER)));
});
test('a coherent ownership change in the confirmed league rejects preparation and retains previous bytes',async t=>{
 const s=await setup(t);await s.prepare();const file=join(s.dir,'snapshot.json'),bytes=await readFile(file),other=s.c.rosters[0].owner_id;
 s.c.rosters[0].owner_id=USER;s.c.rosters[4].owner_id=other;s.c.draft.slot_to_roster_id['1']=1;s.c.draft.slot_to_roster_id[s.c.draft.draft_order[other]]=5;
 await assert.rejects(s.prepare(),/ownership|confirmed/i);assert.deepEqual(await readFile(file),bytes);
});
test('zero canonical ECR import persists ADP-only with its reason and lower quarantine',async t=>{
 const s=await setup(t);const ecr=rankingsFixture(s.s.players);
 ecr.players=[{...ecr.players[0],player_id:'missing',player_name:'Unknown Lower Identity',rank_ecr:401}];s.routes['/ecr']=rankingsHtml(ecr);
 await s.prepare();const snapshot=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.equal(snapshot.rankingMode,'adp-only');assert.equal(snapshot.sources.ecr.status,'unavailable');assert.match(snapshot.importReport.ecr.reason,/no|zero/i);
 assert.equal(snapshot.sources.ecr.reason,snapshot.importReport.ecr.reason);
 assert.deepEqual(snapshot.importReport.ecr.quarantine,[{sourceId:'missing',rank:401,name:'Unknown Lower Identity',reason:'unresolved',candidates:[]}]);
 assert.equal(snapshot.importReport.coverage.total,400);assert.ok(Object.values(snapshot.playersById).every(p=>p.ecrRank===null&&p.ecrTier===null&&p.ecrSourceId===null));
});
test('one canonical ECR import remains usable with lower quarantine and still rejects provided top400 failures',async t=>{
 const s=await setup(t);const ecr=rankingsFixture(s.s.players),known={...ecr.players[0],rank_ecr:400};
 const lower={...ecr.players[1],player_id:'missing',player_name:'Unknown Lower Identity',rank_ecr:401};ecr.players=[known,lower];s.routes['/ecr']=rankingsHtml(ecr);
 await s.prepare();let snapshot=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.equal(snapshot.rankingMode,'ecr');assert.equal(snapshot.sources.ecr.status,'ok');assert.equal(snapshot.importReport.ecr.reason,null);
 assert.equal(snapshot.playersById['10001'].ecrRank,400);assert.equal(Object.values(snapshot.playersById).filter(p=>p.ecrRank!==null).length,1);assert.equal(snapshot.importReport.ecr.quarantine.length,1);
 lower.rank_ecr=399;s.routes['/ecr']=rankingsHtml(ecr);await s.prepare();snapshot=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.equal(snapshot.rankingMode,'adp-only');assert.match(snapshot.importReport.ecr.reason,/top400/);assert.ok(Object.values(snapshot.playersById).every(p=>p.ecrRank===null));
});
test('saved eligibility rejects contradictory prepared-file edits without rewriting bytes',async t=>{
 const s=await setup(t);const original=await s.prepare(),file=join(s.dir,'snapshot.json');
 const changes={inactive:{active:false},teamless:{team:null},unsupported:{fantasyPositions:['DB'],policyPosition:null},
  falseBase:{eligibleBase:false,eligible:false},falseRanked:{eligible:false},unranked:{adp:null,ecrRank:null,ecrTier:null,ecrSourceId:null,adpBand:null}};
 for(const [name,change] of Object.entries(changes)){
  await t.test(name,async()=>{
   const edited=structuredClone(original);Object.assign(edited.playersById['10001'],change);await writeFile(file,JSON.stringify(edited));const bytes=await readFile(file);
   await assert.rejects(loadSnapshot(file),/eligib/i);assert.deepEqual(await readFile(file),bytes);
  });
 }
});
test('saved eligibility reloads consistently ineligible prepared identities without rewriting bytes',async t=>{
 const s=await setup(t),original=await s.prepare(),file=join(s.dir,'snapshot.json');
 const changes=[{active:false,eligibleBase:false,eligible:false},{team:null,eligibleBase:false,eligible:false},
  {fantasyPositions:['DB'],policyPosition:null,eligibleBase:false,eligible:false},
  {adp:null,ecrRank:null,ecrTier:null,ecrSourceId:null,adpBand:null,eligibleBase:true,eligible:false}];
 for(const change of changes){const edited=structuredClone(original);Object.assign(edited.playersById['10001'],change);await writeFile(file,JSON.stringify(edited));const bytes=await readFile(file);assert.deepEqual(await loadSnapshot(file),edited);assert.deepEqual(await readFile(file),bytes);}
});
test('persisted ADP sorting moves the first input to band33 at value400',async t=>{
 const s=await setup(t);s.s.projections[0].stats.adp_half_ppr=400;await s.prepare();const snapshot=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.equal(snapshot.playersById['10001'].adpBand,33);assert.equal(snapshot.playersById['10013'].adpBand,0);assert.equal(snapshot.playersById['10014'].adpBand,1);assert.equal(snapshot.importReport.coverage.total,400);
});
test('persisted ADP lexical string IDs10 and9 split the ordinal12/13 boundary',async t=>{
 const s=await setup(t);
 for(const [oldId,newId] of [['10001','9'],['10013','10']]){
  s.s.players[newId]={...s.s.players[oldId],player_id:newId};delete s.s.players[oldId];
  for(const rows of [s.s.projections,s.s.history])rows.find(p=>p.player_id===oldId).player_id=newId;
  s.s.projections.find(p=>p.player_id===newId).stats.adp_half_ppr=12;
 }
 s.s.projections.find(p=>p.player_id==='10012').stats.adp_half_ppr=11.5;await s.prepare();const snapshot=await loadSnapshot(join(s.dir,'snapshot.json'));
 assert.equal(snapshot.playersById['10'].adpBand,0);assert.equal(snapshot.playersById['9'].adpBand,1);assert.equal(snapshot.playersById['10012'].adpBand,0);assert.equal(snapshot.playersById['10014'].adpBand,1);assert.equal(snapshot.importReport.coverage.total,400);
});
test('current-team ECR-only candidate persists eligible with no projection, ADP or band',async t=>{
 const s=await setup(t);s.s.players.rankonly={player_id:'rankonly',full_name:'Fictional Rank Only',position:'WR',fantasy_positions:['WR'],active:true,team:'JAX'};
 const ecr=rankingsFixture(s.s.players),extra=ecr.players.find(r=>r.player_name==='Fictional Rank Only');ecr.players.find(r=>r.rank_ecr===1).rank_ecr=401;extra.rank_ecr=1;s.routes['/ecr']=rankingsHtml(ecr);
 await s.prepare();const file=join(s.dir,'snapshot.json'),snapshot=await loadSnapshot(file),p=snapshot.playersById.rankonly;
 assert.equal(snapshot.rankingMode,'ecr');assert.equal(snapshot.importReport.coverage.total,400);
 assert.equal(p.adp,null);assert.equal(p.projectionPoints,null);assert.equal(p.ecrRank,1);assert.equal(p.adpBand,null);assert.equal(p.eligibleBase,true);assert.equal(p.eligible,true);
 const bytes=await readFile(file);assert.deepEqual(await loadSnapshot(file),snapshot);assert.deepEqual(await readFile(file),bytes);
});
