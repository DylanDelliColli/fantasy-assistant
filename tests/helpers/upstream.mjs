import {createServer} from 'node:http';
import {contextFixture,sourceFixture,LEAGUE,USER,DRAFT} from '../fixtures/sleeper.mjs';
import {rankingsFixture,rankingsHtml} from '../fixtures/rankings.mjs';
export async function upstream(t) {
 const c=contextFixture(),s=sourceFixture(); const routes={
 [`/v1/league/${LEAGUE}`]:c.league,[`/v1/user/${USER}`]:c.user,[`/v1/league/${LEAGUE}/rosters`]:c.rosters,
 [`/v1/draft/${DRAFT}`]:c.draft,[`/v1/draft/${DRAFT}/picks`]:c.picks,[`/v1/draft/${DRAFT}/traded_picks`]:c.tradedPicks,[`/v1/league/${LEAGUE}/traded_picks`]:c.leagueTradedPicks,
 '/v1/players/nfl':s.players,'/projections/nfl/2026?season_type=regular':s.projections,'/stats/nfl/2025?season_type=regular':s.history,'/ecr':rankingsHtml(rankingsFixture(s.players))};
 const requests=[];const failures=new Set();const responses=new Map(),barriers=new Map();
 const server=createServer(async(req,res)=>{
  requests.push({url:req.url,method:req.method});
  const body=typeof routes[req.url]==='string'?routes[req.url]:JSON.stringify(routes[req.url]);
  const response=responses.get(req.url),barrier=barriers.get(req.url);
  if(barrier){barrier.arrive();await barrier.promise;}
  if(res.destroyed)return;
  if(response){res.writeHead(response.status??200,response.headers??{});res.end(response.body??body);return;}
  if(failures.has(req.url)){res.writeHead(503);res.end('unavailable');return;}
  if(!(req.url in routes)){res.writeHead(404);res.end();return;}res.end(body);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 function hold(path){
  let release,arrive;const promise=new Promise(r=>release=r),entered=new Promise(r=>arrive=r);
  const barrier={promise,entered,arrive,release:()=>{barriers.delete(path);release();}};
  barriers.set(path,barrier);t.after(barrier.release);return barrier;
 }
 return {c,s,routes,requests,failures,responses,hold,sourceUrls:{apiBase:`${base}/v1`,statsBase:base,ecr:`${base}/ecr`}};
}
