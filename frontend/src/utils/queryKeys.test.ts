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
  // sleeps, is_confirmed, is_active, inventory_class and map_x/map_y into
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

    expect(client.keys).toContainEqual([...queryKeys.lodgingUnitsPrefix()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingAreasPrefix()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingAliases()])
    expect(client.keys).toContainEqual([...queryKeys.lodgingIngestIssuesPrefix()])
  })

  it('invalidates the household journey, which kindred#2332 made registry-fed', () => {
    // It was NOT registry-fed before: the journey carried the staff-written
    // `cabin_assignment` free text, so a unit rename could not move it and
    // `useHouseholdJourney` inherits the 30 minute app default with no writer
    // to invalidate against. kindred#2332 resolves `cabin_name` to the unit's
    // present-day `lodging_units.name`, so an admin rename now DOES move this
    // payload — and staff rename in bursts (fourteen units in two minutes on
    // 2026-08-15). Without this the history modal shows the old name for half
    // an hour while the board behind it shows the new one, which is the exact
    // disagreement the issue existed to remove.
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    const journey = client.keys.find((k) => k[0] === 'household-journey')
    expect(journey).toHaveLength(1)
    // By PREFIX: the real key is ['household-journey', householdCmId] and the
    // admin panel knows no household at all.
    expect(queryKeys.householdJourney(2000001).slice(0, 1)).toEqual(journey)
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

  it('invalidates the push preview, which every write-in edit moves', () => {
    // The board's "Push write-ins" badge is now the SERVER's count of what a
    // push would write (owner ruling 2026-08-28), read from this key by an
    // observer that stays mounted for as long as the board is open. Every
    // writer that changes a write-in — `useUnitAvailability`, a merge, an
    // admin rename that re-keys a building — already funnels through this
    // helper, so this line is what keeps that badge from sitting on a stale
    // number for the app's 30 minute default.
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    const preview = client.keys.find((k) => k[0] === 'push-preview')
    expect(preview).toHaveLength(1)
    // By PREFIX: the real key carries year, weekend and scenario, and an
    // admin panel knows none of them.
    expect(queryKeys.pushPreview(2026, 1000001, 'scn_1').slice(0, 1)).toEqual(preview)
  })

  it('invalidates the cabin-weekend attribution queue by prefix', () => {
    // Confirming a row (kindred#2648's frontend half) is a
    // lodging_ingest_issues write like resolving an unresolved-alias row is —
    // and it moves the roster too, since replayOnResolve materialises the
    // placement. Without this the confirmed row would sit in the admin
    // queue's cache and the board's stats-bar chip for 30 minutes after a
    // successful confirm.
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    const queue = client.keys.find((k) => k[0] === 'session-attribution-queue')
    expect(queue).toHaveLength(1)
    expect(queryKeys.sessionAttributionQueue(2026).slice(0, 1)).toEqual(queue)
  })

  it('invalidates the lodging registry keys by PREFIX too, since 1500000141', () => {
    // Units and areas became year-scoped: the real keys are [key, year], and
    // an admin panel editing one season's registry does not know every year a
    // reader might have cached — so this must match ALL of them, not just the
    // season currently open.
    const client = recordingClient()
    invalidateLodgingRegistryQueries(client)

    const units = client.keys.find((k) => k[0] === 'lodging-units')
    const areas = client.keys.find((k) => k[0] === 'lodging-areas')
    const issues = client.keys.find((k) => k[0] === 'lodging-ingest-issues')
    expect(units).toHaveLength(1)
    expect(areas).toHaveLength(1)
    expect(issues).toHaveLength(1)
    // And the prefix must genuinely head the real, year-scoped key.
    expect(queryKeys.lodgingUnits(2026).slice(0, 1)).toEqual(units)
    expect(queryKeys.lodgingAreas(2026).slice(0, 1)).toEqual(areas)
    expect(queryKeys.lodgingIngestIssues(2026).slice(0, 1)).toEqual(issues)
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
