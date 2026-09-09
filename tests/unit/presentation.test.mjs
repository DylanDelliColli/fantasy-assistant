import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNumber,formatAge,injuryLabel,freshnessLabels,statusText,actionRequest,refreshRequest,acceptBoard} from '../../web/app.mjs';
const now=Date.parse('2026-09-08T18:00:00Z');
const board=(extra={})=>({sessionId:'a',viewRevision:4,revision:2,status:'ready',reason:null,nextPicks:[28,29],
 draft:{status:'drafting',availabilityKnown:true},freshness:{lastCheckAt:new Date(now).toISOString(),lastChangedAt:new Date(now-20000).toISOString(),preparedAt:new Date(now-3600000).toISOString(),stale:false,overdue:false,lastError:null,sources:{players:{fetchedAt:new Date(now-120000).toISOString(),updatedAt:new Date(now-180000).toISOString()}}},...extra});
test('manual Refresh sends only the bounded JSON refresh request',()=>{
 assert.deepEqual(refreshRequest(),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
});
test('formatting keeps numeric zero, missing values, unreported injury and distinct source/check/change ages',()=>{
 assert.equal(formatNumber(0),'0');for(const v of [null,undefined,NaN])assert.equal(formatNumber(v),'—');
 assert.equal(formatAge(new Date(now-20000).toISOString(),now),'20s ago');assert.equal(formatAge(null,now),'—');
 assert.equal(injuryLabel(null),'Not reported');assert.equal(injuryLabel('Questionable'),'Questionable');assert.doesNotMatch(injuryLabel(null),/healthy/i);
 const labels=freshnessLabels(board(),now);assert.equal(labels.check,'0s ago');assert.equal(labels.changed,'20s ago');assert.equal(labels.prepared,'1h ago');
 assert.deepEqual(labels.sources,[{name:'players',fetched:'2m ago',updated:'3m ago'}]);
});
test('freshness labels use exact active15s/complete40s, immediate failure, connection loss and honest lag language',()=>{
 for(const status of ['pre_draft','drafting','paused','complete']){
  const b=board({draft:{status,availabilityKnown:true}}),limit=status==='complete'?40000:15000;
  assert.match(statusText(b,now+limit-1,true),/checked/i);assert.doesNotMatch(statusText(b,now+limit-1,true),/overdue|healthy|live now/i);
  assert.match(statusText(b,now+limit,true),/overdue/i);assert.match(statusText(b,now,true),/Sleeper may lag/);
  assert.match(statusText({...b,freshness:{...b.freshness,lastError:'HTTP500'}},now,true),/failed.*500/i);
 }
 assert.match(statusText(board(),now,false),/App connection lost.*retained/i);
 assert.match(statusText(board({error:{code:'PREPARE_REQUIRED',message:'Prepare again'}}),now,true),/PREPARE_REQUIRED.*Prepare again/);
 for(const reason of ['Draft availability is unknown','Unknown own player identities','No available candidate permits starter completion'])assert.match(statusText(board({status:'unavailable',reason}),now,true),new RegExp(reason));
 assert.match(statusText(board({status:'complete',reason:'Your draft selections are complete.'}),now,true),/complete/i);
 assert.match(statusText({...board(),freshness:{...board().freshness,stale:true}},now,true),/saved.*stale/i);
});
test('action envelope uses durable revision and the displayed own pick and exact pending/correction tokens',()=>{
 const b=board();assert.deepEqual(actionRequest(b,{type:'my-pick',playerId:'10151',pickNo:28}),{expectedRevision:2,action:{type:'my-pick',playerId:'10151',pickNo:28}});
 assert.deepEqual(actionRequest(b,{type:'taken',playerId:'10041'}),{expectedRevision:2,action:{type:'taken',playerId:'10041'}});
 assert.deepEqual(actionRequest(b,{type:'undo',correctionId:'local-2'}),{expectedRevision:2,action:{type:'undo',correctionId:'local-2'}});
 assert.deepEqual(actionRequest(b,{type:'accept-pending',pendingRevision:9}),{expectedRevision:2,action:{type:'accept-pending',pendingRevision:9}});
});
test('same-session newer view wins despite older request start; maximum applied sequence never decreases',()=>{
 const first=acceptBoard(null,board(),10),metadata=acceptBoard(first,board({viewRevision:5}),12);
 const action=acceptBoard(metadata,board({viewRevision:6,revision:3}),11);
 assert.equal(action.board.revision,3);assert.equal(action.maxAppliedRequestSequence,12);assert.equal(first.board.viewRevision,4);
 assert.equal(acceptBoard(action,board({viewRevision:5}),99),action);assert.equal(acceptBoard(action,board({viewRevision:6}),100),action);
 assert.equal(acceptBoard(action,board({sessionId:'unseen',viewRevision:80}),12),action);
});
test('unseen stale sessions reject, newer session may have lower view, and retired sessions never return',()=>{
 const first=acceptBoard(null,board({sessionId:'current',viewRevision:100}),20);
 assert.equal(acceptBoard(first,board({sessionId:'never-seen-old',viewRevision:200}),19),first);
 const restarted=acceptBoard(first,board({sessionId:'new',viewRevision:0}),21);
 assert.equal(restarted.board.sessionId,'new');assert.equal(restarted.board.viewRevision,0);assert.deepEqual(restarted.retired,['current']);
 assert.equal(acceptBoard(restarted,board({sessionId:'current',viewRevision:500}),30),restarted);
 assert.equal(acceptBoard(restarted,board({sessionId:'never-seen-old'}),20),restarted);
});
