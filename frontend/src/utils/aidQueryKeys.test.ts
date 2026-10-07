import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { compareKey, type AidRequestSet, type CompareQuery } from '../services/camperships/aidApi'
import {
  invalidateAidMoneyQueries,
  invalidateAidRulesQueries,
  invalidateAidScenarioQueries,
  queryKeys,
} from './queryKeys'

describe('Camperships query keys', () => {
  it("sit under one 'financial-aid' prefix, so a sync or a write can invalidate by prefix (spec §10)", () => {
    expect(queryKeys.aidRemaining(2027, null, null).slice(0, 2)).toEqual(
      queryKeys.aidRemainingPrefix()
    )
    expect(queryKeys.aidRemainingPrefix()[0]).toBe(queryKeys.aidPrefix()[0])
  })

  it('puts a household page under the prefix invalidateAidMoneyQueries refreshes (review M4)', () => {
    expect(queryKeys.aidHouseholdPage(2027, 1000001).slice(0, 2)).toEqual(
      queryKeys.aidHouseholdPagePrefix()
    )
  })

  it('tell a live read from a past one, and the two axes apart', () => {
    expect(queryKeys.aidRemaining(2027, null, null)).not.toEqual(
      queryKeys.aidRemaining(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidRemaining(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidRemaining(2027, '2026-04-01', 'recorded')
    )
  })
})

describe("invalidateAidMoneyQueries (spec §10; #2924's invalidation table)", () => {
  const keysOf = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map(([args]) => (args as { queryKey: unknown[] }).queryKey)

  it('returns a promise that settles only once every refresh it starts has (build ruling 1)', async () => {
    let finish: (() => void) | undefined
    const gridRefetch = new Promise<void>((resolve) => {
      finish = resolve
    })
    const invalidateQueries = vi.fn((args: { queryKey: readonly unknown[] }) =>
      args.queryKey[1] === 'grid' ? gridRefetch : Promise.resolve()
    )
    let settled = false
    const done = invalidateAidMoneyQueries({ invalidateQueries }).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish?.()
    await done
    expect(settled).toBe(true)
  })

  it('keeps the application key under the prefix every write refreshes', () => {
    expect(queryKeys.aidApplication(2027, 1000001).slice(0, 2)).toEqual(
      queryKeys.aidApplicationPrefix()
    )
  })

  it('refreshes every read a write can move, and leaves the definitions and the jump index', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidMoneyQueries({ invalidateQueries })
    expect(keysOf(invalidateQueries)).toEqual([
      ['financial-aid', 'remaining'],
      ['financial-aid', 'budget'],
      ['financial-aid', 'grid'],
      ['financial-aid', 'today'],
      ['financial-aid', 'household-page'],
      ['financial-aid', 'application'],
      ['financial-aid', 'rules'],
      // Every write logs a row (spec §4.11), so every write moves Season › History (D49).
      ['financial-aid', 'history'],
      ['financial-aid', 'scenarios'],
    ])
  })

  it('refreshes the jump index too when a write changes who has aid activity (payer shares)', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidMoneyQueries({ invalidateQueries }, { jumpIndex: true })
    expect(keysOf(invalidateQueries)).toEqual([
      ['financial-aid', 'remaining'],
      ['financial-aid', 'budget'],
      ['financial-aid', 'grid'],
      ['financial-aid', 'today'],
      ['financial-aid', 'household-page'],
      ['financial-aid', 'application'],
      ['financial-aid', 'rules'],
      ['financial-aid', 'history'],
      ['financial-aid', 'scenarios'],
      ['financial-aid', 'jump-index'],
    ])
    expect(queryKeys.aidJumpIndex(2027).slice(0, 2)).toEqual(queryKeys.aidJumpIndexPrefix())
  })
})

