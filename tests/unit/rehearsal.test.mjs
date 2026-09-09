import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceStage} from '../../scripts/rehearse.mjs';
import {contextFixture,sourceFixture} from '../fixtures/sleeper.mjs';
import {normalizeContext,normalizePicks} from '../../src/sleeper/client.mjs';
const source={config:normalizeContext(contextFixture()),playersById:sourceFixture().players};
test('rehearsal stages0/1/27/28/29 preserve actual own choices and remove an earlier suggestion with valid unique picks',()=>{
 let stage=0,state={accepted:{picks:[]},corrections:[{type:'my-pick',pickNo:1,playerId:'10041'}]},prior=[];
 for(const expected of [1,27,28,29]){
  if(stage===27)state.corrections.push({type:'my-pick',pickNo:28,playerId:'10155'});
  if(stage===28)state.corrections.push({type:'my-pick',pickNo:29,playerId:'10156'});
  const bytes=JSON.stringify({state,source}),next=advanceStage(stage,state,source,['10001','10002','10003']);
  assert.equal(next.stage,expected);assert.equal(next.picks.length,expected);assert.equal(JSON.stringify({state,source}),bytes);
  const picks=normalizePicks(next.picks,source.config);assert.deepEqual(picks.slice(0,prior.length),prior);
  assert.equal(new Set(picks.map(p=>p.playerId)).size,expected);assert.deepEqual(picks.map(p=>p.pickNo),Array.from({length:expected},(_,i)=>i+1));
  assert.equal(picks[0].playerId,'10041');if(expected>=27)assert.equal(picks[1].playerId,'10001');
  if(expected>=28)assert.equal(picks[27].playerId,'10155');if(expected>=29)assert.equal(picks[28].playerId,'10156');
  for(const p of picks.filter(p=>[1,28,29].includes(p.pickNo))){assert.equal(p.rosterId,'5');assert.equal(p.draftSlot,1);}
  prior=picks;state={accepted:{picks},corrections:[]};stage=next.stage;
 }
});
test('rehearsal refuses premature own1/28/29 advancement and invalid stages without mutating state',()=>{
 for(const [stage,required] of [[0,1],[27,28],[28,29]]){
  const state={accepted:{picks:[]},corrections:[]},before=JSON.stringify(state);
  assert.throws(()=>advanceStage(stage,state,source,[]),new RegExp(`Record own pick ${required}`));assert.equal(JSON.stringify(state),before);
 }
 assert.throws(()=>advanceStage(9,{accepted:{picks:[]},corrections:[]},source,[]),/stage/i);
});
