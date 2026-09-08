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

Status: Ready for framing review; formal approval is pending. The operator
supplied the product direction, deadline, identity, and recommendation boundary.
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

### Narrowest valuable release — proposal

A personal draft assistant that loads the actual league rules and draft state,
then presents three available pick candidates with short, source-grounded
reasons reflecting player value and the operator's drafted roster. Picked
players disappear as the draft updates. The operator can see when data was
last refreshed and retain the last usable board if a refresh fails. Show the
operator's next two picks and account for consecutive selections at the turn.

Proposed presentation: a browser page kept beside Sleeper, showing the shortlist
without requiring a new question each turn. Approving this frame will select
that presentation; the operator can revise it before approval.

### User stories and proposed acceptance scenarios

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
  tonight's proposed scope.

### Proposed non-goals

Automated picks or transactions; weekly lineups, waivers, and trade advice for
tonight; other platforms or sports; multi-user accounts; multi-league dashboards;
an independent projection model. Additional draft formats beyond the operator's
actual league require a later scope decision.

### One epic product success metric — proposal

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

- **Q6 — Consultation interface:** A browser shortlist is proposed. Confirm
  it or request a different interface as part of Q8's framing review.
- **Q7 — Data source choice:** Sleeper is the only existing source; alternatives
  are welcome. Recommend a verified current-season ranking input, its access
  path, and any cost. Operator approval is required before committing to a paid
  dependency. Source suggestions above remain provisional. Resolving Q7 is an
  explicit RESEARCH deliverable; it does not require choosing a provider before
  framing approval and must be settled before architecture and handoff.
- **Q8 — Framing signoff:** Approve or revise the proposed stories, non-goals,
  first release, and success metric after the remaining framing choices.

Resolved: Q1 personal draft and season assistance; Q2 remote; Q3 league identity,
settings, draft position, and scheduled start; Q4 draft first; Q5 recommendations
only.

External prerequisite beads: **none**. The verified public league/user/draft
identifiers supply the required Sleeper input. Approval of the browser framing
is pending. Obtaining a usable current ranking snapshot and validating the
14-team half-PPR ADP feed are planned research outcomes, not assumed capabilities.

### Gate status

Full remains the selected tier. This framing proposal is ready for a single
FRAMING signoff covering the browser presentation, stories, non-goals, and
success metric. Obtain operator signoff before advancing to formal RESEARCH.
No architecture or implementation decisions are approved. Implementation
children and execution remain downstream of the required planning gates.
