import test from 'node:test';
import assert from 'node:assert/strict';
import {extractEcrData,matchEcrPlayers} from '../../src/data/identity.mjs';
function player(id,name,position='WR',team='JAX',extra={}){return {id,name,team,position,fantasyPositions:[position],policyPosition:position,...extra};}
function row(id,name,rank=1,position='WR',team='JAC'){return {player_id:id,player_name:name,rank_ecr:rank,tier:1,player_position_id:position,player_team_id:team};}
function match(rows,players,meta={}){return matchEcrPlayers({year:'2026',week:'0',scoring:'HALF',players:rows,...meta},players,{season:'2026'});}
test('normalizes punctuation, diacritics and suffixes deterministically; preserves large IDs',()=>{
 const id='90071992547409931234',p={[id]:player(id,'José A. Test Jr.')};
 const result=match([row('90071992547409939999','Jose A Test')],p);
 assert.equal(result.rankingMode,'ecr');assert.equal(result.matches[id].sourceId,'90071992547409939999');assert.equal(result.matches[id].rank,1);
 assert.deepEqual(match([row('2','JOSE A TEST III')],p).matches[id].rank,1);
});
test('DEF uses canonical team keys and PK joins K; primary DB can match WR eligibility',()=>{
 const p={JAX:player('JAX','Jacksonville Defense','DEF'),a:player('a','Fictional Kicker','K'),b:player('b','Fictional Returner','DB','JAX',{fantasyPositions:['DB','WR'],policyPosition:'WR'})};
 const result=match([row('1','Unrelated display label',1,'DST'),row('2','Fictional Kicker',2,'PK'),row('3','Fictional Returner',3)],p);
 assert.equal(result.rankingMode,'ecr');assert.deepEqual(Object.keys(result.matches).sort(),['JAX','a','b']);assert.equal(p.b.policyPosition,'WR');
});
test('only the two reviewed FP aliases supplement exact matching',()=>{
 const p={'5848':player('5848','Marquise Brown'),'8122':player('8122','Zonovan Knight','RB')};
 const result=match([row(18226,'Hollywood Brown'),row('24901','Bam Knight',2,'RB')],p);assert.equal(result.rankingMode,'ecr');assert.equal(result.matches['5848'].rank,1);assert.equal(result.matches['8122'].rank,2);
 assert.equal(match([row('unapproved','Marquis Brown')],p).rankingMode,'adp-only');
});
test('ambiguous exact names never choose arbitrarily; top400 invalidates whole ECR, 401 is quarantined',()=>{
 const p={a:player('a','Same Name'),b:player('b','Same Name'),c:player('c','Unique Name')};
 const bad=match([row('1','Unique Name'),row('2','Same Name',400)],p);assert.equal(bad.rankingMode,'adp-only');assert.deepEqual(bad.matches,{});assert.match(bad.reason,/400|ambiguous/i);
 const good=match([row('1','Unique Name'),row('2','Same Name',401),row('3','Unknown Name',402)],p);
 assert.equal(good.rankingMode,'ecr');assert.equal(good.matches.c.rank,1);assert.equal(good.quarantine.length,2);
});
test('reject duplicate source IDs, ranks, canonical joins and malformed identities',()=>{
 const p={a:player('a','Same Name')};
 for(const rows of [[row('1','Same Name'),row('1','Same Name',2)],[row('1','Same Name'),row('2','Same Name')],[row('1','Same Name'),row('2','Same Name',2)],[row('', 'Same Name')],[row(9007199254740992,'Same Name')]]){
  const result=match(rows,p);assert.equal(result.rankingMode,'adp-only');assert.deepEqual(result.matches,{});
 }
 const p2={a:player('a','Same Name'),b:player('a','Other Name')};assert.equal(match([row('1','Same Name')],p2).rankingMode,'adp-only');
});
test('wrong ECR year/week/scoring, invalid ranks and tiers fall back explicitly',()=>{
 for(const meta of [{year:'2025'},{week:1},{scoring:'PPR'},{players:[]},{players:[row('1','Same Name',0)]},{players:[{...row('1','Same Name'),tier:-1}]}]){
  const result=match([row('1','Same Name')],{a:player('a','Same Name')},meta);assert.equal(result.rankingMode,'adp-only');assert.ok(result.reason);assert.deepEqual(result.matches,{});
 }
});
test('extracts JSON without evaluating surrounding or embedded scripts',()=>{
 delete globalThis.sourceExecuted;const data={year:'2026',week:'0',scoring:'HALF',players:[row('1','A }; tricky \\" name')]};
 const html=`<script>globalThis.sourceExecuted=true; var ecrData = ${JSON.stringify(data)}; globalThis.sourceExecuted=true;</script>`;
 assert.deepEqual(extractEcrData(html),data);assert.equal(globalThis.sourceExecuted,undefined);
 for(const html of ['var ecrData = (() => { globalThis.sourceExecuted = true; })();','var ecrData = {broken};','no ranks'])assert.throws(()=>extractEcrData(html),/JSON|ecrData/i);
 assert.equal(globalThis.sourceExecuted,undefined);
});
test('FA and absent team markers describe the same exact identity without fuzzy matching',()=>{
 const p={a:player('a','Fictional Free Agent','WR',null)};
 const result=match([row('1','Fictional Free Agent',1,'WR','FA')],p);assert.equal(result.rankingMode,'ecr');assert.equal(result.matches.a.rank,1);
 assert.equal(match([row('1','Fictional Free Agent',1,'WR','JAX')],p).rankingMode,'adp-only');
});
