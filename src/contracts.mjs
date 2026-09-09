/** Shared record vocabulary only. Each owning reader validates its inputs. */
export const SNAPSHOT_VERSION = 1;
export const STATE_VERSION = 1;
export const BOARD_VERSION = 1;
export const POLICY_VERSION = 'draft-v1';
export const POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * @typedef {Object} SourceMetadata
 * @property {string} url
 * @property {string|null} season
 * @property {string|null} scoring Provider scoring label, never custom-league points.
 * @property {string|null} fetchedAt Original successful retrieval time, including cache reuse.
 * @property {number|string|null} updatedAt Provider update time, distinct from retrieval.
 * @property {'ok'|'unavailable'|'disabled'} status
 * @property {string} [reason]
 */
/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {string|null} team
 * @property {string|null} position Sleeper primary position.
 * @property {string[]} fantasyPositions All provider eligibility, including unsupported positions.
 * @property {string|null} policyPosition Eligible primary, else first supported in policy order.
 * @property {boolean} active
 * @property {boolean} eligibleBase Active, current NFL team, supported fantasy eligibility.
 * @property {boolean} eligible eligibleBase and a usable ADP or ECR rank.
 * @property {number|null} adp
 * @property {number|null} adpBand Fixed zero-based group of 12 ordinal eligible ADP places.
 * @property {number|null} ecrRank
 * @property {number|null} ecrTier
 * @property {string|null} ecrSourceId
 * @property {number|null} projectionPoints Provider half-PPR season context only.
 * @property {number|null} historyPoints Provider half-PPR prior-season context only.
 * @property {string|null} injuryStatus
 * @property {string|null} injuryBodyPart
 * @property {string|null} injuryNotes
 * @property {Object<string,number|string|null>} sourceUpdatedAt
 */
/**
 * @typedef {Object} Config
 * @property {string} leagueId
 * @property {string} draftId
 * @property {string} userId
 * @property {string} rosterId
 * @property {string} season
 * @property {string} sport
 * @property {string} type
 * @property {number} teams
 * @property {number} rounds
 * @property {number} reversalRound
 * @property {number} reserveSlots
 * @property {string[]} rosterPositions
 * @property {Object<string,number>} scoring
 * @property {Object<string,number>} draftOrder
 * @property {Object<string,string>} slotToRosterId
 * @property {Object} keepers
 * @property {Object[]} tradedPicks
 * @property {number} ownSlot
 * @property {number[]} ownPicks
 * @property {string} leagueName
 * @property {string} username
 */
/**
 * @typedef {Object} Snapshot
 * @property {1} schemaVersion
 * @property {string} snapshotId
 * @property {string} preparedAt
 * @property {Config} config
 * @property {string} configFingerprint
 * @property {Object<string,SourceMetadata>} sources
 * @property {Object<string,Player>} playersById
 * @property {'ecr'|'adp-only'} rankingMode
 * @property {Object} importReport Coverage, fallback reasons and quarantined source identities.
 */
/**
 * @typedef {Object} Pick
 * @property {number} pickNo
 * @property {number} round
 * @property {number} draftSlot
 * @property {string} playerId Unknown opponent IDs are retained.
 * @property {string} rosterId Official roster_id is authoritative; otherwise verified slot mapping.
 * @property {string} pickedBy May be empty; never used to infer ownership.
 */
/**
 * @typedef {Object} DraftSnapshot
 * @property {string} draftId
 * @property {string} configFingerprint
 * @property {string} status
 * @property {string} fetchedAt
 * @property {Pick[]} picks Empty means known-empty availability, not unknown.
 */
/**
 * @typedef {Object} Correction
 * @property {string} id
 * @property {'taken'|'my-pick'} type
 * @property {string} playerId
 * @property {number} [pickNo]
 */
/**
 * @typedef {Object} DraftState
 * @property {1} schemaVersion
 * @property {string} configFingerprint
 * @property {number} revision Durable action token.
 * @property {DraftSnapshot|null} accepted Null until validated or restored acceptance.
 * @property {Object|null} pending Unaccepted non-extension with diff and pending revision.
 * @property {Correction[]} corrections
 * @property {Object} freshness Last check, last change and connection/error information.
 * @property {Config} config Read-only prepared context; persistence owns its serialization boundary.
 * @property {Object<string,Player>} playersById Read-only prepared identity context.
 * @property {number} nextCorrectionId Monotonic counter for deterministic local IDs.
 * @property {number} pendingRevision Monotonic counter, retained after pending adoption/clear.
 * @property {number} lastRequestSequence Latest applied request, including metadata-only results.
 * @property {boolean} requiresPreparation Sticky configuration mismatch until preparation/reinitialization.
 * @property {DraftNotice[]} notices Confirmations/conflicts and reviewed correction clearing.
 */
