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

Status: In progress; formal framing approval is pending. The operator supplied
the product direction, draft deadline, and recommendation-only boundary.
Targeted source checks below answer the operator's documentation and source
requests; they do not constitute approval or completion of the RESEARCH stage.

### Confirmed intent and constraints

- Personal fantasy football assistant for the operator, using Sleeper.
- League format: redraft. Team count, scoring, roster slots, draft type, and
  draft position have not been supplied or verified. Redraft does not establish
  whether the draft is snake or auction.
- Prioritize draft assistance and fast consultation during the draft.
- The operator reported the draft is tonight, approximately nine hours away,
  on 2026-09-08. Exact start time must be confirmed from the league or operator.
- Recommendations only. The operator makes picks in Sleeper.
- Season management remains a later product goal, outside tonight's release.
- Sleeper is the operator's only current source. They are open to other
  recommendations. No third-party subscription or purchase is authorized.
- Repository has no application code or test suite. Planning is published to
  origin/master at git@github.com:DylanDelliColli/fantasy-assistant.git; pushes
  use the existing github-personal SSH host.

### Narrowest valuable release — proposal

A personal draft assistant that loads the actual league rules and draft state,
then presents three available pick candidates with short, source-grounded
reasons reflecting player value and the operator's drafted roster. Picked
players disappear as the draft updates. The operator can see when data was
last refreshed and retain the last usable board if a refresh fails.

Proposed presentation: a browser page kept beside Sleeper, showing the shortlist
without requiring a new question each turn. Browser, chat, and terminal
preferences have been asked; the operator has not selected one.

### User stories and proposed acceptance scenarios

- **US-DRAFT-01 — Prepare:** Review a league-specific draft plan before the
  draft. Given the actual scoring, roster requirements, and draft position,
  show a concise strategy and identify the data supporting it; do not silently
  substitute assumed league settings.
- **US-DRAFT-02 — Consult during the draft:** See three available candidates,
  or all eligible candidates if fewer remain, with concise reasons. After
  another team drafts a candidate and that pick is observed, remove that
  player from the shortlist and incorporate the operator's own completed picks.
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
rehearsed turns, using their actual league configuration and an updated draft
snapshot. Rehearsal must include another manager taking a previously recommended
player. This is a proposed usability target, not a measured result or a promise
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
  This verifies a candidate feed, not suitability for the unknown league.
  Its ADP reflects mock-draft behavior, not expert player-value rankings or
  this specific Sleeper league.
- Proposed operating approach: prepare a dated data snapshot before the draft
  and refresh draft picks during it. Final update cadence, ranking import,
  player-ID matching, and degraded behavior belong in approved architecture.

### Open questions and prerequisites

- **Q3 — League identity and timing:** Redraft and tonight are confirmed.
  League/draft ID or URL, Sleeper username/team, and exact start time remain
  needed. Retrieve scoring, roster slots, draft format, and position from the
  supplied league when possible.
- **Q6 — Consultation interface:** Browser shortlist, chat, or terminal?
  Browser shortlist is proposed and remains unapproved.
- **Q7 — Data source choice:** Sleeper is the only existing source; alternatives
  are welcome. Recommend a verified current-season ranking input, its access
  path, and any cost. Operator approval is required before committing to a paid
  dependency. Source suggestions above remain provisional.
- **Q8 — Framing signoff:** Approve or revise the proposed stories, non-goals,
  first release, and success metric after the remaining framing choices.

Resolved: Q1 personal draft and season assistance; Q2 remote; Q4 draft first;
Q5 recommendations only.

Prerequisite state: no open external prerequisite bead has been identified.
League identity, interface choice, and a usable source are unresolved inputs;
do not interpret this as confirmation that prerequisites are absent.

### Gate status

Full remains the selected tier. Confirm the remaining framing inputs, commit the
reviewable frame, and obtain operator signoff before advancing to formal
RESEARCH. No architecture or implementation decisions are approved. Implementation
children and execution remain downstream of the required planning gates.
