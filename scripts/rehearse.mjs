import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {runtimeFixture} from '../tests/helpers/runtime.mjs';
import {pick} from '../tests/fixtures/sleeper.mjs';
import {openSession} from '../src/session.mjs';
import {createApp} from '../src/server.mjs';

/** Advance fixture picks from the operator's saved choices, without mutating the saved state. */
export function advanceStage(stage,state,source,earlierCandidateIds=[]){
  if(![0,1,27,28,29].includes(stage))throw new Error('Invalid rehearsal stage.');
  const target=stage===0?1:stage===1?27:stage===27?28:29;
  const required=stage===0?1:stage===27?28:stage===28?29:null;
  const accepted=state.accepted?.picks??[];
  const chosen=required===null?null:accepted.find(p=>p.pickNo===required)?.playerId??state.corrections.find(c=>c.type==='my-pick'&&c.pickNo===required)?.playerId;
  if(required!==null&&!chosen)throw new Error(`Record own pick ${required} before advancing.`);
  const picks=accepted.map(p=>pick(p.pickNo,p.playerId));
  if(required!==null&&!accepted.some(p=>p.pickNo===required))picks.push(pick(required,chosen));
  const used=new Set([...picks.map(p=>p.player_id),...state.corrections.map(c=>c.playerId)]);
  const ids=[...new Set([...earlierCandidateIds,...Object.keys(source.playersById)])];
  while(picks.length<target){
    const id=ids.find(id=>Object.hasOwn(source.playersById,id)&&!used.has(id));
    if(!id)throw new Error('Rehearsal has insufficient fixture players.');
    used.add(id);picks.push(pick(picks.length+1,id));
  }
  return {stage:target,picks};
}
export async function launchRehearsal({input=process.stdin,output=process.stdout}={}){
  const cleanup=[],scope={after:fn=>cleanup.push(fn)};let app,lines;
  const say=text=>output.write(`${text}\n`);
  try{
    const f=await runtimeFixture(scope,{controlled:false,configure:u=>{u.c.league.name='REHEARSAL — Fictional league';}});
    const session=await openSession({...f.options,autoRefresh:false});cleanup.push(()=>session.close());await session.refresh();
    const earlier=session.getBoard().candidates.map(c=>c.playerId);
    app=createApp({session});app.listen(0,'127.0.0.1');await once(app,'listening');
    say('REHEARSAL — fictional data, private temporary state, no real provider requests.');
    say(`Open http://127.0.0.1:${app.address().port}`);say(`Private rehearsal state: ${f.dir}`);
    say('Record your own choice in the browser. Enter advances 0 → 1 → 27 → 28 → 29; q or quit exits and removes this rehearsal.');
    say('Stage 0: Choose your own pick 1. Human ten-second choice timing is unmeasured.');
    let stage=0;lines=createInterface({input,crlfDelay:Infinity});
    for await(const line of lines){
      if(['q','quit'].includes(line.trim().toLowerCase()))break;
      if(line.trim()){say('Press Enter to advance, or q to quit.');continue;}
      try{
        if(stage===29){say('Rehearsal complete. Quit to return to your separate live app.');continue;}
        const state=JSON.parse(await readFile(f.file,'utf8')),next=advanceStage(stage,state,f.source,earlier);
        f.routes[f.picksPath]=next.picks;await session.refresh();stage=next.stage;
        say(`Stage ${stage}: ${stage===1?'Enter supplies opponent picks through 27.':stage===27?'Choose your own pick 28.':stage===28?'Choose your own pick 29.':'Choices confirmed once. Quit when finished.'}`);
      }catch(e){if(e.code==='ENOENT')say('Record own pick 1 before advancing.');else say(e.message);}
    }
    await app.shutdown();app=null;
    say(`REHEARSAL_AUDIT ${JSON.stringify({upstream:f.sourceUrls,requests:f.requests})}`);
  }finally{
    lines?.close();if(app)await app.shutdown();
    for(const close of cleanup.reverse())await close();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await launchRehearsal();}catch(e){console.error(`Unable to run rehearsal: ${e.message}`);process.exitCode=1;}
}