/**
 * @typedef {Object} DraftIncoming
 * @property {number} requestSequence Monotonic request number from the caller.
 * @property {number} expectedRevision Domain revision captured when the request started.
 * @property {string} checkedAt Caller-supplied attempt completion time; domain never reads a clock.
 * @property {DraftSnapshot} [snapshot] Validated by the owning Sleeper client, never partial picks.
 * @property {string|Error} [error] A failed attempt instead of a validated snapshot.
 * @property {boolean} [requiresPreparation] Caller-classified configuration rejection on a failed fetch.
 */
/**
 * @typedef {Object} DraftNotice
 * @property {string} code confirmed, official-player-conflict, official-slot-conflict or pending-adopted.
 * @property {string} message Specific player/slot/ownership explanation.
 * @property {string} [correctionId]
 * @property {string[]} [clearedCorrectionIds]
 */
/**
 * @typedef {Object} EffectiveDraft
 * @property {number} revision
 * @property {string} configFingerprint
 * @property {boolean} availabilityKnown False only before an accepted validated/saved snapshot.
 * @property {boolean} personalizationAvailable Known availability, resolved own identity/configuration.
 * @property {string|null} unavailableReason
 * @property {number} officialCount Never includes local corrections or fabricated opponents.
 * @property {Object[]} ownPicks Canonical own picks with official/local source and optional correctionId.
 * @property {string[]} ownPlayerIds Ordered by own pick number.
 * @property {string[]} unknownOwnPlayerIds
 * @property {string[]} unavailableIds Official and local exclusions, including unknown opponent IDs.
 * @property {number[]} remainingPicks Ordered unfilled selections from the prepared snake schedule.
 * @property {number} remainingSelections
 * @property {number[]} nextPicks At most two.
 * @property {Correction[]} corrections
 * @property {DraftNotice[]} notices
 * @property {Object} freshness
 */
/**
 * @typedef {Object} RosterAssignment
 * @property {{slotIndex:number,position:string,playerId:string|null}[]} starters Actual slot order.
 * @property {Object[]} missingSlots
 * @property {number} filledCount Maximum matching cardinality.
 * @property {number} offensiveFilled
 * @property {number} offensiveMissing
 * @property {string[]} bench
 * @property {string[]} overflow Players beyond starter/bench capacity; reserve is excluded.
 * @property {number} benchCapacity
 * @property {number} draftCapacity
 * @property {Object<string,number>} policyCounts Each identity counted once in its canonical position.
 */
/**
 * @typedef {Object} Recommendation
 * @property {string} playerId
 * @property {string} name
 * @property {string} policyPosition
 * @property {string[]} fantasyPositions
 * @property {number|null} ecrRank
 * @property {number|null} ecrTier
 * @property {string|null} ecrSourceId
 * @property {number|null} adp
 * @property {number|null} adpBand Fixed prepared zero-based ordinal band.
 * @property {boolean} fillsStarter Increases maximum starter matching.
 * @property {'ordinary'|'backup'|'early-specialist'} deferral Outermost ranking group.
 * @property {string[]} reasons Exact source values, roster fit and applicable deferral.
 */
/**
 * @typedef {Object} RecommendationResult
 * @property {'ready'|'unavailable'|'complete'} status
 * @property {string|null} reason
 * @property {'ecr'|'adp-only'} rankingMode
 * @property {Object[]} ownRoster Known Player records or explicitly unknown identities.
 * @property {number[]} nextPicks
 * @property {(Player & {available:boolean|null})[]} players Browsing retained even without advice.
 * @property {Recommendation[]} candidates At most three distinct feasible candidates.
 */
/**
 * @typedef {Object} BoardView
 * @property {1} schemaVersion
 * @property {number} revision Durable domain token used by action expectedRevision.
 * @property {string} sessionId New on every openSession; never a durable action revision.
 * @property {number} viewRevision Advances on every observable update, including metadata only.
 * @property {'ecr'|'adp-only'} rankingMode
 * @property {Object} league
 * @property {Object} draft
 * @property {Object[]} ownRoster
 * @property {number[]} nextPicks
 * @property {Object[]} candidates At most three distinct feasible players with reasons.
 * @property {Player[]} players Searchable identities.
 * @property {Correction[]} corrections
 * @property {Object|null} pending
 * @property {Object} freshness Source times, successful checks, changed picks and connection state.
 */
