# Fantasy planning — fantasy-p55

```doc-meta
role: working
lifecycle: inflight
```

Tier: **Full**, confirmed by the operator on 2026-09-08.

Rationale: A new product with an external platform integration, uncertain data
sources, and architecture decisions requires Full planning.

Planning epic: `fantasy-p55` tracks the personal Sleeper fantasy football
assistant and its approved execution backlog.
Workflow: `/home/ddc/.claude/skills/abacus-plan/SKILL.md`.

## FRAMING

Status: **Approved** by the operator on 2026-09-08: "approve the framing".
Approval covers the browser presentation, stories, non-goals, success metric,
and confirmed league constraints below. The next stage is RESEARCH.
Targeted source checks below answer the operator's documentation and source
requests; they do not constitute approval or completion of the RESEARCH stage.

### Confirmed intent and constraints

- Personal fantasy football assistant for the operator, using Sleeper.
- League: **2026 Fiji**, a 14-team redraft league; season 2026.
- Scoring: half-PPR (0.5 per reception), 4 points per passing touchdown,
  -2 per interception, 0.04 per passing yard, and 0.1 per rushing/receiving yard.
- Roster: QB, 2 RB, 2 WR, TE, FLEX, K, DEF, and 4 bench slots; 1 reserve slot.
- Draft: 13-round snake, 60 seconds per pick, no configured reversal round.
- Kijuuu is draft slot **1**, with roster ID **5**. The first five overall
  selections are 1, 28, 29, 56, and 57 under the currently configured order.
- Prioritize draft assistance and fast consultation during the draft.
- The operator reported the draft is tonight, approximately nine hours away.
  Sleeper lists 2026-09-08 21:00:45 America/New_York (2026-09-09 01:00:45 UTC)
  as its scheduled start. This is a schedule, not a guarantee of actual start.
- Recommendations only. The operator makes picks in Sleeper.
- Season management remains a later product goal, outside tonight's release.
- Sleeper is the operator's only current source. They are open to other
  recommendations. No third-party subscription or purchase is authorized.
- Repository has no application code or test suite. Planning is published to
  origin/master at git@github.com:DylanDelliColli/fantasy-assistant.git; pushes
  use the existing github-personal SSH host.

### Verified league identity

Read from Sleeper on 2026-09-08 around 16:14 UTC:

| Field | Value |
| --- | --- |
| League ID | `1389330057733865472` |
| Draft ID | `1389330057733865473` |
| Username | `Kijuuu` (API canonical username `kijuuu`) |
| User ID | `1264288993504149504` |
| Roster ID | `5` |
| Draft slot | `1` |
| State | `pre_draft`; no picks returned |
| Operator roster | No players or keepers assigned |

