export const LEAGUE = '1389330057733865472';
export const USER = '1264288993504149504';
export const DRAFT = '1389330057733865473';
export const NOW = '2026-09-08T18:00:00.000Z';
export const TEAMS = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
export function contextFixture() {
 const owners = Array.from({length:14},(_,i)=> i===4?USER:`9000000000000000${i}`);
 const order = [owners[4],...owners.filter(x=>x!==USER)];
 return {
 league: {league_id:LEAGUE,draft_id:DRAFT,season:'2026',season_type:'regular',sport:'nfl',total_rosters:14,settings:{draft_rounds:3,reserve_slots:1,type:0},roster_positions:['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN'],scoring_settings:{rec:0.5,pass_td:4,rush_yd:0.1},name:'Fictional league'},
 user:{user_id:USER,username:'Fictional'},
 rosters:owners.map((owner_id,i)=>({owner_id,roster_id:i+1,league_id:LEAGUE,keepers:null})),
 draft:{draft_id:DRAFT,league_id:LEAGUE,season:'2026',sport:'nfl',type:'snake',status:'pre_draft',settings:{teams:14,rounds:13,reversal_round:0},draft_order:Object.fromEntries(order.map((id,i)=>[id,i+1])),slot_to_roster_id:Object.fromEntries(order.map((id,i)=>[i+1,owners.indexOf(id)+1])),keepers:null},
 tradedPicks:[],leagueTradedPicks:[],picks:[]
 };
}
export function sourceFixture() {
 const counts={QB:40,RB:110,WR:130,TE:56,K:32,DEF:32}; const players={};const projections=[];const history=[];let n=0;
 for(const [position,count] of Object.entries(counts)) for(let i=0;i<count;i++){
  n++; const id=position==='DEF'?TEAMS[i]:String(10000+n); const team=TEAMS[i%32];
  players[id]={player_id:id,full_name:`Fictional ${position} ${i}`,first_name:'Fictional',last_name:`${position} ${i}`,position,fantasy_positions:[position],team,active:true,injury_status:null};
  projections.push({player_id:id,season:'2026',season_type:'regular',sport:'nfl',updated_at:123456,stats:{adp_half_ppr:n,pts_half_ppr:n===1?0:100,gp:18}});
  history.push({player_id:id,season:'2025',season_type:'regular',sport:'nfl',updated_at:123,stats:{pts_half_ppr:90,gp:1}});
 }
 return {players,projections,history};
}
export function pick(pick_no, player_id=String(10000+pick_no)) {
 const round=Math.ceil(pick_no/14);const offset=(pick_no-1)%14;const draft_slot=round%2?offset+1:14-offset;
 return {pick_no,round,draft_slot,player_id,picked_by:''};
}
