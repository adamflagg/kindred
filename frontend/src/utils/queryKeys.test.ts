/**
 * Contract tests for `queryKeys.ts` factories.
 *
 * - Pins the `originalBunkRequestsByRequesterCmId` factory shape. A sibling
 *   `originalBunkRequestsByPersonId` factory previously existed for a
 *   `person_id =` filter that doesn't exist on `original_bunk_requests`; PR
 *   #1338 removed the only caller and the audit (#1339) removed the dead
 *   factory itself.
 * - Pins the `year` argument on `camperHistory` so filtering by year does
 *   not reuse a cache slot keyed only by personId.
 */

import { describe, it, expect } from 'vitest'
import { invalidateLodgingRegistryQueries, queryKeys } from './queryKeys'

describe('queryKeys.originalBunkRequestsByRequesterCmId', () => {
  it('key includes a requester-cm-id discriminator', () => {
    const key = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    expect(key[0]).toBe('original-bunk-requests-by-requester-cm-id')
    expect(key).toContain(12345)
    expect(key).toContain(2025)
  })

  it('handles undefined ids without colliding with the populated case', () => {
    const populated = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    const empty = queryKeys.originalBunkRequestsByRequesterCmId(undefined, 2025)
    expect(populated).not.toEqual(empty)
  })
})

describe('queryKeys.camperHistory', () => {
  it('includes year in the key so per-year filters do not collide', () => {
    const a = queryKeys.camperHistory('p-1', 2024)
    const b = queryKeys.camperHistory('p-1', 2025)
    expect(a).not.toEqual(b)
  })

  it('key contains both personId and year', () => {
    const key = queryKeys.camperHistory('p-1', 2025)
    expect(key).toContain('p-1')
    expect(key).toContain(2025)
  })
})

describe('queryKeys.camperSiblingsPanel', () => {
  it('accepts a number householdId and produces a key with it', () => {
    const key = queryKeys.camperSiblingsPanel(42, 'p-1', 2025)
    expect(key).toContain(42)
    expect(key).toContain('p-1')
    expect(key).toContain(2025)
  })

  it('accepts undefined householdId without throwing', () => {
    expect(() => queryKeys.camperSiblingsPanel(undefined, 'p-1', 2025)).not.toThrow()
  })
})

describe('queryKeys.solverRuns / solverRunsPrefix', () => {
  it('exposes both factories on the queryKeys object (centralization rule)', () => {
    expect(typeof queryKeys.solverRunsPrefix).toBe('function')
    expect(typeof queryKeys.solverRuns).toBe('function')
  })

  it('solverRuns key starts with the same prefix as solverRunsPrefix', () => {
    const prefix = queryKeys.solverRunsPrefix()
    const key = queryKeys.solverRuns({ hideFailed: true })
    expect(key.slice(0, prefix.length)).toEqual(prefix)
  })

  it('different filters produce different keys', () => {
    const a = queryKeys.solverRuns({ hideFailed: true })
    const b = queryKeys.solverRuns({ hideFailed: false })
    expect(a).not.toEqual(b)
  })
})

describe('queryKeys.scenariosList', () => {
  it('exposes the factory on the queryKeys object', () => {
    expect(typeof queryKeys.scenariosList).toBe('function')
  })

  it('includes year so year switches do not collide', () => {
    const a = queryKeys.scenariosList(2025)
    const b = queryKeys.scenariosList(2026)
    expect(a).not.toEqual(b)
  })
})

describe('queryKeys.allSessionsList', () => {
  it('includes year so year switches do not collide', () => {
    const a = queryKeys.allSessionsList(2025)
    const b = queryKeys.allSessionsList(2026)
    expect(a).not.toEqual(b)
  })
})

describe('queryKeys.postCheck', () => {
  // CampMinder reuses session ids across years (year-data-integrity invariant),
  // so a key of [post-check, sessionCmId, scenarioId] collides across seasons
  // and can serve stale prior-year validator data. Mirror the year-scoped
  // satisfaction key: [post-check, sessionCmId, year, scenarioId].
  it('includes year so a season switch does not reuse a prior-year cache slot', () => {
    const a = queryKeys.postCheck(1001, 2025, undefined)
    const b = queryKeys.postCheck(1001, 2026, undefined)
    expect(a).not.toEqual(b)
  })

  it('pins the full key shape: [post-check, sessionCmId, year, scenarioId]', () => {
    expect(queryKeys.postCheck(1001, 2025, 'scenario-abc')).toEqual([
      'post-check',
      1001,
      2025,
      'scenario-abc',
    ])
  })

  it('postCheckPrefix is the head of the full key so prefix invalidation still matches', () => {
    const prefix = queryKeys.postCheckPrefix()
    const full = queryKeys.postCheck(1001, 2025, 'scenario-abc')
    expect(full.slice(0, prefix.length)).toEqual([...prefix])
  })
})