describe('the Requests grid key', () => {
  it('sits under the grid prefix, apart per season, as-of and axis', () => {
    expect(queryKeys.aidGrid(2027, null, null).slice(0, 2)).toEqual(queryKeys.aidGridPrefix())
    expect(queryKeys.aidGrid(2027, null, null)).not.toEqual(
      queryKeys.aidGrid(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidGrid(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidGrid(2027, '2026-04-01', 'recorded')
    )
  })
})

describe('the approved-rules key (slice 2, read in the Requests grid)', () => {
  it('sits under the rules prefix, one key per version and one for the pricing read', () => {
    expect(queryKeys.aidRulesApproved(2027, 3).slice(0, 2)).toEqual(queryKeys.aidRulesPrefix())
    expect(queryKeys.aidRulesApproved(2027, null)).toEqual([
      'financial-aid',
      'rules',
      2027,
      'approved',
      'pricing',
    ])
    expect(queryKeys.aidRulesApproved(2027, 3)).not.toEqual(queryKeys.aidRulesApproved(2027, 4))
  })
})

describe('the Rounds & budget key (slice 2)', () => {
  it('sits under the budget prefix, apart per season, as-of and axis', () => {
    expect(queryKeys.aidBudget(2027, null, null).slice(0, 2)).toEqual(queryKeys.aidBudgetPrefix())
    expect(queryKeys.aidBudget(2027, null, null)).not.toEqual(
      queryKeys.aidBudget(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidBudget(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidBudget(2027, '2026-04-01', 'recorded')
    )
    expect(queryKeys.aidBudget(2027, null, null)).not.toEqual(queryKeys.aidBudget(2028, null, null))
    // The hook passes `past?.axis ?? null`: a null axis must key as the default, 'campminder'.
    expect(queryKeys.aidBudget(2027, '2026-04-01', null)).toEqual(
      queryKeys.aidBudget(2027, '2026-04-01', 'campminder')
    )
  })
})

describe('invalidateAidRulesQueries (slice 2; spec §10)', () => {
  const keysOf = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map(([args]) => (args as { queryKey: unknown[] }).queryKey)

  it("refreshes the rules and Today's Finance line on a draft save, and no money read", () => {
    const invalidateQueries = vi.fn()
    void invalidateAidRulesQueries({ invalidateQueries })
    expect(keysOf(invalidateQueries)).toEqual([
      ['financial-aid', 'rules'],
      ['financial-aid', 'today'],
      // A draft save logs a rules row too (D49), though it prices nothing.
      ['financial-aid', 'history'],
      ['financial-aid', 'scenarios'],
    ])
  })

  it('refreshes every money read too on an approval, which re-prices the season', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidRulesQueries({ invalidateQueries }, { priced: true })
    const keys = keysOf(invalidateQueries)
    expect(keys).toContainEqual(['financial-aid', 'budget'])
    expect(keys).toContainEqual(['financial-aid', 'grid'])
    expect(keys).toContainEqual(['financial-aid', 'household-page'])
    // History once, through the money helper: a second invalidation would restart the first refetch.
    expect(keys.filter((key) => key[1] === 'history')).toHaveLength(1)
    expect(queryKeys.aidRulesDraft(2027).slice(0, 2)).toEqual(queryKeys.aidRulesPrefix())
    expect(queryKeys.aidRulesApproved(2027, 3).slice(0, 2)).toEqual(queryKeys.aidRulesPrefix())
  })

  it('invalidates each prefix once on an approval, so no active read is cancelled and refetched twice', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidRulesQueries({ invalidateQueries }, { priced: true })
    const keys = keysOf(invalidateQueries).map((k) => JSON.stringify(k))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("Season › History's keys (D49)", () => {
  it('sit under the history prefix, apart per season, query and operation', () => {
    const query = { kind: 'holds', per_page: '50' }
    expect(queryKeys.aidHistoryPages(2027, query).slice(0, 2)).toEqual(queryKeys.aidHistoryPrefix())
    expect(queryKeys.aidHistoryOperation(2027, 'op0000000000003').slice(0, 2)).toEqual(
      queryKeys.aidHistoryPrefix()
    )
    expect(queryKeys.aidHistoryPages(2027, query)).not.toEqual(
      queryKeys.aidHistoryPages(2028, query)
    )
    expect(queryKeys.aidHistoryPages(2027, query)).not.toEqual(
      queryKeys.aidHistoryPages(2027, { per_page: '50' })
    )
    expect(queryKeys.aidHistoryPrefix()[0]).toBe(queryKeys.aidPrefix()[0])
  })
})

describe('invalidateAidScenarioQueries (slice 2; spec §7.4)', () => {
  it('refreshes the scenario reads only: a scenario never writes live awards', async () => {
    const invalidateQueries = vi.fn((_args: unknown) => Promise.resolve())
    await invalidateAidScenarioQueries({ invalidateQueries })
    expect(invalidateQueries.mock.calls).toHaveLength(1)
    expect(invalidateQueries.mock.calls[0]?.[0]).toMatchObject({
      queryKey: ['financial-aid', 'scenarios'],
    })
    expect(queryKeys.aidScenarios(2027).slice(0, 2)).toEqual(queryKeys.aidScenariosPrefix())
    expect(queryKeys.aidScenarioSensitivity(2027, 't', 's').slice(0, 2)).toEqual(
      queryKeys.aidScenariosPrefix()
    )
  })

  it('keys the compare and the trail under the scenario prefix, never at the sensitivity slot', () => {
    const ask = (requestSet: AidRequestSet, lastSeason: boolean, codes = ['A1']): CompareQuery => ({
      codes,
      requestSet,
      lastSeason,
      rules: false,
      lastRules: false,
      draft: true,
    })
    const compareOf = (query: CompareQuery) => queryKeys.aidScenarioCompare(2027, compareKey(query))
    for (const key of [
      compareOf(ask({ kind: 'deadline' }, true, ['A1', 'B'])),
      queryKeys.aidScenarioTrail(2027, 2),
    ]) {
      expect(key.slice(0, 2)).toEqual(queryKeys.aidScenariosPrefix())
      expect(key[3]).not.toBe('sensitivity')
    }
    expect(compareOf(ask({ kind: 'all' }, false))).not.toEqual(
      compareOf(ask({ kind: 'deadline' }, false))
    )
    expect(compareOf(ask({ kind: 'all' }, false))).not.toEqual(
      compareOf(ask({ kind: 'all' }, true))
    )
  })

  it('waits for the refetch: its promise settles only after the invalidation does', async () => {
    let release: () => void = () => undefined
    const invalidateQueries = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    let done = false
    const waiting = invalidateAidScenarioQueries({ invalidateQueries }).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await waiting
    expect(done).toBe(true)
  })

  it('keeps the scenario keys apart from every other aid read and from each other', () => {
    expect(queryKeys.aidScenarios(2027)).not.toEqual(queryKeys.aidScenarios(2028))
    expect(queryKeys.aidScenarioSensitivity(2027, 't1', 's')).not.toEqual(
      queryKeys.aidScenarioSensitivity(2027, 't2', 's')
    )
    expect(queryKeys.aidScenarioSensitivity(2027, 't', 's1')).not.toEqual(
      queryKeys.aidScenarioSensitivity(2027, 't', 's2')
    )
    expect(queryKeys.aidScenarios(2027)).not.toEqual(queryKeys.aidScenarioSensitivity(2027, '', ''))
    const otherPrefixes = Object.entries(queryKeys)
      .filter(([name]) => /^aid.*Prefix$/.test(name) && name !== 'aidScenariosPrefix')
      .map(([, build]) => (build as () => readonly unknown[])())
    expect(otherPrefixes.length).toBeGreaterThan(5)
    for (const prefix of otherPrefixes) expect(prefix).not.toEqual(queryKeys.aidScenariosPrefix())
  })
})

describe("each step's effect is a pure function of its key (lead ruling, review I1)", () => {
  // Real client: the filter each helper hands over decides what is marked stale.
  function seeded() {
    const client = new QueryClient()
    client.setQueryData(queryKeys.aidScenarios(2027), { w: 1 })
    client.setQueryData(queryKeys.aidScenarioSensitivity(2027, 't', 's'), { s: 1 })
    return client
  }
  const stale = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated

  it.each([
    ['a scenario write', (c: QueryClient) => invalidateAidScenarioQueries(c)],
    ['a rules write', (c: QueryClient) => invalidateAidRulesQueries(c)],
    ['an approval', (c: QueryClient) => invalidateAidRulesQueries(c, { priced: true })],
    ['a money write', (c: QueryClient) => invalidateAidMoneyQueries(c)],
  ])('%s refreshes the workspace and leaves every sensitivity read alone', async (_name, run) => {
    const client = seeded()
    await run(client)
    expect(stale(client, queryKeys.aidScenarios(2027))).toBe(true)
    expect(stale(client, queryKeys.aidScenarioSensitivity(2027, 't', 's'))).toBe(false)
  })

  it('invalidates the scenario prefix once on an approval, which money already covers', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidRulesQueries({ invalidateQueries }, { priced: true })
    const scenarioCalls = invalidateQueries.mock.calls.filter(
      ([args]) =>
        JSON.stringify((args as { queryKey: unknown[] }).queryKey) ===
        JSON.stringify(queryKeys.aidScenariosPrefix())
    )
    expect(scenarioCalls).toHaveLength(1)
  })
})
