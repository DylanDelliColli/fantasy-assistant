import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {readFile,rename,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {openSession} from '../../src/session.mjs';
import {createApp,start,DEFAULT_PORT} from '../../src/server.mjs';
import {runtimeFixture,assetsFixture,until} from '../helpers/runtime.mjs';

async function appFixture(t,{held=false}={}){
 const f=await runtimeFixture(t),barrier=held?f.hold(f.picksPath):null;
 const session=await openSession({...f.options,autoRefresh:held});
 const assetsDirectory=await assetsFixture(t),app=createApp({session,assetsDirectory});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.shutdown());
 return {...f,session,app,barrier,base:`http://127.0.0.1:${app.address().port}`};
}
function raw(base,path,{method='GET',headers={},body=''}={}){
 const url=new URL(base);return new Promise((resolve,reject)=>{
  const req=request({hostname:url.hostname,port:url.port,path,method,headers},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
  req.on('error',reject);req.end(body);
 });
}
async function post(f,path,body,headers={}){return raw(f.base,path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});}

test('real board GET completes while upstream is held; refresh202 joins one cycle and uses no-store',async t=>{
 const f=await appFixture(t,{held:true});await f.barrier.entered;
 const result=await raw(f.base,'/api/board');assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'no-store');
 assert.equal(JSON.parse(result.text).draft.availabilityKnown,false);
 const replies=await Promise.all([post(f,'/api/refresh',{}),post(f,'/api/refresh',{})]);
 assert.ok(replies.every(r=>r.status===202&&JSON.parse(r.text).inflight===true));
 assert.equal(f.requests.filter(r=>r.url===f.picksPath).length,1);
 f.barrier.release();await until(()=>!f.session.getBoard().refresh.inflight);
 const board=JSON.parse((await raw(f.base,'/api/board')).text);assert.equal(board.draft.availabilityKnown,true);assert.equal(board.candidates.length,3);
 assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('actions return200 only after durable save,409 stale,422 invalid and500 structured disk failure',async t=>{
 const f=await appFixture(t);await f.session.refresh();const revision=f.session.getBoard().revision;
 let response=await post(f,'/api/actions',{expectedRevision:revision,action:{type:'taken',playerId:'10041'}});
 assert.equal(response.status,200);const saved=JSON.parse(response.text);assert.equal(saved.revision,revision+1);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).revision,saved.revision);
 for(const [body,status,code] of [
  [{expectedRevision:revision,action:{type:'taken',playerId:'10042'}},409,'STALE_REVISION'],
  [{expectedRevision:saved.revision,action:{type:'taken',playerId:'unknown'}},422,'INVALID_ACTION'],
  [{expectedRevision:saved.revision,action:{type:'my-pick',playerId:'10042',pickNo:28}},422,'INVALID_ACTION']]){
  response=await post(f,'/api/actions',body);assert.equal(response.status,status);const error=JSON.parse(response.text);assert.equal(error.error.code,code);assert.equal(error.revision,saved.revision);
 }
 const bytes=await readFile(f.file);await rename(f.file,f.file+'.retained');await mkdir(f.file);
 response=await post(f,'/api/actions',{expectedRevision:saved.revision,action:{type:'taken',playerId:'10042'}});
 assert.equal(response.status,500);const failure=JSON.parse(response.text);assert.equal(failure.error.code,'PERSISTENCE_FAILED');assert.equal(failure.revision,saved.revision);
 assert.doesNotMatch(response.text,/stack|fantasy-session|EISDIR|127\.0\.0\.1/);assert.deepEqual(await readFile(f.file+'.retained'),bytes);
 assert.equal(f.session.getBoard().corrections.length,1);
});
test('body,method,route,Host and Origin failures reject before mutation with structured safe JSON',async t=>{
 const f=await appFixture(t);await f.session.refresh();const before=f.session.getBoard(),count=f.requests.length;
 const valid=JSON.stringify({expectedRevision:before.revision,action:{type:'taken',playerId:'10041'}});
 const cases=[
  ['/api/actions',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'},400,'BAD_JSON'],
  ['/api/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pad:'é'.repeat(9000)})},413,'BODY_TOO_LARGE'],
  ['/api/actions',{method:'POST',headers:{'content-type':'text/plain'},body:valid},415,'UNSUPPORTED_CONTENT_TYPE'],
  ['/api/actions',{method:'POST',headers:{'content-type':'application/json',host:'evil.example'},body:valid},403,'FORBIDDEN'],
  ['/api/actions',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:valid},403,'FORBIDDEN'],
  ['/api/refresh',{method:'POST',headers:{'content-type':'application/json',origin:f.base+'/'},body:'{}'},403,'FORBIDDEN'],
  ['/api/refresh',{method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1:1'},body:'{}'},403,'FORBIDDEN'],
  ['/api/board',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},405,'METHOD_NOT_ALLOWED'],
  ['/api/actions',{method:'GET'},405,'METHOD_NOT_ALLOWED'],
  ['/api/board',{method:'DELETE'},405,'METHOD_NOT_ALLOWED'],
  ['/api/unknown',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},404,'NOT_FOUND'],
  ['/api/proxy?url=https://example.test',{method:'GET'},404,'NOT_FOUND'],
  ['/api/picks',{method:'POST',headers:{'content-type':'application/json'},body:valid},404,'NOT_FOUND']
 ];
 for(const [path,options,status,code] of cases){
  const reply=await raw(f.base,path,options);assert.equal(reply.status,status,path);const body=JSON.parse(reply.text);
  assert.deepEqual(Object.keys(body).sort(),['error','revision']);assert.equal(body.error.code,code);assert.equal(body.revision,before.revision);
  assert.equal(typeof body.error.message,'string');assert.doesNotMatch(reply.text,/stack|fantasy-session|secret body/);assert.equal(reply.headers['access-control-allow-origin'],undefined);
 }
 assert.equal(f.session.getBoard().revision,before.revision);assert.equal(f.requests.length,count);assert.equal(f.session.getBoard().corrections.length,0);
 // Exact local Origin and absent Origin are both valid local clients.
 let reply=await post(f,'/api/actions',{expectedRevision:before.revision,action:{type:'taken',playerId:'10041'}},{origin:f.base});assert.equal(reply.status,200);
 reply=await post(f,'/api/actions',{expectedRevision:JSON.parse(reply.text).revision,action:{type:'taken',playerId:'10042'}});assert.equal(reply.status,200);
});
test('only fixed real temporary assets are served; private/encoded/traversal/proxy paths cannot become files',async t=>{
 const f=await appFixture(t);
 for(const [path,content,type] of [['/','Fixture only','text/html'],['/index.html','Fixture only','text/html'],['/app.mjs','fixture=true','javascript'],['/styles.css','color: black','text/css']]){
  const reply=await raw(f.base,path);assert.equal(reply.status,200);assert.match(reply.text,new RegExp(content));assert.ok(reply.headers['content-type'].includes(type));
 }
 for(const path of ['/.local/secret.json','/../README.md','/%2e%2e/README.md','/app.mjs/../.local/secret.json','/%2e%2e%2f.local/snapshot.json','/%252e%252e/.local/snapshot.json','/src/session.mjs','/ecr','http://example.test/']){
  const reply=await raw(f.base,path);assert.equal(reply.status,404,path);assert.doesNotMatch(reply.text,/private fixture|sourceExecuted/);
 }
 assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('npm start entry uses the real server/session with loopback defaults and owned shutdown',async t=>{
 const f=await runtimeFixture(t),assetsDirectory=await assetsFixture(t);
 assert.equal(DEFAULT_PORT,3000);const app=await start({...f.options,assetsDirectory,port:0,autoRefresh:false});t.after(()=>app.shutdown());
 assert.equal(app.address().address,'127.0.0.1');const response=await fetch(`http://127.0.0.1:${app.address().port}/api/board`);assert.equal(response.status,200);
 assert.equal((await response.json()).draft.availabilityKnown,false);await app.shutdown();
 await assert.rejects(readFile(f.lock),{code:'ENOENT'});assert.equal(f.clock.pending(),0);
});
