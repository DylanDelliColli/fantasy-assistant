import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {runPrepare} from '../../scripts/prepare-data.mjs';
import {loadSnapshot} from '../../src/data/snapshot.mjs';
import {upstream} from './upstream.mjs';
import {NOW,DRAFT} from '../fixtures/sleeper.mjs';

export function barrier(){let release;const promise=new Promise(r=>release=r);return {promise,release};}
export async function until(predicate){
 const end=performance.now()+5000;
 while(!predicate()){assert.ok(performance.now()<end,'controlled operation did not settle');await immediate();}
}
export function controlledClock(t){
 let time=Date.parse(NOW),sequence=0;const timers=new Map(),deadlines=new Map();
 const clock={now:()=>time,setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{at:time+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
  jump:ms=>{time+=ms;},pending:()=>timers.size,
  advance:async ms=>{
   const target=time+ms;
   for(;;){const next=[...[...timers].map(([id,item])=>({id,item,map:timers})),...[...deadlines].map(([id,item])=>({id,item,map:deadlines}))]
    .filter(x=>x.item.at<=target).sort((a,b)=>a.item.at-b.item.at||a.id-b.id)[0];
    if(!next)break;time=Math.max(time,next.item.at);next.map.delete(next.id);next.item.fn();await Promise.resolve();
   }
   time=target;await immediate();
  }};
 // Only time is controlled: real client fetch, HTTP bodies and storage still execute.
 t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();deadlines.set(++sequence,{at:time+ms,fn:()=>controller.abort(new DOMException('Request timed out','TimeoutError'))});return controller.signal;});
 t.after(()=>{timers.clear();deadlines.clear();});return clock;
}
export async function runtimeFixture(t){
 const u=await upstream(t),dir=await mkdtemp(join(tmpdir(),'fantasy-session-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await runPrepare(['--data-dir',dir],{sourceUrls:u.sourceUrls,now:()=>Date.parse(NOW)});
 const source=await loadSnapshot(join(dir,'snapshot.json')),clock=controlledClock(t);
 return {...u,dir,source,clock,options:{dataDirectory:dir,sourceUrls:u.sourceUrls,clock},
  sessionDirectory:join(dir,'drafts',DRAFT),file:join(dir,'drafts',DRAFT,'session.json'),lock:join(dir,'drafts',DRAFT,'session.lock'),picksPath:`/v1/draft/${DRAFT}/picks`};
}
export async function assetsFixture(t){
 const dir=await mkdtemp(join(tmpdir(),'fantasy-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await Promise.all([writeFile(join(dir,'index.html'),'<!doctype html><title>Fixture only</title>'),writeFile(join(dir,'app.mjs'),'export const fixture=true;'),writeFile(join(dir,'styles.css'),'body { color: black; }'),mkdir(join(dir,'.local'))]);
 await writeFile(join(dir,'.local','secret.json'),'private fixture');return dir;
}
