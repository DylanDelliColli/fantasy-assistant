export function rankingsFixture(players) {
 return {year:'2026',week:'0',scoring:'HALF',players:Object.values(players).map((p,i)=>({player_id:String(50000+i),player_name:p.full_name,player_team_id:p.team,player_position_id:p.position==='DEF'?'DST':p.position,rank_ecr:i+1,tier:Math.floor(i/12)+1}))};
}
export function rankingsHtml(ecr) {return `<script>globalThis.sourceExecuted=true; var ecrData = ${JSON.stringify(ecr)}; globalThis.sourceExecuted=true;</script>`;}