Evidence: [league](https://api.sleeper.app/v1/league/1389330057733865472),
[drafts](https://api.sleeper.app/v1/league/1389330057733865472/drafts),
[user](https://api.sleeper.app/v1/user/Kijuuu),
[rosters](https://api.sleeper.app/v1/league/1389330057733865472/rosters), and
[picks](https://api.sleeper.app/v1/draft/1389330057733865473/picks).

Integration detail for RESEARCH: roster ID 5 is not draft slot 1. The league
record's `settings.draft_rounds` is 3 while the active draft's `settings.rounds`
is 13. Preserve this distinction when selecting fields and defining tests.

### Narrowest valuable release

A personal draft assistant that loads the actual league rules and draft state,
then presents three available pick candidates with short, source-grounded
reasons reflecting player value and the operator's drafted roster. Picked
players disappear as the draft updates. The operator can see when data was
last refreshed and retain the last usable board if a refresh fails. Show the
operator's next two picks and account for consecutive selections at the turn.

Approved presentation: a browser page kept beside Sleeper, showing the shortlist
without requiring a new question each turn.

### User stories and acceptance scenarios

- **US-DRAFT-01 — Prepare:** Review a league-specific draft plan before the
  draft. Given the actual scoring, roster requirements, and draft position,
  show a concise strategy and identify the data supporting it; do not silently
  substitute assumed league settings.
- **US-DRAFT-02 — Consult during the draft:** See three available candidates,
  or all eligible candidates if fewer remain, with concise reasons. After
  another team drafts a candidate and that pick is observed, remove that
  player from the shortlist and incorporate the operator's own completed picks.
  At picks 28 and 29, retain the next-pick context and reconsider the second
  selection after the first is recorded. Do not equate roster ID with slot.
- **US-DRAFT-03 — Understand freshness:** See the current draft state and data
  update times. A failed refresh preserves the previous usable board with an
  explicit stale-data indication rather than presenting it as current.
- **US-SEASON-01 — Manage the team:** Support season-long decisions later.
  Retained as product direction; no season-management implementation is in
  tonight's approved scope.

### Non-goals

Automated picks or transactions; weekly lineups, waivers, and trade advice for
tonight; other platforms or sports; multi-user accounts; multi-league dashboards;
an independent projection model. Additional draft formats beyond the operator's
actual league require a later scope decision.

### One epic product success metric

Before the real draft, the operator can identify a preferred available player
within 10 seconds of consulting the assistant in each of three consecutive
rehearsed turns at picks 1, 28, and 29, using their actual league configuration
and updated draft snapshots. Rehearsal must include another manager taking a
previously recommended player. This is a proposed usability target, not a
measured result or a promise
about Sleeper's upstream publication latency.

### Preliminary source checks requested by the operator

Checked 2026-09-08; final source and import decisions remain open.

- [Sleeper API](https://docs.sleeper.com/): documented read-only access needs no
  API token and includes league settings, draft metadata, picks, and player
  identifiers. The documented surface does not specify a draft-ranking feed;
  ranking quality is a separate dependency to resolve.
- [FantasyPros API](https://www.fantasypros.com/api-data/): offers consensus
  redraft rankings, tiers, ADP, and news. Its free API tier is sample data;
  production personal keys are included with a paid HOF subscription. Proposed
  source for external player-value rankings, subject to accessible current data
  and operator agreement. A current public ranking import remains unverified.
- [FantasyPros ADP](https://www.fantasypros.com/nfl/adp/overall.php): lists Sleeper
  among its source choices. A usable machine-readable Sleeper-specific import
  has not been verified.
- [Fantasy Football Calculator API](https://help.fantasyfootballcalculator.com/article/42-adp-rest-api):
  free ADP integration is documented. Following its official PPR page's JSON
  link returned a successful 2026 response with a September 1–8 data window.
  This verifies a candidate feed; the actual 14-team half-PPR variant still
  needs verification.
  Its ADP reflects mock-draft behavior, not expert player-value rankings or
  this specific Sleeper league.
- Proposed operating approach: prepare a dated data snapshot before the draft
  and refresh draft picks during it. Final update cadence, ranking import,
  player-ID matching, and degraded behavior belong in approved architecture.

### Open questions and prerequisites

- **Q6 — Consultation interface:** Resolved by framing approval: browser shortlist.
- **Q7 — Data source choice:** Sleeper is the only existing source; alternatives
  are welcome. Recommend a verified current-season ranking input, its access
  path, and any cost. Operator approval is required before committing to a paid
  dependency. Source suggestions above remain provisional. Resolving Q7 is an
  explicit RESEARCH deliverable; it does not require choosing a provider before
  framing approval and must be settled before architecture and handoff.
- **Q8 — Framing signoff:** Resolved: operator approved on 2026-09-08.

Resolved: Q1 personal draft and season assistance; Q2 remote; Q3 league identity,
settings, draft position, and scheduled start; Q4 draft first; Q5 recommendations
only.

External prerequisite beads: **none**. The verified public league/user/draft
identifiers supply the required Sleeper input. Browser framing is approved.
Obtaining a usable current ranking snapshot and validating the
14-team half-PPR ADP feed are planned research outcomes, not assumed capabilities.

### Gate status

Full remains the selected tier. FRAMING is approved; RESEARCH is authorized.
No architecture or implementation decisions are approved. Implementation
children and execution remain downstream of the required planning gates.

## RESEARCH

Status: Complete for operator review; approval pending. Upstream authority is
the FRAMING section approved on 2026-09-08 and committed at `5a4fb23`.

Producer: the default researcher role was supplied by the isolated
`rankings_research` subagent for sources, while the orchestrator verified
Sleeper integration and assembled this section. Research bead `fantasy-p55.1`
records the source investigation, probe commands, and detailed mapping audit.
The parent reran its no-network audit and independently checked that the top
400 matches are unique existing Sleeper IDs.

### Recommended direction

Use **Sleeper as the primary data provider**: league settings, draft order,
picks, roster ownership, player identities/eligibility, platform ADP, season
projections, and historical player statistics. Public `.app` ADP/projection and
stats routes were verified on 2026-09-08 after the operator correctly challenged
the initial focus on the documented v1 surface.

Use a private, dated FantasyPros half-PPR ranking snapshot as a supplementary
expert opinion and source of tiers. FFC was investigated but is no longer part
of the recommended setup for tonight: verified Sleeper ADP has wider coverage
within the checked ranking pool and already uses canonical Sleeper IDs.
Prepare ADP/projections/ranking snapshots before the draft and refresh picks
during it. The precise recommendation formula remains an architecture decision.

Use deterministic, source-grounded reasons during a turn, with current roster
needs and the next two selections visible. No model service needs to answer
before the shortlist can appear. A small local browser app is the proposed
delivery path, subject to the operator's local-versus-hosted answer.

Treat draft sync as best effort with a visible last successful check, observed
pick count, and reversible local controls for a player already taken while the
feed catches up. These controls affect this assistant only. The exact state
reconciliation and controls are proposed for the architecture gate.

### Evidence and implications

| Finding | Verified evidence | Implication / story |
| --- | --- | --- |
| Current expert ranking input is accessible | Public [half-PPR page](https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php) returned HTML with JSON in `var ecrData`: year 2026, week 0, scoring HALF, 978 unique players, 134 experts, tiers 1–16. Provider update/check timestamp: 2026-09-08 16:12:41 UTC. | A no-login page snapshot is technically available for US-DRAFT-01/02. It is not a supported API contract; validate before replacing a usable snapshot. |
| Expert update times vary | FantasyPros describes its latest-update display as a check for revised rankings; individual expert timestamps differ. | Record source update/check and fetch times separately. Do not claim all expert opinions or injury news are current to the fetch second (US-DRAFT-03). |
| Canonical ID matching is feasible | Top 400 ECR players map uniquely to active Sleeper entries: 110 RB, 142 WR, 59 TE, 43 QB, 25 DEF, 21 K. Parent checked uniqueness. All 38 source K and 32 DEF map across the full list. | Coverage comfortably exceeds the 182-pick draft. Include kicker/defense coverage when validating US-DRAFT-02, not merely the first 200 overall ranks. |
| Full source coverage has limits | 970/978 ECR rows map; eight unresolved entries begin at rank 489. One matched entry outside the top 400 is inactive. | Quarantine unresolved/ambiguous identities and apply eligibility checks; never guess a Sleeper ID or silently present an unranked player as ranked. |
| FFC alternative is available but incomplete | The official [14-team half-PPR feed](https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?position=all&teams=14&year=2026) returned 209 unique players and a September 3–8 window, 1,837 source mocks, source length 15 rounds. All 209 map uniquely; 178 of ECR's top 200 have ADP. | Retained as researched alternative; superseded by Sleeper ADP in the recommendation below. |
| Team-specific ADP calibration is unproven | One teams=12 control returned identical numeric ADP/distribution statistics; 197 formatted round strings differed. | Report market ADP, not a claimed 14-team probability of surviving until a later pick. This may reflect source methodology; it is not established as a bug. |
| Sleeper identity and order are explicit | Current draft detail includes `draft_order[user_id]=1` and `slot_to_roster_id["1"]=5`. Draft `rounds=13`; league `draft_rounds=3` is a different field. No traded picks were returned. | Use active draft metadata and roster mapping. Verified operator picks: 1,28,29,56,57,84,85,112,113,140,141,168,169 (US-DRAFT-01/02). |
| Player eligibility needs the fantasy field | Sleeper's Travis Hunter entry has primary `position=DB` but `fantasy_positions=[DB,WR]`. The map has 32 team defenses and 12,226 entries overall. | Match and filter by fantasy eligibility, not primary position alone. `active` is not evidence of health. |
| Polling is possible; freshness is not guaranteed | Supplied-league reads all returned HTTP 200 with wildcard CORS. In pre_draft, draft/picks headers advertised `s-maxage=30`, `stale-while-revalidate=300`; current picks were empty. | A fast poll or HTTP 200 does not prove the latest pick is visible. Distinguish last check from feed freshness and offer a local correction path (US-DRAFT-03). |
| Player map should be cached | One full response was 14,651,561 bytes, 12,226 entries, received in 1.787 seconds. [Sleeper docs](https://docs.sleeper.com/) request infrequent player-map downloads, normally at most daily. | Cache and normalize at preparation time, not once per pick or render. Single-request timings are observations, not performance guarantees. |

### Sleeper ADP and statistics verification — 2026-09-08 revision

The orchestrator performed this operator-requested follow-up directly. The
initial research correctly identified Sleeper as the state/identity source but
did not examine its ADP and stats routes; source selection is revised here.
The `.com` projection route returned 403. Ordinary unauthenticated GETs to the
following `.app` routes returned HTTP 200 with valid JSON at about 16:42 UTC:

| Resource | Verified route and response | Proposed role |
| --- | --- | --- |
| 2026 season projections and ADP | [Expanded projection response](https://api.sleeper.app/projections/nfl/2026?season_type=regular): 9,419 rows, all season 2026 and all player IDs present in the cached player map. Fields include `stats.adp_half_ppr`, other scoring-format ADPs, `stats.pts_half_ppr`, raw projected stats, and per-row `updated_at`. | Primary platform ADP and projection context. |
| Compact 2026 projections | [ID-keyed response](https://api.sleeper.app/v1/projections/nfl/regular/2026): 9,419 entries and the same examined stat values, without the expanded row timestamps. | Smaller possible import representation; provenance handling must be explicit. |
| 2025 actual statistics | [Season stats response](https://api.sleeper.app/stats/nfl/2025?season_type=regular): 8,248 rows with actual passing, rushing, receiving, fantasy points, and other stats where applicable. | Historical context; distinct from 2026 projections. No season-management feature is added to tonight's scope. |

Coverage audit against the existing FantasyPros-to-Sleeper matches:

- All top 400 matched players have `adp_half_ppr` strictly between 0 and 999.
- All top 200 and 394 of the top 400 have positive `pts_half_ppr` projections.
- Across all 9,419 projection rows, 2,041 have non-sentinel positive half-PPR
  ADP. The value 999 appears on 7,378 rows; normalize it as unavailable for this
  draft rather than a precise market estimate.
- There are 1,411 rows containing `pts_half_ppr`, 1,409 positive. Presence of
  an ADP-only row does not establish a usable projection.
- Expanded-row update timestamps range from 2026-09-08 07:50:49.308 to
  07:51:08.328 UTC. Preserve these alongside the fetch time; a successful
  fetch does not make the underlying projections newly updated.
- Observed `gp` values differ in meaning or scale: offensive examples carry
  18 and a defense example carries 1. Do not derive per-game projections from
  this field without verifying semantics. Treat `pts_half_ppr` as provider
  scoring context, not proof of a total computed under every custom league rule.
- Stats, projections, ADP, and draft value are different quantities. Do not
  sort all positions by raw projected points and call it a draft recommendation.

These ADP/stat routes are **not listed in the linked official API documentation**.
Their verified availability is stronger than an assumption of absence, but does
not supply a documented stable contract. Validate fields, season, IDs, sentinels,
coverage, and timestamps on import; preserve the last usable snapshot on failure.
The web reader rejected these URLs even though direct HTTP requests succeeded;
that was a tool limitation, not endpoint unavailability.

Temporary raw evidence: /tmp/fantasy-season-projections-app.json,
/tmp/fantasy-season-projections-v1.json, and /tmp/fantasy-season-stats-app.json.
Reproduce using ordinary GETs to the three exact URLs above. Do not publish raw
source data in Git. No extra player-map download was performed.

### Access, prior art, and alternatives

The researched supplementary ranking route is one personal copy of the public page,
stored locally with attribution and provenance. Keep raw provider pages/data out
of Git and public assets; [FantasyPros terms](https://www.fantasypros.com/about/legal/)
describe a personal-copy exception and do not establish redistribution rights.
Do not assume a free CSV export merely because the page contains a CSV button.

The official [FantasyPros API page](https://www.fantasypros.com/api-data/) says
free REST keys serve sample data; personal production access comes with HOF.
No subscription is required by the recommended public-snapshot route. A separate
official [MCP tool guide](https://support.fantasypros.com/hc/en-us/articles/55238312588571-What-tools-are-available-in-the-FantasyPros-MCP-Server)
lists ECR/ADP with a free account, but its OAuth connection and data import were
not tested here. Neither paid REST nor MCP setup is a dependency for tonight.

FantasyPros' [Draft Assistant](https://draftwizard.fantasypros.com/football/draft-assistant/)
is relevant prior art: league context, taken-player tracking, and expert
recommendations form the established workflow. It is an alternative product,
not an integration assumed by this plan. [ECR methodology](https://support.fantasypros.com/hc/en-us/articles/115001219327-What-is-ECR-Expert-Consensus-Rankings-and-how-do-you-calculate-it)
aggregates expert judgments; ECR rank is ordinal evidence, not a projected-points
difference. FFC says its ADP comes from mocks, and its own ranking page derives
rankings from that ADP; that page is not an independent expert-value source.

### Integration constraints and failure cases

- Store Sleeper league/user/draft IDs as strings. Normalize roster/slot keys
  deliberately rather than relying on number coercion.
- Identity matching should normalize punctuation, diacritics, and suffixes,
  then use fantasy position and team to disambiguate. Map DEF by team and
  normalize PK/K, DST/DEF, and team aliases. No fuzzy automatic join.
- Two reviewed aliases are needed within ECR's top 400: FantasyPros 18226
  (Hollywood Brown) to Sleeper 5848 (Marquise Brown), and FantasyPros 24901
  (Bam Knight) to Sleeper 8122 (Zonovan Knight). Source page filenames and
  Sleeper name/team/position corroborate them. Retain original IDs/names.
- Use ECR/tier, roster requirements, and remaining picks for explainable
  recommendations, supplemented by Sleeper ADP and projection context. ADP can
  inform a reach or value observation; it does not
  justify survival percentages. Injury status/news age must be visible where
  relevant, with no claim that a null injury field means fully healthy.
- Poll picks on a bounded cadence; five seconds is a candidate, not a locked
  setting. Stop overlapping requests and back off on errors. Polling faster
  does not eliminate upstream caching. Rank input can remain usable offline.
- Rebuild availability from full pick snapshots, incorporating local pending
  corrections without issuing Sleeper mutations. Commissioner undo, reconnect,
  stale responses, and a previously selected candidate taken by another team
  require explicit reconciliation rules in ARCHITECTURE.
- Current live evidence covers pre_draft and an empty pick list only. Synthetic
  fixtures must cover draft progression, rollback, errors, and reconnect.
  Automatic approval review rejected a historical-league/invalid-ID probe as
  outside the supplied league scope; it did not run and was not retried.
- No schema change or shared Supabase dependency is indicated for tonight's
  single-user snapshot and draft-state needs. Storage/deployment are proposed
  choices, not locked architecture.

### Reproducible research checks

Source retrieval used ordinary unauthenticated GETs. Future workers can repeat:

```sh
curl --fail --silent --show-error --location --max-time 30 --output /tmp/fantasypros-half-ppr.html https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php
curl --fail --silent --show-error --location --max-time 30 --output /tmp/ffc-half-ppr-14.json 'https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?position=all&teams=14&year=2026'
curl --fail --silent --show-error --dump-header /tmp/draft-headers.txt --output /tmp/draft.json https://api.sleeper.app/v1/draft/1389330057733865473
curl --fail --silent --show-error --dump-header /tmp/pick-headers.txt --output /tmp/picks.json https://api.sleeper.app/v1/draft/1389330057733865473/picks
```

Parse the JSON value after the `var ecrData = ` marker as JSON, never evaluate
page JavaScript. Assert year/scoring/week, unique IDs, finite ranks, coverage,
and source metadata. Join against a cached Sleeper player map using the rules
above and report unmatched rows. Inspect headers separately from body timing.

Temporary evidence at /tmp/fantasy-rankings-source-summary.json and
/tmp/fantasy-rankings-source-probe.py was independently reviewed and rerun.
Those files are conveniences, not a durable dependency: the URLs, input schemas,
matching rules, counts, and caveats in this record and research bead are the
reproducible contract. Raw datasets were not committed.

### Provisional module fingerprints

All paths below are **provisional new files**, not existing symbols. The
repository currently contains only tracker/corpus/planning files, as verified
with `rg --files --hidden -g '!.git/**'`. Local runtime checks returned Node
v24.13.1 and npm 11.9.0. Node offers built-in
[HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html) and
[test](https://nodejs.org/docs/latest-v24.x/api/test.html) modules. Plain ESM and
a small browser client are a viable low-dependency candidate; framework and
module boundaries will be locked at ARCHITECTURE.

| Candidate area | Provisional write footprint | Evidence/seam and story | Confidence |
| --- | --- | --- | --- |
| Source preparation and identity | scripts/prepare-data.mjs; src/data/sources.mjs; src/data/identity.mjs; src/data/snapshot.mjs; tests/unit/sources.test.mjs; tests/unit/identity.test.mjs; tests/integration/source-import.test.mjs; .gitignore | Sleeper ADP/projection/stat JSON, supplementary ECR HTML, sentinel/coverage checks, 400-player join, private atomic snapshot; US-DRAFT-01/03 | High need; medium boundaries |
| Sleeper adapter and draft state | src/sleeper/client.mjs; src/draft/state.mjs; tests/unit/draft-state.test.mjs; tests/integration/draft-sync.test.mjs | ID/order/round differences, full pick snapshots, stale/manual reconciliation; US-DRAFT-02/03 | High |
| Recommendation rules | src/draft/recommend.mjs; src/draft/roster.mjs; tests/unit/recommend.test.mjs | Ranked available candidates, nullable ADP, positional fit and 1/28/29 turns; US-DRAFT-01/02 | High need; scoring approach provisional |
| Browser and serving | src/server.mjs; web/index.html; web/app.mjs; web/styles.css; tests/integration/app.test.mjs | Approved browser workflow and deployment answer; real HTTP/client composition; all draft stories | Medium |
| Shared setup and fixture contracts | package.json; src/contracts.mjs; tests/fixtures/sleeper.mjs; tests/fixtures/rankings.mjs; README.md | No existing application surface; common snapshot/board contracts and startup command | High need; medium paths |

### Provisional bundle groups

Candidate group **draft-core**: source preparation, draft state, recommendation
rules, and initial server wiring are likely to share src/contracts.mjs,
package.json, and synthetic fixtures. If those write overlaps survive
architecture, one lane and one PR for the small core avoids repeated contract
edits and merge sequencing. This is a candidate grouping, not a dispatch claim.

Candidate group **draft-ui**: web/app.mjs, web/index.html, styles, and the browser
integration test likely change together. It can be a separate lane only after
the board contract/server routes are stable and its write footprint excludes
core files; otherwise merge it into draft-core. ARCHITECTURE and DECOMPOSITION
must re-derive every path and discard stale groups.

### Operator decisions and gate

- **Q7:** Approve Sleeper as the primary provider for state, identity, ADP,
  projections, and historical stats, with a private FantasyPros half-PPR
  snapshot as supplementary expert rankings and tiers? FFC is removed from the
  proposed nightly setup; no paid API dependency is proposed.
- **Q9:** Local browser on this computer, or a hosted link for another device?
  Local delivery is recommended for tonight; the operator's answer is pending.
- **Q10:** Approve reversible local drafted-player corrections as the fallback
  for observed feed lag? They do not submit picks to Sleeper.
- **Q11:** Approve these research findings and constraints before ARCHITECTURE?

No new application code was written. Research verifies source feasibility, not
the completed application's performance or a live-draft freshness guarantee.
