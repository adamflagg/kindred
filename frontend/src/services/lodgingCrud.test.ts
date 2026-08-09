/**
 * Lodging registry CRUD.
 *
 * The load-bearing assertion here is the unit-create payload. PocketBase has
 * no per-field default for bool or select, and `required: true` on a bool
 * means "must be true", so neither is_active nor inventory_class can be
 * marked required in the schema. A create that omits them yields
 * `is_active = false, inventory_class = ''` — a unit invisible to every
 * list query that also matches neither branch of the availability rules.
 *
 * The work queue is `lodging_ingest_issues`, NOT the `lodging_unresolved_aliases`
 * collection the plan drafted. The ingest is its sole producer; this surface
 * only reads and resolves. Resolution is `is_resolved` + `resolved_alias`,
 * not a `status` select — see the cross-plan ruling in the handoff.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn()
const create = vi.fn()
const update = vi.fn()
const deleteRecord = vi.fn()
const collection = vi.fn((_name: string) => ({
  getFullList,
  create,
  update,
  delete: deleteRecord,
}))

vi.mock('../lib/pocketbase', () => ({ pb: { collection: (name: string) => collection(name) } }))

import type { LodgingAliasRecord, LodgingUnitRecord } from '../types/lodging'
import {
  confirmLodgingUnits,
  createLodgingAlias,
  createLodgingUnit,
  deactivateLodgingUnit,
  deleteLodgingAlias,
  ignoreIngestIssue,
  listLodgingUnits,
  listUnresolvedAliasIssues,
  mapUnresolvedAlias,
  reorderLodgingAreas,
  setWeekendSessionStatus,
} from './lodgingCrud'

beforeEach(() => {
  getFullList.mockReset().mockResolvedValue([])
  create.mockReset().mockResolvedValue({ id: 'u1' })
  update.mockReset().mockResolvedValue({ id: 'u1' })
  deleteRecord.mockReset().mockResolvedValue(undefined)
  collection.mockClear()
})

describe('listLodgingUnits', () => {
  it('reads lodging_units with the area expanded, filtered to one season', async () => {
    await listLodgingUnits(2026)

    expect(collection).toHaveBeenCalledWith('lodging_units')
    const [options] = getFullList.mock.calls[0] as [
      { expand?: string; filter?: string; sort?: string },
    ]
    expect(options.expand).toContain('area')
    expect(options.filter).toContain('year = 2026')
  })
})

describe('createLodgingUnit', () => {
  it('always sends is_active and an explicit inventory_class', async () => {
    await createLodgingUnit({
      area: 'area_1',
      name: 'Ridge N',
      code: 'ridge-n',
      is_active: true,
      inventory_class: 'family_pool',
      shareability: '',
      year: 2026,
    })

    const [payload] = create.mock.calls[0] as [Partial<LodgingUnitRecord>]
    expect(payload.is_active).toBe(true)
    expect(payload.inventory_class).toBe('family_pool')
  })

  it('defaults a missing is_container to false rather than omitting it', async () => {
    await createLodgingUnit({
      area: 'area_1',
      name: 'Ridge N',
      code: 'ridge-n',
      is_active: true,
      inventory_class: 'staff_default',
      shareability: '',
      year: 2026,
    })

    const [payload] = create.mock.calls[0] as [Partial<LodgingUnitRecord>]
    expect(payload.is_container).toBe(false)
    expect(payload.is_confirmed).toBe(false)
    expect(payload.inventory_class).toBe('staff_default')
  })
})

describe('deactivateLodgingUnit', () => {
  it('sets is_active false instead of deleting', async () => {
    await deactivateLodgingUnit('u1')

    expect(deleteRecord).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('u1', { is_active: false })
  })
})

describe('createLodgingAlias', () => {
  it('refuses to create an alias with no member units', async () => {
    await expect(
      createLodgingAlias({ alias_string: 'Some Cabin', member_units: [] })
    ).rejects.toThrow(/at least one unit/i)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('listUnresolvedAliasIssues', () => {
  it('reads the ingest work queue, unresolved alias rows only, for one season', async () => {
    await listUnresolvedAliasIssues(2026)

    expect(collection).toHaveBeenCalledWith('lodging_ingest_issues')
    const [options] = getFullList.mock.calls[0] as [{ filter?: string; sort?: string }]
    expect(options.filter).toContain('year = 2026')
    expect(options.filter).toContain('kind = "unresolved_alias"')
    expect(options.filter).toContain('is_resolved = false')
  })
})

describe('mapUnresolvedAlias', () => {
  it('creates the alias row then marks the queue row resolved', async () => {
    create.mockResolvedValueOnce({ id: 'alias_1' })

    const alias = await mapUnresolvedAlias('q1', 'Golden Triangle - Tenaya 1and2', ['u1', 'u2'], {
      validFromYear: 2025,
      sourceField: 'Family Camp Cabin',
    })

    const [aliasPayload] = create.mock.calls[0] as [Partial<LodgingAliasRecord>]
    expect(aliasPayload.alias_string).toBe('Golden Triangle - Tenaya 1and2')
    expect(aliasPayload.member_units).toEqual(['u1', 'u2'])
    expect(aliasPayload.valid_from_year).toBe(2025)
    expect(aliasPayload.source_field).toBe('Family Camp Cabin')

    expect(update).toHaveBeenCalledWith('q1', { is_resolved: true, resolved_alias: 'alias_1' })
    expect(alias).toEqual({ id: 'alias_1' })
  })

  it('refuses to create an alias with no member units', async () => {
    await expect(mapUnresolvedAlias('q1', 'Some Cabin', [])).rejects.toThrow(/at least one unit/i)
    expect(create).not.toHaveBeenCalled()
  })

  // Without this the natural staff retry produces a SECOND alias row carrying
  // the same alias_string and member_units. Two alias rows covering one string
  // in one year is exactly the state `ambiguous_alias` exists to flag, and the
  // migration notes that kind is only reachable through this admin UI.
  it('deletes the alias it just created when the queue update fails', async () => {
    create.mockResolvedValueOnce({ id: 'alias_1' })
    update.mockRejectedValueOnce(new Error('queue write failed'))
    deleteRecord.mockResolvedValueOnce(undefined)

    await expect(mapUnresolvedAlias('q1', 'Some Cabin', ['u1'])).rejects.toThrow(
      'queue write failed'
    )

    expect(deleteRecord).toHaveBeenCalledWith('alias_1')
  })

  it('still reports the original failure when the rollback itself fails', async () => {
    // The staffer needs to know the queue write failed. Surfacing a cleanup
    // error instead would send them looking in the wrong place.
    create.mockResolvedValueOnce({ id: 'alias_1' })
    update.mockRejectedValueOnce(new Error('queue write failed'))
    deleteRecord.mockRejectedValueOnce(new Error('rollback also failed'))

    await expect(mapUnresolvedAlias('q1', 'Some Cabin', ['u1'])).rejects.toThrow(
      'queue write failed'
    )
  })
})

describe('deleteLodgingAlias', () => {
  // Deleting an alias behind a RESOLVED queue item silences that item forever:
  // ingest writes is_resolved only on create, so the re-encountered cabin
  // string updates the existing row without reopening it. Reopening first both
  // restores the work item and clears the reference the Go guard checks.
  it('reopens every queue item the alias resolved before deleting it', async () => {
    getFullList.mockResolvedValueOnce([{ id: 'q1' }, { id: 'q2' }])

    await deleteLodgingAlias('alias_1')

    expect(update).toHaveBeenCalledWith('q1', { is_resolved: false, resolved_alias: '' })
    expect(update).toHaveBeenCalledWith('q2', { is_resolved: false, resolved_alias: '' })
    expect(deleteRecord).toHaveBeenCalledWith('alias_1')
  })

  it('deletes an alias no queue item points at without touching the queue', async () => {
    getFullList.mockResolvedValueOnce([])

    await deleteLodgingAlias('alias_1')

    expect(update).not.toHaveBeenCalled()
    expect(deleteRecord).toHaveBeenCalledWith('alias_1')
  })

  it('does not delete the alias when reopening a queue item fails', async () => {
    // Otherwise the Go guard rejects the delete anyway and the staffer sees a
    // confusing second error; worse, a partial reopen would be invisible.
    getFullList.mockResolvedValueOnce([{ id: 'q1' }])
    update.mockRejectedValueOnce(new Error('reopen failed'))

    await expect(deleteLodgingAlias('alias_1')).rejects.toThrow('reopen failed')
    expect(deleteRecord).not.toHaveBeenCalled()
  })
})

describe('ignoreIngestIssue', () => {
  it('resolves the queue row without creating an alias, and leaves resolved_alias empty', async () => {
    await ignoreIngestIssue('q1', 'Not a cabin name.')

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('q1', {
      is_resolved: true,
      resolution_note: 'Not a cabin name.',
    })
  })
})

describe('confirmLodgingUnits', () => {
  it('confirms every id and reports how many landed', async () => {
    const confirmed = await confirmLodgingUnits(['u1', 'u2'])

    expect(update).toHaveBeenNthCalledWith(1, 'u1', { is_confirmed: true })
    expect(update).toHaveBeenNthCalledWith(2, 'u2', { is_confirmed: true })
    expect(confirmed).toBe(2)
  })

  it('keeps going when one write fails, because a partial bulk action must be reportable', async () => {
    update.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ id: 'u2' })

    const confirmed = await confirmLodgingUnits(['u1', 'u2'])

    expect(update).toHaveBeenCalledTimes(2)
    expect(confirmed).toBe(1)
  })

  it('does nothing for an empty selection', async () => {
    expect(await confirmLodgingUnits([])).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('reorderLodgingAreas', () => {
  it('writes sort_order from 1 in the given order', async () => {
    await reorderLodgingAreas(['a3', 'a1', 'a2'])

    expect(update).toHaveBeenNthCalledWith(1, 'a3', { sort_order: 1 })
    expect(update).toHaveBeenNthCalledWith(2, 'a1', { sort_order: 2 })
    expect(update).toHaveBeenNthCalledWith(3, 'a2', { sort_order: 3 })
  })

  // Pinning the real behaviour rather than the behaviour the docstring used to
  // claim. A mid-loop failure DOES leave a partial reorder, and because a
  // reorder is a swap, the two swapped rows can end up sharing a rank: writing
  // a3 -> 1 and then failing on a1 leaves a1 at its old 1 too. The loop stops
  // rather than pressing on, so the surviving state is the shorter prefix, and
  // the caller surfaces the error.
  it('stops at the first failure and leaves the remaining areas untouched', async () => {
    update.mockResolvedValueOnce({ id: 'a3' }).mockRejectedValueOnce(new Error('network'))

    await expect(reorderLodgingAreas(['a3', 'a1', 'a2'])).rejects.toThrow('network')

    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenNthCalledWith(1, 'a3', { sort_order: 1 })
    expect(update).toHaveBeenNthCalledWith(2, 'a1', { sort_order: 2 })
  })
})

// ── Weekend status (kindred#2092) ─────────────────────────────────────────────
//
// STAFF-OWNED and derivable from nothing: CampMinder's Sessions API has no
// status concept, so this is the one lodging table with no upstream at all.
// The key is the PAIR (session_cm_id, year) — CampMinder reuses session ids
// across years — and ABSENCE OF A ROW MEANS ACTIVE, which is why going back to
// active DELETES rather than writing a second spelling of the same state.
describe('setWeekendSessionStatus', () => {
  it('creates a row keyed on the CampMinder id and the year', async () => {
    getFullList.mockResolvedValue([])

    await setWeekendSessionStatus(2026, 1000002, 'cancelled')

    expect(collection).toHaveBeenCalledWith('lodging_session_status')
    const [payload] = create.mock.calls[0] as [Record<string, unknown>]
    expect(payload).toEqual({ session_cm_id: 1000002, year: 2026, status: 'cancelled' })
  })

  it('scopes the existing-row lookup to BOTH the weekend and the season', async () => {
    // Without the year, a 2026 cancellation would find and overwrite the 2027
    // row for the weekend that inherited the same CampMinder id.
    getFullList.mockResolvedValue([])

    await setWeekendSessionStatus(2026, 1000002, 'cancelled')

    const [options] = getFullList.mock.calls[0] as [{ filter?: string }]
    expect(options.filter).toContain('session_cm_id = 1000002')
    expect(options.filter).toContain('year = 2026')
  })

  it('updates the existing row rather than creating a second one', async () => {
    getFullList.mockResolvedValue([
      { id: 'st_1', session_cm_id: 1000002, year: 2026, status: 'active' },
    ])

    await setWeekendSessionStatus(2026, 1000002, 'cancelled')

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('st_1', { status: 'cancelled' })
  })

  it('DELETES the row when a weekend goes back to running', async () => {
    // Absence is what "active" means, so storing `active` would be a second
    // spelling of a state the empty table already expresses — the same shape
    // `lodging_availability` uses for clearing an override.
    getFullList.mockResolvedValue([
      { id: 'st_1', session_cm_id: 1000002, year: 2026, status: 'cancelled' },
    ])

    await setWeekendSessionStatus(2026, 1000002, 'active')

    expect(deleteRecord).toHaveBeenCalledWith('st_1')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('writes nothing at all when a weekend with no row is set to running', async () => {
    getFullList.mockResolvedValue([])

    await setWeekendSessionStatus(2026, 1000002, 'active')

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('resolves a create race by updating the row the other writer won, rather than surfacing a raw PocketBase error', async () => {
    // Read-then-write, not atomic (kindred#2092 finding 3): two staff
    // cancelling the same weekend at once both see `existing` empty and both
    // reach `create()`. The unique index on (session_cm_id, year) —
    // 1500000142 — lets only one through; the loser must not hand
    // `toast.error` a raw PocketBase 400. Its INTENT — mark the weekend
    // `cancelled` — is still true once the winner's row exists, so the loser
    // re-reads and updates that row instead of failing.
    getFullList.mockResolvedValueOnce([]) // the initial read, before either write
    create.mockRejectedValueOnce(new Error('Failed to create record.'))
    getFullList.mockResolvedValueOnce([
      { id: 'st_1', session_cm_id: 1000002, year: 2026, status: 'cancelled' },
    ]) // the retry read, after the other writer's row landed

    await expect(setWeekendSessionStatus(2026, 1000002, 'cancelled')).resolves.toBeUndefined()

    expect(update).toHaveBeenCalledWith('st_1', { status: 'cancelled' })
  })

  it('still throws when create fails for a reason other than the race', async () => {
    // The retry finds no row either — this was never a duplicate-key
    // collision, so swallowing it would hide a real failure (permissions,
    // network) behind a silent no-op.
    getFullList.mockResolvedValueOnce([])
    const error = new Error('Network error')
    create.mockRejectedValueOnce(error)
    getFullList.mockResolvedValueOnce([])

    await expect(setWeekendSessionStatus(2026, 1000002, 'cancelled')).rejects.toThrow(error)
  })
})
