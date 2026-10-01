import { describe, expect, it } from 'vitest'

import {
  confirmationOut,
  GRID_ROWS,
  gridRow,
  roundOut,
  ROW_EMMA,
  ROW_LIAM,
  ROW_OLIVIA,
  ROW_SAMUEL,
} from './gridFixtures'
import {
  countWords,
  familyGroup,
  filterRows,
  footerWords,
  GRID_COLUMNS,
  moneyTotal,
  NO_FILTERS,
  parseRoundFilter,
  parseTickFilter,
  reasonGroup,
  REQUEST_VIEWS,
  requestsCsvName,
  requestView,
  viewColumns,
  viewCount,
  viewCounts,
} from './views'

const TODAY = '2027-04-01'

describe('REQUEST_VIEWS (§6.2)', () => {
  it('has All and one view per queue the server names, in its order', () => {
    expect(REQUEST_VIEWS.map((v) => v.key)).toEqual([
      'all',
      'needs_offer',
      'holds',
      'pending_approval',
      'waiting_on_family',
      'appeals',
      'not_reconciled',
      'to_reverse',
      'session_not_settled',
      'duplicates',
      'cancel_reason',
    ])
  })

  it('gives All D27’s fifteen columns at their widths, about 1,430 px with the flexible one', () => {
    const all = requestView('all')
    const keys = viewColumns(all, false)
    expect(keys.map((k) => GRID_COLUMNS[k].header)).toEqual([
      'Family',
      'Camper',
      'Session',
      'Stage',
      'Tier',
      'Ask',
      'Cost',
      'R1',
      'Appeal ask',
      'R2',
      'R3',
      'Total',
      'Posted',
      'Confirmed by the ledger',
      'Needs attention',
    ])
    const fixed = keys.reduce((sum, k) => sum + (GRID_COLUMNS[k].width ?? 0), 0)
    expect(fixed + 250).toBe(1430)
  })

  it('brings the two id columns back, pinned after the names, with Show IDs (D27)', () => {
    expect(viewColumns(requestView('holds'), true).slice(0, 4)).toEqual([
      'family',
      'camper',
      'householdId',
      'personId',
    ])
    expect(GRID_COLUMNS.householdId.pinned).toBe(true)
  })

  it('opens a queue view grouped, All flat, and an unknown slug on All', () => {
    expect(requestView('holds').groupBy).toBe('reason')
    expect(requestView('needs-offer').groupBy).toBe('round')
    expect(requestView('appeals').groupBy).toBe('one')
    expect(requestView('all').groupBy).toBeNull()
    expect(requestView('bogus').key).toBe('all')
    expect(requestView(null).key).toBe('all')
  })
})

describe('filterRows', () => {
  it("keeps a view's rows by the server's queues, and the program, pool and id filters", () => {
    expect(filterRows(GRID_ROWS, 'holds', NO_FILTERS)).toEqual([ROW_LIAM])
    expect(filterRows(GRID_ROWS, 'all', { ...NO_FILTERS, program: 'quest' })).toEqual([ROW_OLIVIA])
    expect(filterRows(GRID_ROWS, 'all', { ...NO_FILTERS, pool: 'pool_b' })).toEqual([ROW_OLIVIA])
    expect(
      filterRows(GRID_ROWS, 'all', { ...NO_FILTERS, ids: new Set(['reqemma00000001']) })
    ).toEqual([ROW_EMMA])
  })

  it('narrows to a round, and to rounds posted or accepted (owner ruling Group 2c Q3)', () => {
    const names = (filters: Partial<typeof NO_FILTERS>) =>
      filterRows(GRID_ROWS, 'all', { ...NO_FILTERS, ...filters }).map((r) => r.camper_name)
    expect(names({ round: 2 })).toEqual(['Olivia Chen'])
    expect(names({ tick: 'posted' })).toEqual(['Samuel Johnson', 'Olivia Chen', 'Riley Sam'])
    expect(names({ tick: 'accepted' })).toEqual(['Olivia Chen'])
    expect(names({ round: 2, tick: 'posted' })).toEqual([])
    expect(parseRoundFilter('2')).toBe(2)
    expect(parseRoundFilter('4')).toBeNull()
    expect(parseTickFilter('accepted')).toBe('accepted')
    expect(parseTickFilter('bogus')).toBeNull()
  })

  it('finds no queue rows on a past-date read, whose queues are null', () => {
    const past = GRID_ROWS.map((row) => ({ ...row, queues: null }))
    expect(filterRows(past, 'holds', NO_FILTERS)).toEqual([])
  })
})

describe('counts', () => {
  it('count families and requests, in short and in long words', () => {
    const count = viewCount(GRID_ROWS)
    expect(count).toEqual({ families: 4, requests: 5 })
    expect(countWords(count)).toBe('4 fam · 5 req')
    expect(countWords(null)).toBe('—')
    expect(footerWords(count)).toBe('5 requests · 4 families')
    expect(footerWords({ families: 1, requests: 1 })).toBe('1 request · 1 family')
  })

  it('count every view live, and only All on a past date (Decision 11)', () => {
    const live = viewCounts(GRID_ROWS, NO_FILTERS, true)
    expect(live.get('holds')).toEqual({ families: 1, requests: 1 })
    expect(live.get('needs_offer')).toEqual({ families: 2, requests: 2 })
    const past = viewCounts(GRID_ROWS, NO_FILTERS, false)
    expect(past.get('all')).toEqual({ families: 4, requests: 5 })
    expect(past.has('holds')).toBe(false)
  })
})

