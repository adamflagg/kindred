/**
 * Lodging registry CRUD.
 *
 * The load-bearing assertion here is the unit-create payload. PocketBase has
 * no per-field default for bool or select, and `required: true` on a bool
 * means "must be true", so neither is_active nor allocation_default can be
 * marked required in the schema. A create that omits them yields
 * `is_active = false, allocation_default = ''` — a unit invisible to every
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
  createLodgingAlias,
  createLodgingUnit,
  deactivateLodgingUnit,
  ignoreIngestIssue,
  listLodgingUnits,
  listUnresolvedAliasIssues,
  mapUnresolvedAlias,
} from './lodgingCrud'

beforeEach(() => {
  getFullList.mockReset().mockResolvedValue([])
  create.mockReset().mockResolvedValue({ id: 'u1' })
  update.mockReset().mockResolvedValue({ id: 'u1' })
  deleteRecord.mockReset().mockResolvedValue(undefined)
  collection.mockClear()
})

describe('listLodgingUnits', () => {
  it('reads lodging_units with the area expanded', async () => {
    await listLodgingUnits()

    expect(collection).toHaveBeenCalledWith('lodging_units')
    const [options] = getFullList.mock.calls[0] as [{ expand?: string; sort?: string }]
    expect(options.expand).toContain('area')
  })
})

describe('createLodgingUnit', () => {
  it('always sends is_active and an explicit allocation_default', async () => {
    await createLodgingUnit({
      area: 'area_1',
      name: 'Ridge N',
      code: 'ridge-n',
      is_active: true,
      allocation_default: 'family_pool',
    })

    const [payload] = create.mock.calls[0] as [Partial<LodgingUnitRecord>]
    expect(payload.is_active).toBe(true)
    expect(payload.allocation_default).toBe('family_pool')
  })

  it('defaults a missing is_container to false rather than omitting it', async () => {
    await createLodgingUnit({
      area: 'area_1',
      name: 'Ridge N',
      code: 'ridge-n',
      is_active: true,
      allocation_default: 'staff_default',
    })

    const [payload] = create.mock.calls[0] as [Partial<LodgingUnitRecord>]
    expect(payload.is_container).toBe(false)
    expect(payload.is_confirmed).toBe(false)
    expect(payload.allocation_default).toBe('staff_default')
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
  it('reads the ingest work queue, unresolved alias rows only', async () => {
    await listUnresolvedAliasIssues()

    expect(collection).toHaveBeenCalledWith('lodging_ingest_issues')
    const [options] = getFullList.mock.calls[0] as [{ filter?: string; sort?: string }]
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
