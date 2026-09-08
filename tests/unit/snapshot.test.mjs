import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadSnapshot,writeJsonAtomic,validateSnapshot} from '../../src/data/snapshot.mjs';
import {normalizeContext,fingerprintConfig} from '../../src/sleeper/client.mjs';
import {normalizeSources} from '../../src/data/sources.mjs';
import {contextFixture,sourceFixture,LEAGUE,USER,NOW} from '../fixtures/sleeper.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'fantasy-snapshot-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=normalizeContext(contextFixture(),{leagueId:LEAGUE,userId:USER});return {file:join(dir,'snapshot.json'),snapshot:{schemaVersion:1,snapshotId:'fixture-1',preparedAt:NOW,config,configFingerprint:fingerprintConfig(config),sources:{players:{url:'https://fixture/players',fetchedAt:NOW,season:null,scoring:null,status:'ok',updatedAt:null},projections:{url:'https://fixture/projections',fetchedAt:NOW,season:'2026',scoring:'HALF',status:'ok',updatedAt:null},history:{url:'https://fixture/history',fetchedAt:NOW,season:'2025',scoring:'HALF',status:'ok',updatedAt:null},ecr:{url:'https://fixture/ecr',fetchedAt:null,season:'2026',scoring:'HALF',status:'disabled',updatedAt:null}},playersById:normalizeSources({...sourceFixture(),season:'2026'}),rankingMode:'adp-only',importReport:{coverage:{total:400},ecr:{reason:'disabled',quarantine:[]},history:{status:'ok'}}}};}
test('version1 roundtrips and supports expected configuration identity',async t=>{const {file,snapshot}=await fixture(t);await writeJsonAtomic(file,snapshot);assert.deepEqual(await loadSnapshot(file,{leagueId:LEAGUE,userId:USER,configFingerprint:snapshot.configFingerprint}),snapshot);});
for(const [name,mutate] of Object.entries({absentVersion:s=>delete s.schemaVersion,unsupportedVersion:s=>s.schemaVersion=2,missingPlayers:s=>delete s.playersById,badPlayerId:s=>s.playersById['10001'].id='mismatch',badFingerprint:s=>s.configFingerprint='bad',badMode:s=>s.rankingMode='mixed',badSources:s=>s.sources={},badTimestamp:s=>s.preparedAt='invalid',missingConfig:s=>delete s.config,missingSnapshotId:s=>delete s.snapshotId})){
 test(`reader rejects ${name} without rewriting`,async t=>{const {file,snapshot}=await fixture(t);mutate(snapshot);await writeFile(file,JSON.stringify(snapshot));const bytes=await readFile(file);await assert.rejects(loadSnapshot(file));assert.deepEqual(await readFile(file),bytes);});
}
test('expected league/user/fingerprint mismatches reject without rewriting',async t=>{const {file,snapshot}=await fixture(t);await writeJsonAtomic(file,snapshot);const bytes=await readFile(file);for(const expected of [{leagueId:'other'},{userId:'other'},{configFingerprint:'other'}])await assert.rejects(loadSnapshot(file,expected),/identity|fingerprint|configuration/i);assert.deepEqual(await readFile(file),bytes);});
const inconsistentEligibility={
 inactive:{active:false},
 teamless:{team:null},
 unsupported:{fantasyPositions:['DB'],policyPosition:null},
 falseBase:{eligibleBase:false,eligible:false},
 isolatedBase:{eligibleBase:false},
 falseRanked:{eligible:false},
 unranked:{adp:null,adpBand:null},
};
for(const [name,change] of Object.entries(inconsistentEligibility)){
 test(`saved eligibility rejects ${name} contradiction`,async t=>{
  const {snapshot}=await fixture(t);Object.assign(snapshot.playersById['10001'],change);
  assert.throws(()=>validateSnapshot(snapshot),/eligib/i);
 });
}
test('saved eligibility accepts consistent inactive, teamless, unsupported and unranked siblings',async t=>{
 const {snapshot}=await fixture(t);
 const cases=[{active:false,eligibleBase:false,eligible:false},{team:null,eligibleBase:false,eligible:false},
  {fantasyPositions:['DB'],policyPosition:null,eligibleBase:false,eligible:false},
  {adp:null,adpBand:null,eligibleBase:true,eligible:false}];
 for(const change of cases){const candidate=structuredClone(snapshot);Object.assign(candidate.playersById['10001'],change);assert.equal(validateSnapshot(candidate),candidate);}
});
test('saved eligibility accepts ECR-only rank but rejects a contradictory exclusion or unusable rank',async t=>{
 const {snapshot}=await fixture(t);snapshot.rankingMode='ecr';snapshot.sources.ecr.status='ok';snapshot.sources.ecr.fetchedAt=NOW;
 const p=snapshot.playersById['10001'];Object.assign(p,{adp:null,adpBand:null,ecrRank:1,ecrTier:1,ecrSourceId:'expert',eligible:true});
 assert.equal(validateSnapshot(snapshot),snapshot);assert.equal(p.adp,null);assert.equal(p.ecrRank,1);assert.equal(p.adpBand,null);assert.equal(p.eligible,true);
 p.eligible=false;assert.throws(()=>validateSnapshot(snapshot),/eligib/i);
 p.eligible=true;p.ecrRank=0;assert.throws(()=>validateSnapshot(snapshot),/eligib/i);
});