describe('grouping', () => {
  it('groups Holds by the hold, Needs an offer by round, and one-group views under their name', () => {
    expect(reasonGroup(requestView('holds'), TODAY)(ROW_LIAM)).toEqual({
      id: 'Placeholder income',
      heading: 'Placeholder income',
    })
    expect(reasonGroup(requestView('needs-offer'), TODAY)(ROW_OLIVIA)).toEqual({
      id: 'r2',
      heading: 'Round 2',
    })
    expect(reasonGroup(requestView('appeals'), TODAY)(ROW_OLIVIA)).toEqual({
      id: 'appeals',
      heading: 'Appeals',
    })
    expect(reasonGroup(requestView('not-reconciled'), TODAY)(ROW_SAMUEL)).toEqual({
      id: 'Short',
      heading: 'Short',
    })
  })

  it("heads a confirmed request's group by its open share's own state, as Today's reasons do (Minor 1)", () => {
    const share = (status: 'confirmed' | 'short' | 'awaiting_sync') => ({
      household_cm_id: 1000001,
      expected: 900,
      in_campminder: 900,
      status,
    })
    const row = gridRow({
      confirmation: confirmationOut({
        status: 'confirmed',
        reconciled: false,
        shares: [share('confirmed'), share('short'), share('awaiting_sync')],
      }),
    })
    expect(reasonGroup(requestView('not-reconciled'), TODAY)(row)).toEqual({
      id: 'Short',
      heading: 'Short',
    })
  })

  it('groups by family under the household name', () => {
    expect(familyGroup(ROW_SAMUEL)).toEqual({ id: '1000001', heading: 'The Johnson Family' })
  })
})

describe('cells', () => {
  it('sum a money column to the cent, and read "—" when nothing is there (D74)', () => {
    expect(moneyTotal([1800, null, 0.28])).toBe(1800.28)
    expect(moneyTotal([0.1, 0.2])).toBe(0.3)
    expect(moneyTotal([null, null])).toBeNull()
  })

  it('pick the round a per-round view is about', () => {
    const ctx = (view: 'needs_offer' | 'waiting_on_family') => ({ view, today: TODAY })
    expect(GRID_COLUMNS.round.value(ROW_OLIVIA, ctx('needs_offer'))).toBe('R2')
    expect(GRID_COLUMNS.decided.value(ROW_OLIVIA, ctx('needs_offer'))).toBe(780)
    expect(GRID_COLUMNS.round.value(ROW_SAMUEL, ctx('waiting_on_family'))).toBe('R1')
    expect(GRID_COLUMNS.daysWaiting.value(ROW_SAMUEL, ctx('waiting_on_family'))).toBe(23)
  })

  it('Days waiting ignores a clawed-back round and an accepted one (regression guard, the server’s _waiting_since)', () => {
    const ctx = { view: 'waiting_on_family' as const, today: TODAY }
    const posted = (round: 1 | 2 | 3, on: string, over = {}) =>
      roundOut(round, 'posted', { posted: 100, posted_on: on, ...over })
    const row = gridRow({
      rounds: [
        posted(1, '2027-01-01', { clawed_back: true }),
        posted(2, '2027-02-01', { accepted: true }),
        posted(3, '2027-03-20'),
      ],
    })
    expect(GRID_COLUMNS.daysWaiting.value(row, ctx)).toBe(12)
    const none = gridRow({
      rounds: [
        posted(1, '2027-01-01', { clawed_back: true }),
        posted(2, '2027-02-01', { accepted: true }),
      ],
    })
    expect(GRID_COLUMNS.daysWaiting.value(none, ctx)).toBeNull()
  })

  it("read Ask as Round 1's ask, and R3 as its decided amount, not one pending approval", () => {
    const ctx = { view: 'all' as const, today: TODAY }
    expect(GRID_COLUMNS.ask.value(ROW_OLIVIA, ctx)).toBe(2000)
    expect(GRID_COLUMNS.appealAsk.value(ROW_OLIVIA, ctx)).toBe(1200)
    const pending = gridRow({
      rounds: [roundOut(3, 'pending_approval', { pending_approval: 450 })],
    })
    expect(GRID_COLUMNS.r3.value(pending, ctx)).toBeNull()
  })
})

describe('Session not settled (Minor 2)', () => {
  it('always shows an item and a session, even when the rules only warn about the session', () => {
    const row = gridRow({
      request_status: 'unmatched_session',
      session_name: '',
      holds: [],
      queues: ['session_not_settled'],
    })
    const ctx = { view: 'session_not_settled' as const, today: TODAY }
    expect(GRID_COLUMNS.attention.value(row, ctx)).toContain('Session not settled')
    expect(reasonGroup(requestView('session-not-settled'), TODAY)(row).heading).toBe(
      'Session not settled'
    )
    expect(GRID_COLUMNS.session.value(row, ctx)).toBeNull()
  })
})

describe('requestsCsvName (§11, D70; Decision 32)', () => {
  it('names the view, its filters, the season and a past date', () => {
    expect(
      requestsCsvName(
        requestView('holds'),
        { program: 'summer', pool: null, round: null, tick: null },
        2027,
        '2027-04-10'
      )
    ).toBe('camperships-requests-holds-summer-2027-as-of-2027-04-10.csv')
    expect(
      requestsCsvName(
        requestView('all'),
        { program: null, pool: null, round: 2, tick: 'posted' },
        2027,
        null
      )
    ).toBe('camperships-requests-all-round-2-posted-2027.csv')
  })
})
