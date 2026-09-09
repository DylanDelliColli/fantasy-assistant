import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openSession} from './session.mjs';

export const DEFAULT_PORT=3000;
const assetsDefault=fileURLToPath(new URL('../web/',import.meta.url));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],
 ['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']]]);
const problem=(status,code,message)=>Object.assign(new Error(message),{status,code});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function body(req){
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??''))throw problem(415,'UNSUPPORTED_CONTENT_TYPE','Use application/json.');
 return new Promise((resolve,reject)=>{
  let size=0,overflow=false;const chunks=[];
  req.on('data',chunk=>{
   size+=chunk.length;
   if(size>16384){if(!overflow){overflow=true;reject(problem(413,'BODY_TOO_LARGE','JSON body exceeds 16 KiB.'));}return;}
   if(!overflow)chunks.push(chunk);
  });
  req.on('error',()=>reject(problem(400,'BAD_JSON','Unable to read JSON body.')));
  req.on('end',()=>{if(overflow)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(problem(400,'BAD_JSON','Malformed JSON body.'));}});
 });
}
function localMutation(req){
 const host=`127.0.0.1:${req.socket.localPort}`,origin=`http://${host}`;
 if(req.headers.host!==host||(req.headers.origin!==undefined&&req.headers.origin!==origin))throw problem(403,'FORBIDDEN','A local app Host and Origin are required.');
}

/** Native loopback HTTP server. The caller chooses when to listen; shutdown owns cleanup. */
export function createApp({session,assetsDirectory=assetsDefault}){
 const directory=resolve(assetsDirectory);
 const app=createServer(async(req,res)=>{
  const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const path=req.url.split('?')[0],asset=assets.get(path);
   const method=path==='/api/board'||asset?'GET':['/api/refresh','/api/actions'].includes(path)?'POST':null;
   if(!method)throw problem(404,'NOT_FOUND','Route not found.');
   if(req.method!==method)throw problem(405,'METHOD_NOT_ALLOWED','Method not allowed.');
   if(method==='POST')localMutation(req);
   if(path==='/api/board'){json(200,session.getBoard());return;}
   if(path==='/api/refresh'){
    const input=await body(req);if(!record(input))throw problem(422,'INVALID_ACTION','Refresh body must be an object.');
    void session.refresh({context:input.context===true}).catch(()=>{});
    const board=session.getBoard();json(202,{...board.refresh,revision:board.revision});return;
   }
   if(path==='/api/actions'){
    const input=await body(req);if(!record(input)||!record(input.action))throw problem(422,'INVALID_ACTION','Action body must contain an action object.');
    json(200,await session.act(input));return;
   }
   let content;try{content=await readFile(join(directory,asset[0]));}catch{throw problem(404,'NOT_FOUND','Asset not found.');}
   res.writeHead(200,{'content-type':asset[1],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(content);
  }catch(e){
   const known=['BAD_JSON','BODY_TOO_LARGE','UNSUPPORTED_CONTENT_TYPE','FORBIDDEN','NOT_FOUND','METHOD_NOT_ALLOWED',
    'STALE_REVISION','INVALID_ACTION','PERSISTENCE_FAILED','RECOVERY_REQUIRED','CLOSED'].includes(e.code);
   json(known?e.status??500:500,{error:{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'Unable to complete the local request.'},revision:session.getBoard().revision});
  }
 });
 let shutdown;
 app.shutdown=()=>shutdown??=new Promise((resolve,reject)=>{
  app.close(async()=>{try{await session.close();resolve();}catch(e){reject(e);}});app.closeAllConnections();
 });
 return app;
}

/** Same entry called by npm start; URL/clock overrides are in-process test options only. */
export async function start(options={}){
 const port=options.port??DEFAULT_PORT;
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid local port.');
 const session=await openSession(options),app=createApp({session,assetsDirectory:options.assetsDirectory});
 try{await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(port,'127.0.0.1',resolve);});}
 catch(e){await session.close();throw e;}
 return app;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const options={};
  for(let i=2;i<process.argv.length;i++){
   const flag=process.argv[i];if(!['--data-dir','--port'].includes(flag)||process.argv[i+1]===undefined)throw new Error('Usage: npm start -- [--data-dir .local] [--port 3000]');
   options[flag==='--data-dir'?'dataDirectory':'port']=flag==='--port'?Number(process.argv[++i]):process.argv[++i];
  }
  const app=await start(options);console.log(`Listening on http://127.0.0.1:${app.address().port}`);
  const stop=()=>{void app.shutdown().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }catch(e){console.error(e.code==='LOCKED'?e.message:'Unable to start the local server; prepare valid private data and check local ownership.');process.exitCode=1;}
}
