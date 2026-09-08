import {createServer} from 'node:http';
import {contextFixture,sourceFixture,LEAGUE,USER,DRAFT} from '../fixtures/sleeper.mjs';
import {rankingsFixture,rankingsHtml} from '../fixtures/rankings.mjs';
export async function upstream(t) {
 const c=contextFixture(),s=sourceFixture(); const routes={
 [`/v1/league/${LEAGUE}`]:c.league,[`/v1/user/${USER}`]:c.user,[`/v1/league/${LEAGUE}/rosters`]:c.rosters,
 [`/v1/draft/${DRAFT}`]:c.draft,[`/v1/draft/${DRAFT}/picks`]:c.picks,[`/v1/draft/${DRAFT}/traded_picks`]:c.tradedPicks,[`/v1/league/${LEAGUE}/traded_picks`]:c.leagueTradedPicks,
 '/v1/players/nfl':s.players,'/projections/nfl/2026?season_type=regular':s.projections,'/stats/nfl/2025?season_type=regular':s.history,'/ecr':rankingsHtml(rankingsFixture(s.players))};
 const requests=[];const failures=new Set();
 const server=createServer((req,res)=>{requests.push({url:req.url,method:req.method}); if(failures.has(req.url)){res.writeHead(503);res.end('unavailable');return;}if(!(req.url in routes)){res.writeHead(404);res.end();return;}res.end(typeof routes[req.url]==='string'?routes[req.url]:JSON.stringify(routes[req.url]));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 return {c,s,routes,requests,failures,sourceUrls:{apiBase:`${base}/v1`,statsBase:base,ecr:`${base}/ecr`}};
}