describe('queryKeys.sessionUploadChanges', () => {
  // Mirrors cohortBunkAssignments / campersForSession: array key segments are
  // sorted so cache identity is stable regardless of caller-supplied order
  // ([sessionCmId, ...agSessionCmIds] order can vary as AG links change).
  it('is order-independent: same ids in different order produce equal keys', () => {
    const a = queryKeys.sessionUploadChanges('r1', [1000001, 1000099])
    const b = queryKeys.sessionUploadChanges('r1', [1000099, 1000001])
    expect(a).toEqual(b)
  })

  it('pins the key shape: [sessionUploadChanges, runId, sortedIds]', () => {
    expect(queryKeys.sessionUploadChanges('r1', [1000099, 1000001])).toEqual([
      'sessionUploadChanges',
      'r1',
      [1000001, 1000099],
    ])
  })
})

describe('invalidateLodgingRegistryQueries', () => {
  // The lodging registry IS roster input: `_build_units`
  // (api/services/lodging_roster_service.py:350-419) projects name, area_name,
  // sleeps, is_confirmed, is_active, allocation_default and map_x/map_y into
  // the roster payload. WeekendRosterPage links straight to
  // /manage/lodging/units, so admin-edit-then-back is the designed round trip
  // — and the weekend queries now carry a 30 minute staleTime, so nothing
  // refreshes on its own.
  function recordingClient() {
    const keys: readonly unknown[][] = []
    return {
      keys,
      invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
        ;(keys as unknown[][]).push([...queryKey])
        return undefined
      },
    }
  }

  it('invalidates the weekend roster, summary and session list', () => {
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    expect(client.keys).toContainEqual(['weekend-roster'])
    expect(client.keys).toContainEqual(['weekend-summary'])
    expect(client.keys).toContainEqual(['weekend-sessions'])
  })

  it('still invalidates the registry keys the admin panels own', () => {
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    expect(client.keys).toContainEqual([...queryKeys.lodgingUnits()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingAreas()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingAliases()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingIngestIssues()])
  })

  it('invalidates the weekend keys by PREFIX, not by exact key', () => {
    // The admin panel knows neither the year nor the weekend, and the real
    // keys are [key, year] / [key, year, sessionCmId]. An exact-key
    // invalidation would match nothing that is actually cached.
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    const roster = client.keys.find((k) => k[0] === 'weekend-roster')
    const summary = client.keys.find((k) => k[0] === 'weekend-summary')
    expect(roster).toHaveLength(1)
    expect(summary).toHaveLength(1)
    // And the prefix must genuinely head the real key.
    const full = queryKeys.weekendRoster(2026, 1000001, '')
    expect(full.slice(0, 1)).toEqual(roster)
  })
})

describe('queryKeys.weekendRoster scenario dimension', () => {
  // Without a scenario in the key, the CampMinder mirror and every draft of
  // the same weekend share ONE cache slot. Selecting a scenario would serve
  // the mirror from cache and never refetch — and these queries carry the app
  // default 30 minute staleTime, so "never" is the accurate word.
  it('separates the mirror from a draft', () => {
    const mirror = queryKeys.weekendRoster(2026, 1000001, '')
    const draft = queryKeys.weekendRoster(2026, 1000001, 'scn7x2k9qw3mnbv')

    expect(draft).not.toEqual(mirror)
  })

  it('separates two drafts of the same weekend', () => {
    // Staff compare plans by switching between them. Two scenarios sharing a
    // slot would show the second the first one's placements.
    const optionA = queryKeys.weekendRoster(2026, 1000001, 'scn7x2k9qw3mnbv')
    const optionB = queryKeys.weekendRoster(2026, 1000001, 'scnp4d8sh1zjrtc')

    expect(optionA).not.toEqual(optionB)
  })

  it('keeps the scenario BEHIND year and session so the prefix still matches', () => {
    // `invalidateLodgingRegistryQueries` invalidates on ['weekend-roster'],
    // and React Query prefix-matches from the head. A scenario spliced in
    // ahead of the year would still match that one-element prefix, but the
    // ordering is what the rest of the key's readers assume.
    const key = queryKeys.weekendRoster(2026, 1000001, 'scn7x2k9qw3mnbv')

    expect(key).toEqual(['weekend-roster', 2026, 1000001, 'scn7x2k9qw3mnbv'])
  })
})
