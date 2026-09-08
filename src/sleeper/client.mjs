import {createHash} from 'node:crypto';

export const DEFAULT_LEAGUE = '1389330057733865472';
export const DEFAULT_USER = '1264288993504149504';
export const DEFAULT_API = 'https://api.sleeper.app/v1';
const ROSTER = ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN'];
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function externalId(value, label = 'ID') {
  requireValue((typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), `Invalid ${label}`);
  return String(value);
}
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireValue(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)), `Invalid ${label}`);
  const n = Number(value);
  requireValue(Number.isSafeInteger(n) && n >= min && n <= max, `Invalid ${label}`);
  return n;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const FINGERPRINT_FIELDS = ['leagueId','draftId','userId','rosterId','season','sport','type','teams','rounds','reversalRound',
  'reserveSlots','rosterPositions','scoring','draftOrder','slotToRosterId','keepers','tradedPicks'];
export function fingerprintConfig(config) {
  return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(FINGERPRINT_FIELDS.map(k => [k,config[k]]))))).digest('hex');
}
function hasAssignments(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasAssignments);
  if (record(value)) return Object.values(value).some(hasAssignments);
  return value !== '' && value !== false;
}
function validateDraft(draft, leagueId, draftId, season) {
  requireValue(record(draft), 'Invalid draft response');
  requireValue(externalId(draft.draft_id,'draft ID') === draftId && externalId(draft.league_id,'draft league ID') === leagueId, 'Draft identity mismatch');
  requireValue(String(draft.season) === season, 'Draft season mismatch');
  requireValue(draft.sport === 'nfl' && draft.type === 'snake', 'Unsupported draft sport/type');
  requireValue(integer(draft.settings?.teams,'draft teams') === 14, 'Unsupported draft teams');
  requireValue(integer(draft.settings?.rounds,'draft rounds') === 13, 'Unsupported draft rounds');
  requireValue(integer(draft.settings?.reversal_round,'reversal round') === 0, 'Unsupported reversal round');
  requireValue(!hasAssignments(draft.keepers), 'Assigned keepers are unsupported');
}
function normalizedMappings(draft, rosters) {
  requireValue(record(draft.draft_order) && record(draft.slot_to_roster_id), 'Missing draft order/slot mappings');
  const draftOrder = {}, slotToRosterId = {}, slots = new Set(), rosterIds = new Set(rosters.map(r => r.rosterId));
  requireValue(Object.keys(draft.draft_order).length === 14 && Object.keys(draft.slot_to_roster_id).length === 14, 'Incomplete draft order/slot mappings');
  for (const [user, value] of Object.entries(draft.draft_order)) {
    const userId = externalId(user, 'draft owner ID'), slot = integer(value,'draft slot',1,14);
    requireValue(!slots.has(slot), 'Duplicate draft slot'); slots.add(slot);draftOrder[userId] = slot;
  }
  const mapped = new Set();
  for (const [key, value] of Object.entries(draft.slot_to_roster_id)) {
    const slot = integer(key, 'mapped draft slot',1,14), rosterId = externalId(value,'mapped roster ID');
    requireValue(rosterIds.has(rosterId) && !mapped.has(rosterId) && !own(slotToRosterId,String(slot)), 'Invalid/duplicate roster slot mapping');
    mapped.add(rosterId);slotToRosterId[slot] = rosterId;
  }
  for (const roster of rosters) requireValue(slotToRosterId[draftOrder[roster.ownerId]] === roster.rosterId, 'Owner/roster slot mapping mismatch');
  return {draftOrder, slotToRosterId};
}
/** Resolve a supported configuration from complete upstream responses. */
export function normalizeContext(raw, {leagueId = DEFAULT_LEAGUE, userId = DEFAULT_USER} = {}) {
  leagueId = externalId(leagueId,'requested league ID');userId = externalId(userId,'requested user ID');
  const {league, user, draft, rosters, tradedPicks, leagueTradedPicks} = raw;
  requireValue(record(league) && record(user), 'Invalid league/user response');
  requireValue(externalId(league.league_id,'league ID') === leagueId && externalId(user.user_id,'user ID') === userId, 'League/user identity mismatch');
  const draftId = externalId(league.draft_id,'draft ID');
  requireValue(/^(20\d{2})$/.test(String(league.season)), 'Unsupported NFL season');
  const season = String(league.season);
  requireValue(league.sport === 'nfl' && league.season_type === 'regular', 'Unsupported sport/season type');
  requireValue(integer(league.total_rosters,'league teams') === 14, 'Unsupported league teams');
  requireValue(JSON.stringify(league.roster_positions) === JSON.stringify(ROSTER), 'Unsupported roster slots');
  requireValue(integer(league.settings?.reserve_slots,'reserve slots') === 1, 'Unsupported reserve slots');
  requireValue(record(league.scoring_settings) && Object.values(league.scoring_settings).every(n => typeof n === 'number' && Number.isFinite(n)), 'Invalid scoring settings');
  requireValue(league.scoring_settings.rec === 0.5 && league.scoring_settings.pass_td === 4, 'Unsupported reception/passing touchdown scoring');
  validateDraft(draft, leagueId, draftId, season);
  requireValue(Array.isArray(tradedPicks) && Array.isArray(leagueTradedPicks), 'Invalid traded picks response');
  requireValue(tradedPicks.length === 0 && leagueTradedPicks.length === 0, 'Traded picks are unsupported');
  requireValue(Array.isArray(rosters) && rosters.length === 14, 'Invalid roster count');
  const rosterIds = new Set(), owners = new Set();
  const normalized = rosters.map(r => {
    requireValue(record(r), 'Invalid roster');
    const rosterId = externalId(r.roster_id,'roster ID'), ownerId = externalId(r.owner_id,'roster owner');
    requireValue(integer(rosterId,'roster ID',1,14) > 0 && !rosterIds.has(rosterId) && !owners.has(ownerId), 'Duplicate roster/owner ID');
    requireValue(r.league_id == null || externalId(r.league_id,'roster league ID') === leagueId, 'Roster league mismatch');
    requireValue(!hasAssignments(r.keepers), 'Assigned roster keepers are unsupported');
    rosterIds.add(rosterId); owners.add(ownerId); return {rosterId, ownerId};
  });
  const owner = normalized.find(r => r.ownerId === userId);requireValue(owner, 'Requested owner has no roster');
  const {draftOrder, slotToRosterId} = normalizedMappings(draft,normalized);
  const ownSlot = draftOrder[userId];
  if (leagueId === DEFAULT_LEAGUE && userId === DEFAULT_USER) {
    requireValue(owner.rosterId === '5', 'Confirmed league ownership changed from roster 5');
    requireValue(ownSlot === 1, 'Confirmed league draft slot changed from slot 1');
  }
  return {leagueId,draftId,userId,rosterId:owner.rosterId,season,sport:'nfl',type:'snake',teams:14,rounds:13,reversalRound:0,
    reserveSlots:1,rosterPositions:[...ROSTER],scoring:{...league.scoring_settings},draftOrder,slotToRosterId,keepers:{},tradedPicks:[],ownSlot,
    ownPicks:Array.from({length:13},(_,i) => i*14+(i%2===0?ownSlot:15-ownSlot)),leagueName:String(league.name ?? ''),username:String(user.username ?? '')};
}
export function normalizePicks(rows, config) {
  requireValue(Array.isArray(rows), 'Invalid picks response');
  const seenPicks = new Set(), seenPlayers = new Set(), rosterIds = new Set(Object.values(config.slotToRosterId));
  const result = rows.map(row => {
    requireValue(record(row), 'Invalid pick row');
    const pickNo = integer(row.pick_no,'pick number',1,config.teams*config.rounds);
    const round = integer(row.round,'pick round',1,config.rounds), draftSlot = integer(row.draft_slot,'pick slot',1,config.teams);
    const playerId = externalId(row.player_id,'pick player ID');
    const expectedRound = Math.ceil(pickNo/config.teams), offset = (pickNo-1)%config.teams;
    requireValue(round === expectedRound && draftSlot === (round%2 ? offset+1 : config.teams-offset), 'Illegal pick round/slot mapping');
    requireValue(!seenPicks.has(pickNo) && !seenPlayers.has(playerId), 'Duplicate pick number/player ID');
    seenPicks.add(pickNo);seenPlayers.add(playerId);
    const rosterId = row.roster_id == null ? config.slotToRosterId[draftSlot] : externalId(row.roster_id,'pick roster ID');
    requireValue(rosterIds.has(rosterId), 'Illegal pick roster ID');
    const pickedBy = row.picked_by == null || row.picked_by === '' ? '' : externalId(row.picked_by,'picked_by ID');
    return {pickNo,round,draftSlot,playerId,rosterId,pickedBy};
  }).sort((a,b) => a.pickNo-b.pickNo);
  requireValue(result.every((row,i) => row.pickNo === i+1), 'Pick gap: full snapshot must be contiguous');
  return result;
}
/** GET-only request; deadline covers response body as well as headers. */
export async function requestSource(url, {timeoutMs = 4000, text = false} = {}) {
  const response = await fetch(url,{method:'GET',signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) {
    const error = new Error(`Source HTTP ${response.status}: ${url}`);
    error.status = response.status; error.retryAfter = response.headers.get('retry-after');
    await response.body?.cancel();throw error;
  }
  return text ? response.text() : response.json();
}
export async function loadContext({leagueId = DEFAULT_LEAGUE,userId = DEFAULT_USER,sourceUrls = {},timeoutMs = 4000} = {}) {
  leagueId=externalId(leagueId);userId=externalId(userId);const base=sourceUrls.apiBase ?? DEFAULT_API;
  const [league,user,rosters,leagueTradedPicks] = await Promise.all([
    requestSource(`${base}/league/${leagueId}`,{timeoutMs}),requestSource(`${base}/user/${userId}`,{timeoutMs}),
    requestSource(`${base}/league/${leagueId}/rosters`,{timeoutMs}),requestSource(`${base}/league/${leagueId}/traded_picks`,{timeoutMs})]);
  const draftId=externalId(league?.draft_id,'draft ID');
  const [draft,tradedPicks] = await Promise.all([requestSource(`${base}/draft/${draftId}`,{timeoutMs}),requestSource(`${base}/draft/${draftId}/traded_picks`,{timeoutMs})]);
  return normalizeContext({league,user,rosters,leagueTradedPicks,draft,tradedPicks},{leagueId,userId});
}
export async function fetchDraftSnapshot(config,{sourceUrls = {},timeoutMs = 4000,now = Date.now} = {}) {
  const base=sourceUrls.apiBase ?? DEFAULT_API;
  const [draft,rows,trades] = await Promise.all([requestSource(`${base}/draft/${config.draftId}`,{timeoutMs}),
    requestSource(`${base}/draft/${config.draftId}/picks`,{timeoutMs}),requestSource(`${base}/draft/${config.draftId}/traded_picks`,{timeoutMs})]);
  validateDraft(draft,config.leagueId,config.draftId,config.season);
  const rosters=Object.entries(config.draftOrder).map(([ownerId,slot]) => ({ownerId,rosterId:config.slotToRosterId[slot]}));
  const mappings=normalizedMappings(draft,rosters);
  requireValue(Array.isArray(trades) && trades.length === 0, 'Draft configuration changed: traded picks require preparation');
  requireValue(fingerprintConfig({...config,...mappings}) === fingerprintConfig(config), 'Draft configuration changed: prepare again');
  requireValue(['pre_draft','drafting','paused','complete'].includes(draft.status), 'Unsupported draft status');
  return {draftId:config.draftId,configFingerprint:fingerprintConfig(config),status:draft.status,fetchedAt:new Date(now()).toISOString(),picks:normalizePicks(rows,config)};
}
