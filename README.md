```doc-meta
role: working
lifecycle: active
```

# Local Sleeper draft assistant

Private, GET-only preparation for the supplied 2026 Sleeper league. The source
pipeline is implemented. The local server, recommendation engine and human
rehearsal are subsequent implementation beads; `npm start` and `npm run rehearse`
reserve their command names but are not runnable yet. The accepted scope and
ownership contract live in [ADR 0001](docs/adr/0001-local-draft-assistant.md).

## Setup and verification

Use Node **24.13.1 or newer**. Production uses built-in Node modules only.
Playwright **1.63.0** is a pinned development dependency.

```sh
npm ci --ignore-scripts
PLAYWRIGHT_BROWSERS_PATH=.local/browsers npx playwright install chromium
npm test
```

`--ignore-scripts` matters: npm recognizes the requested `prepare` command as
an installation lifecycle hook. Preparation should be an explicit action.
Chromium is installed inside this checkout's ignored private directory. Use
`PLAYWRIGHT_BROWSERS_PATH=.local/browsers` when launching later browser tests.
No global installation or system dependency change is needed for this checkout.

Tests use fictional players, real temporary files and a loopback HTTP server on
an OS-assigned port. They never call live providers. `npm test` runs all unit and
integration files serially with Node's test runner. Its total budget is 30
seconds. In a sandbox that restricts child processes or loopback listeners,
run the same command with the normal execution permission escalation. A matching
Chromium launch/DOM/close smoke is separate from application browser coverage.

## Prepare private data

```sh
npm run prepare
npm run prepare -- --without-ecr
npm run prepare -- --league 1389330057733865472 --user 1264288993504149504 --data-dir .local
```

Defaults are league `1389330057733865472` and user `1264288993504149504`.
Preparation derives the active draft, season, roster, slot and scoring from
Sleeper. It requires the approved NFL 14-team, 13-round snake shape, one reserve,
ordered QB/RB/RB/WR/WR/TE/FLEX/K/DEF/four-bench slots, half-PPR and four-point
passing touchdowns, complete owner/slot mappings, no reversal, assigned keepers
or traded picks. The confirmed default league/user also require roster 5 and
draft slot 1; coherent reassignment is rejected explicitly. Changes to other scoring entries are retained in the
configuration fingerprint. Draft rounds are authoritative; league
`draft_rounds` does not determine the schedule.

A previously downloaded player map can seed the cache. Both options are required;
use its original retrieval time, never a newer time invented for cache reuse:

```sh
npm run prepare -- --players-file /path/to/private/players.json --players-fetched-at 2026-09-08T16:28:00Z
```

A player cache younger than 24 hours avoids another player download; exactly
24 hours expires it. No runtime code depends on research files or `/tmp` paths.
An explicit stale player import triggers a fresh player GET. Default data stays
inside `.local/`; keep an overridden `--data-dir` private and outside tracked
assets as well. Source URL overrides exist only on the in-process test API.

## Source and persistence contract

[Documented Sleeper v1 routes](https://docs.sleeper.com/) provide league, user,
roster, draft, player and pick identities. Expanded projections use
`https://api.sleeper.app/projections/nfl/<season>?season_type=regular`;
optional prior-year actual stats use
`https://api.sleeper.app/stats/nfl/<year>?season_type=regular`. These expanded
routes are undocumented and validated on every import.

The optional [FantasyPros half-PPR page](https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php)
provides independent ranks and nullable tiers. The importer extracts `var ecrData` as JSON without executing JavaScript. Exact normalized names,
eligibility and team identifiers determine joins; the only reviewed nickname
aliases are FP18226 to Sleeper5848 and FP24901 to Sleeper8122. `FA` and null
both mean no current team; this identity normalization never grants candidate
eligibility. Any ambiguous or unresolved rank through 400 rejects the whole
optional import. Lower unresolved ranks are quarantined. Duplicate source IDs,
ranks or canonical joins also reject ECR. Failure or `--without-ecr` selects
explicit `adp-only` mode with no leftover ECR ranks.

Candidates require active status, a current NFL team, supported fantasy
eligibility and a usable ADP or ECR rank. All other identities remain available
for interpreting picks. `policyPosition` is an eligible supported primary
position, otherwise the first supported position in QB/RB/WR/TE/K/DEF order.
ADP-only groups are fixed, zero-based bands of 12 eligible ordinal places, sorted
by exact ADP then string ID. ECR never changes the policy position.

Missing, nonfinite, nonpositive and sentinel-999 ADP become null. Missing points
remain null; numeric zero stays zero. Half-PPR projection/history totals are
provider context, not exact custom-league scores or cross-position draft values.
No per-game value is derived from `gp`, and injury text remains source context.
Every source retains URL, season, scoring and original fetch time. Player rows
retain nullable source update times separately.

At least 400 eligible usable-ADP identities are required, with minima of 14 QB,
42 RB, 42 WR, 14 TE, 14 K and 14 DEF. A required HTTP, schema, context or coverage
failure leaves the previous `.local/snapshot.json` byte-for-byte intact.
Optional history failure preserves current ADP/projections. Private raw inputs
and player-cache metadata live in `.local/sources/`. Snapshot publication uses
an exclusive same-directory temporary file, file sync and atomic rename;
readers see a complete old or complete new JSON document. Invalid saved snapshots
are rejected without being rewritten.

No provider snapshots, credentials or runtime state belong in Git. No automated
Sleeper picks/transactions, public data redistribution, paid dependency or
season-management scope is included.

## Interfaces for subsequent implementation

- `runPrepare(argv, options)` in `scripts/prepare-data.mjs` parses the real CLI;
  `prepareData(options)` returns the newly persisted version-1 Snapshot.
- `loadContext({leagueId, userId, sourceUrls})` returns Config;
  `fetchDraftSnapshot(config, {sourceUrls, now, timeoutMs})` validates a complete
  official draft/picks response. Default request deadlines are four seconds;
  preparation allows 30 seconds per source. HTTP errors carry `status` and raw
  `retryAfter` for the session owner's retry policy.
- `loadSnapshot(path, {leagueId, draftId, userId, configFingerprint})` optionally
  checks expected identity. `writeJsonAtomic(path, value)` is the shared writer.
- `src/contracts.mjs` defines the shared record vocabulary and versions.
  `DraftState.accepted = null` means unknown; accepted `picks = []` means known
  empty. Durable `revision` is the action token. `sessionId` and `viewRevision`
  describe observable presentation updates and do not replace that token.

Human ten-second draft-choice timing remains unmeasured. Source tests and browser
setup verification do not establish that product outcome.
