/**
 * Cabin-weekend attribution's own matching and staleness rules.
 *
 * `resolveCabinAlias` mirrors `pocketbase/sync/lodging_alias_resolver.go`'s
 * `aliasLookupKey` exactly: trim + lowercase, then a table lookup. Naive
 * string equality is measurably wrong here — it drops two of the eight
 * currently-open households from "matches a known unit" to "not recognized",
 * because their raw CampMinder value carries an area prefix the alias table
 * strips ("Golden Triangle - Cloud's Rest" vs "Clouds Rest").
 */
import { describe, expect, it } from 'vitest'

import type {
  LodgingAliasRecord,
  LodgingIngestIssueRecord,
  LodgingUnitRecord,
} from '../../types/lodging'
import { computeStaleQueueIds, resolveCabinAlias } from './sessionAttributionMatch'

function unit(id: string, name: string): LodgingUnitRecord {
  return { id, name } as LodgingUnitRecord
}

function alias(aliasString: string, members: LodgingUnitRecord[]): LodgingAliasRecord {
  return {
    id: `alias_${aliasString}`,
    alias_string: aliasString,
    member_units: members.map((m) => m.id),
    expand: { member_units: members },
  } as LodgingAliasRecord
}

describe('resolveCabinAlias', () => {
  it('resolves an exact (trim + lowercase) alias_string match to its member unit names', () => {
    const aliases = [alias('Ridge I', [unit('u1', 'Ridge I')])]
    expect(resolveCabinAlias('Ridge I', aliases)).toEqual(['Ridge I'])
  })

  it('is case- and whitespace-insensitive, mirroring aliasLookupKey', () => {
    const aliases = [alias('ridge i', [unit('u1', 'Ridge I')])]
    expect(resolveCabinAlias('  Ridge I  ', aliases)).toEqual(['Ridge I'])
  })

  // The measured case naive string equality gets wrong: the alias string is
  // an area-prefixed CampMinder value, unrelated by literal comparison to the
  // real unit name it maps to.
  it('resolves an alias-only match a naive string comparison would miss', () => {
    const aliases = [alias("Golden Triangle - Cloud's Rest", [unit('u9', 'Clouds Rest')])]
    expect(resolveCabinAlias("Golden Triangle - Cloud's Rest", aliases)).toEqual(['Clouds Rest'])
    // The naive check this guards against:
    expect("Golden Triangle - Cloud's Rest".trim().toLowerCase()).not.toBe(
      'clouds rest'.trim().toLowerCase()
    )
  })

  it('returns every member for a merge alias, in member order', () => {
    const aliases = [
      alias('Golden Triangle - Tioga 1and2', [unit('u1', 'Tioga 1'), unit('u2', 'Tioga 2')]),
    ]
    expect(resolveCabinAlias('Golden Triangle - Tioga 1and2', aliases)).toEqual([
      'Tioga 1',
      'Tioga 2',
    ])
  })

  it('returns an empty array for a raw value with no alias row', () => {
    expect(resolveCabinAlias('Not A Real Cabin', [])).toEqual([])
  })
})

function issue(id: string, lastSeen: string): LodgingIngestIssueRecord {
  return { id, last_seen: lastSeen } as LodgingIngestIssueRecord
}

describe('computeStaleQueueIds', () => {
  it('returns an empty set for an empty queue', () => {
    expect(computeStaleQueueIds([])).toEqual(new Set())
  })

  it('flags nothing when there is only one row', () => {
    expect(computeStaleQueueIds([issue('q1', '2026-08-18 00:00:00.000Z')])).toEqual(new Set())
  })

  // The proxy for "the most recent CampMinder sync": a row not touched by
  // whichever sync run touched the freshest row in this batch. This is what
  // catches BOTH real cases in production — a household re-keyed to a new
  // cabin string (a newer sibling row exists) and a household CampMinder no
  // longer shows a cabin for at all (no sibling, but every OTHER open row is
  // fresher).
  it('flags every row strictly older than the freshest last_seen in the batch', () => {
    const rows = [
      issue('q9', '2026-08-18 00:00:00.000Z'), // superseded by a same-household re-key
      issue('q6', '2026-08-23 00:00:00.000Z'), // the current sync's freshest row
      issue('q10', '2026-08-20 00:00:00.000Z'), // CampMinder no longer shows a cabin
    ]
    expect(computeStaleQueueIds(rows)).toEqual(new Set(['q9', 'q10']))
  })

  it('does not flag ties at the freshest last_seen', () => {
    const rows = [issue('q1', '2026-08-23 00:00:00.000Z'), issue('q2', '2026-08-23 00:00:00.000Z')]
    expect(computeStaleQueueIds(rows)).toEqual(new Set())
  })

  // last_seen is `required: false` on lodging_ingest_issues (migration
  // 1500000122) -- PocketBase's zero value for an unset date field is ''.
  // An empty string sorts BELOW every real timestamp lexicographically, so
  // without a guard a row with no last_seen at all would be silently
  // misclassified as stale (dropped from the board chip AND hidden behind
  // the admin toggle) rather than surfaced as unknown -- and if EVERY row's
  // last_seen were empty, maxLastSeen would stay '' and nothing would ever
  // flag. Treated as "cannot judge freshness", not "definitely stale":
  // hiding a row nobody can vouch for is worse than showing an unflagged one.
  it('does not flag a row with no last_seen at all as stale', () => {
    const rows = [issue('q1', '2026-08-23 00:00:00.000Z'), issue('q2', '')]
    expect(computeStaleQueueIds(rows)).toEqual(new Set())
  })

  it('flags nothing when every row in the batch has no last_seen', () => {
    const rows = [issue('q1', ''), issue('q2', '')]
    expect(computeStaleQueueIds(rows)).toEqual(new Set())
  })
})
