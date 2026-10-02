import { describe, expect, it } from 'vitest'

import {
  confirmationOut,
  GRID_ROWS,
  gridRow,
  roundOut,
  ROW_EMMA,
  ROW_LIAM,
  ROW_OLIVIA,
  ROW_RILEY,
  ROW_SAMUEL,
} from './gridFixtures'
import { shownView } from './strip'
import {
  CM_PENDING_WORD,
  cmChip,
  cmDetail,
  columnContext,
  confirmationChip,
  confirmationDetail,
  countWords,
  filterRows,
  footerWords,
  GRID_COLUMNS,
  isLiveRow,
  lastNameFirst,
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
  viewRound,
} from './views'

const TODAY = '2027-04-01'
const CTX = { view: 'all' as const, today: TODAY }
/** CM ✓'s width: its widest chip, "reversed", plus the cell's padding (measured at 1440, batch 4). */
const CM_WIDTH = 84

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

  it('gives All D27’s fifteen columns at their widths, about 1,510 px with the flexible one (Stage and Confirmed widened so no chip clips: sitting A, A2)', () => {
    const all = requestView('all')
    const keys = viewColumns(all, false, true)
    expect(keys.map((k) => GRID_COLUMNS[k].header)).toEqual([
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
      'CM ✓',
      'Requested by',
      'Needs attention',
    ])
    const fixed = keys.reduce((sum, k) => sum + (GRID_COLUMNS[k].width ?? 0), 0)
    // Family widened 110 → 130 now it is unpinned and truncated long names (integration ruling);
    // Requested by took its place and width (T3).
    expect(GRID_COLUMNS.requestedBy.width).toBe(130)
    // Batch 4 (owner rulings): CM ✓ is as wide as its widest one-word chip ("reversed"), and Needs
    // attention has no fixed width (it fits the chips on screen, measured), so Family takes the
    // spare width at 130 or more (Requested by since T3). Was: CM ✓ 90 and Needs attention flexible, 1,486 with it at 250.
    expect(GRID_COLUMNS.confirmed.width).toBe(CM_WIDTH)
    expect(GRID_COLUMNS.attention.width).toBeUndefined()
    expect(GRID_COLUMNS.attention.flex).toBeUndefined()
    expect(GRID_COLUMNS.requestedBy.flex).toBe(true)
    expect(fixed).toBe(1236 - 90 + CM_WIDTH)
  })

  // Batch 4 (owner LOCKED, grid-layout-options.html#or=i): Needs attention is frozen on the right,
  // as wide as the widest chip on screen plus 18px, never under 84px.
  it('freezes Needs attention on the right, fitted to its chips', () => {
    expect(GRID_COLUMNS.attention.pinnedRight).toBe(true)
    expect(GRID_COLUMNS.attention.fitContent).toEqual({ pad: 18, min: 84 })
    expect(GRID_COLUMNS.attention.pinned).toBeUndefined()
  })

  // #2994: the grid read says whether the season is ticked (`ticked_season`); no frontend mirror.
  it('drops CM ✓ when the season is not ticked, and keeps it when it is', () => {
    expect(viewColumns(requestView('all'), false, false)).not.toContain('confirmed')
    expect(viewColumns(requestView('all'), false, true)).toContain('confirmed')
    expect(viewColumns(requestView('not-reconciled'), false, false)).not.toContain('confirmed')
  })

  it('brings the id columns back with Show IDs: Person pinned after the Camper, Household beside Requested by (D27, T2, T3)', () => {
    const keys = viewColumns(requestView('holds'), true, true)
    expect(keys.slice(0, 2)).toEqual(['camper', 'personId'])
    expect(keys.slice(-3)).toEqual(['requestedBy', 'householdId', 'attention'])
    expect(GRID_COLUMNS.personId.pinned).toBe(true)
    expect(GRID_COLUMNS.camper.pinned).toBe(true)
    expect(GRID_COLUMNS.householdId.pinned).toBeUndefined()
    expect(GRID_COLUMNS.requestedBy.pinned).toBeUndefined()
  })

  // T3 (LOCKED): Requested by replaces Family; no view keeps a Family column.
  it('puts Requested by just left of Needs attention in every view, and no Family column (T3)', () => {
    for (const view of REQUEST_VIEWS) {
      const keys = viewColumns(view, false, true)
      expect(keys.at(-1)).toBe('attention')
      expect(keys.at(-2)).toBe('requestedBy')
      expect(keys[0]).toBe('camper')
      expect(keys.map((k) => GRID_COLUMNS[k].header)).not.toContain('Family')
    }
  })

  it('says the requester by name only, and sorts it by last name (T3)', () => {
    const spec = GRID_COLUMNS.requestedBy
    expect(spec.header).toBe('Requested by')
    expect(spec.value(gridRow({ requested_by: 'Ana Garcia' }), CTX)).toBe('Ana Garcia')
    expect(spec.value(gridRow({ requested_by: null }), CTX)).toBeNull()
    expect(lastNameFirst('Ana Garcia')).toBe('Garcia Ana')
    expect(lastNameFirst('Mary Ann de la Cruz')).toBe('Cruz Mary Ann de la')
    expect(lastNameFirst('Chen')).toBe('Chen')
    expect(lastNameFirst('  Sarah   Johnson ')).toBe('Johnson Sarah')
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

  it('keeps only rounds that count toward the budget, on the same round as round= and tick= (I5)', () => {
    const outside = {
      ...ROW_SAMUEL,
      request_id: 'reqoutside00001',
      rounds: [roundOut(1, 'posted', { posted: 900, counts_toward_budget: false })],
    }
    const rows = [...GRID_ROWS, outside]
    const ids = (filters: Partial<typeof NO_FILTERS>) =>
      filterRows(rows, 'all', { ...NO_FILTERS, ...filters }).map((r) => r.request_id)
    expect(ids({ tick: 'posted' })).toContain('reqoutside00001')
    expect(ids({ tick: 'posted', counted: true })).not.toContain('reqoutside00001')
    expect(ids({ round: 1, counted: true })).not.toContain('reqoutside00001')
    expect(ids({ counted: true })).toEqual(
      GRID_ROWS.filter((r) => r.rounds.some((x) => x.counts_toward_budget)).map((r) => r.request_id)
    )
  })

  it('binds counted to the round that puts a row in Needs an offer (final review I2)', () => {
    // Round 1 counts and is posted; Round 2, outside the budget, needs the offer.
    const outsideNeeds = gridRow({
      request_id: 'reqoutneeds0001',
      rounds: [
        roundOut(1, 'posted', { posted: 900 }),
        roundOut(2, 'needs_offer', { counts_toward_budget: false }),
      ],
      queues: ['needs_offer'],
    })
    // The reverse: Round 1 is outside the budget, the counted Round 2 needs the offer.
    const countedNeeds = gridRow({
      request_id: 'reqcntneeds0001',
      rounds: [
        roundOut(1, 'posted', { posted: 900, counts_toward_budget: false }),
        roundOut(2, 'needs_offer'),
      ],
      queues: ['needs_offer'],
    })
    const rows = [outsideNeeds, countedNeeds]
    const ids = (filters: Partial<typeof NO_FILTERS>) =>
      filterRows(rows, 'needs_offer', { ...NO_FILTERS, ...filters }).map((r) => r.request_id)
    expect(ids({})).toEqual(['reqoutneeds0001', 'reqcntneeds0001'])
    expect(ids({ counted: true })).toEqual(['reqcntneeds0001'])
    // round= binds to the same round as the view's status.
    expect(ids({ counted: true, round: 2 })).toEqual(['reqcntneeds0001'])
    expect(ids({ counted: true, round: 1 })).toEqual([])
  })

  it('binds counted to the round that puts a row in Pending approval (final review I2)', () => {
    const outsidePending = gridRow({
      request_id: 'reqoutpend00001',
      rounds: [
        roundOut(1, 'posted', { posted: 900 }),
        roundOut(3, 'pending_approval', { pending_approval: 450, counts_toward_budget: false }),
      ],
      queues: ['pending_approval'],
    })
    const countedPending = gridRow({
      request_id: 'reqcntpend00001',
      rounds: [
        roundOut(1, 'posted', { posted: 900, counts_toward_budget: false }),
        roundOut(3, 'pending_approval', { pending_approval: 450 }),
      ],
      queues: ['pending_approval'],
    })
    const rows = [outsidePending, countedPending]
    const ids = (filters: Partial<typeof NO_FILTERS>) =>
      filterRows(rows, 'pending_approval', { ...NO_FILTERS, ...filters }).map((r) => r.request_id)
    expect(ids({})).toEqual(['reqoutpend00001', 'reqcntpend00001'])
    expect(ids({ counted: true })).toEqual(['reqcntpend00001'])
  })

  it("keeps only live requests with live=1: the server's live statuses, not cancelled (owner, Decision 6(b))", () => {
    const withdrawn = { ...ROW_SAMUEL, request_id: 'reqwithdrawn001', request_status: 'withdrawn' }
    const cancelled = {
      ...ROW_SAMUEL,
      request_id: 'reqcancelled001',
      cancellation: {
        by: 'kindred' as const,
        on: '2027-03-01',
        reason: 'schedule' as const,
        note: '',
      },
    }
    const rows = [...GRID_ROWS, withdrawn, cancelled]
    const ids = filterRows(rows, 'all', { ...NO_FILTERS, live: true }).map((r) => r.request_id)
    expect(ids).not.toContain('reqwithdrawn001')
    expect(ids).not.toContain('reqcancelled001')
    expect(ids).toEqual(GRID_ROWS.filter(isLiveRow).map((r) => r.request_id))
    expect(ids).not.toContain('reqriley0000004')
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

  // Owner V1 (10-03), #2996: a share awaiting tonight's sync is no open share (the server's
  // UNRECONCILED is short, over and missing), and "Awaiting tonight's sync" heads no group.
  it("heads no group Awaiting tonight's sync: a share awaiting the sync is not the open one", () => {
    const share = (status: 'awaiting_sync' | 'over') => ({
      household_cm_id: 1000001,
      expected: 900,
      in_campminder: 900,
      status,
    })
    const row = gridRow({
      confirmation: confirmationOut({
        status: 'confirmed',
        reconciled: false,
        shares: [share('awaiting_sync'), share('over')],
      }),
      queues: ['not_reconciled'],
    })
    expect(reasonGroup(requestView('not-reconciled'), TODAY)(row).heading).toBe('Over')
  })

  // Owner ruling V1 (10-03): the Not reconciled group says what the pill says. Was "Not in CampMinder".
  it('heads a request missing in CampMinder "Missing in CM", as its pill does', () => {
    const missing = gridRow({
      confirmation: confirmationOut({
        status: 'not_in_campminder',
        locked: 1000,
        in_campminder: 0,
        reconciled: false,
      }),
      queues: ['not_reconciled'],
    })
    expect(reasonGroup(requestView('not-reconciled'), TODAY)(missing)).toEqual({
      id: 'Missing in CM',
      heading: 'Missing in CM',
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

describe('the needs-attention text by view (O1, O2)', () => {
  it('writes only the pill to the CSV when the text repeats it, with no trailing colon (O1)', () => {
    const row = gridRow({
      notes: [{ code: 'ask_above_cost', severity: 'warn', message: 'The ask is above the cost' }],
    })
    expect(GRID_COLUMNS.attention.value(row, { view: 'all', today: TODAY })).toBe('Ask above cost')
  })

  it('keeps the cancel date wherever the visible columns have no Cancelled on (O2)', () => {
    const view = (key: string) => requestView(key)
    const plain = view('to-reverse')
    expect(plain.columns).toContain('cancelledOn')
    expect(columnContext(plain, TODAY).cancelledOnShown).toBe(true)
    const appeals = shownView('appeals', plain)
    expect(appeals.key).toBe('to_reverse')
    expect(appeals.columns).not.toContain('cancelledOn')
    expect(columnContext(appeals, TODAY).cancelledOnShown).toBe(false)
    expect(columnContext(view('all'), TODAY).cancelledOnShown).toBe(false)
    const text = (v: typeof plain) =>
      String(GRID_COLUMNS.attention.value(ROW_RILEY, columnContext(v, TODAY)))
    expect(text(plain)).toMatch(/^Reverse posting: \$/)
    expect(text(appeals)).toMatch(/^Reverse posting: Cancelled Jun 2: /)
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

  it('names the Today line when one is active, so a partial list is not mistaken for the season (m2)', () => {
    const none = { program: null, pool: null, round: null, tick: null }
    const plain = requestsCsvName(requestView('all'), none, 2027, null)
    const today = requestsCsvName(requestView('all'), none, 2027, null, 'would_change')
    expect(today).toBe('camperships-requests-all-today-would-change-2027.csv')
    expect(today).not.toBe(plain)
  })
})

// Owner rulings (A2, batch 4): CM ✓'s cell is one word; the detail goes to the opened row's detail
// line and the CSV. The pending word is one constant (the owner may rename it).
describe('CM ✓ words and detail (batch 4)', () => {
  const c = confirmationOut
  it('names the pending word once', () => {
    expect(CM_PENDING_WORD).toBe('pending')
  })

  it('gives each state one word on its chip, no amount or date', () => {
    expect(confirmationChip(c({ status: 'confirmed', on: '2027-09-29' })).word).toBe('✓')
    expect(confirmationChip(c({ status: 'short', locked: 1500, in_campminder: 1450 })).word).toBe(
      'short'
    )
    expect(confirmationChip(c({ status: 'over', locked: 1500, in_campminder: 1550 })).word).toBe(
      'over'
    )
    expect(confirmationChip(c({ status: 'not_in_campminder' })).word).toBe('missing')
    expect(confirmationChip(c({ status: 'reversed', on: '2027-10-02' })).word).toBe('reversed')
    expect(confirmationChip(c({ status: 'awaiting_sync', on: null })).word).toBe(CM_PENDING_WORD)
  })

  it('spells out each state in full for the detail line and the CSV', () => {
    expect(confirmationDetail(c({ status: 'confirmed', on: '2027-09-29' }))).toBe(
      '✓ confirmed Sep 29'
    )
    expect(confirmationDetail(c({ status: 'confirmed', on: null }))).toBe('✓ confirmed')
    expect(confirmationDetail(c({ status: 'short', locked: 1500, in_campminder: 1450 }))).toBe(
      'CampMinder shows $1,450; short $50'
    )
    expect(confirmationDetail(c({ status: 'over', locked: 1500, in_campminder: 1550 }))).toBe(
      'CampMinder shows $1,550; over $50'
    )
    expect(confirmationDetail(c({ status: 'reversed', on: '2027-10-02' }))).toBe('reversed Oct 2')
    // #2996: the pending sentences are the server's (cm_pending_message); with none sent (a past
    // read), the word alone. Was "Ticked today; tonight's sync checks it." written here.
    expect(confirmationDetail(c({ status: 'awaiting_sync', on: null }))).toBe(CM_PENDING_WORD)
    expect(confirmationDetail(c({ status: 'not_in_campminder', locked: 1800, on: null }))).toBe(
      'Posted $1,800; the last sync found nothing in CampMinder for it.'
    )
  })

  it('writes the full detail to the CSV and the word as the value', () => {
    const row = gridRow({
      confirmation: c({ status: 'short', locked: 1500, in_campminder: 1450 }),
    })
    const ctx = { view: 'all' as const, today: TODAY }
    expect(GRID_COLUMNS.confirmed.value(row, ctx)).toBe('short')
    expect(GRID_COLUMNS.confirmed.csv?.(row, ctx)).toBe('CampMinder shows $1,450; short $50')
    expect(GRID_COLUMNS.confirmed.csv?.(gridRow(), ctx)).toBe('')
  })
})

// #2996: a C1 round (in CampMinder in full, tonight's tick posts it: `cm_pending`) waits on the family
// at once and is out of Needs an offer, as is a round the tick refused (`unticked`, Q1). The server's
// `queues` already say so; the per-round columns follow the same rounds.
describe('the round a view is about, after #2996', () => {
  const c1 = gridRow({
    rounds: [
      roundOut(1, 'needs_offer', { decided: 900, cm_pending: true }),
      roundOut(2, 'needs_offer', { ask: 500, decided: 400 }),
    ],
    queues: ['needs_offer', 'waiting_on_family'],
  })

  it('takes a C1 round as the one waiting on the family, with nothing posted yet in the footer', () => {
    expect(viewRound(c1, 'waiting_on_family')?.round).toBe(1)
    expect(
      GRID_COLUMNS.roundPosted.value(c1, { view: 'waiting_on_family', today: TODAY })
    ).toBeNull()
  })

  it('leaves a C1 round and a refused one out of Needs an offer', () => {
    expect(viewRound(c1, 'needs_offer')?.round).toBe(2)
    const refused = gridRow({
      rounds: [
        roundOut(1, 'needs_offer', { decided: 900 }),
        roundOut(2, 'needs_offer', { decided: 400 }),
      ],
      unticked: [
        {
          round: 1,
          code: 'short_posting',
          label: 'Short in CM',
          message: 'A sentence.',
          mark_posted: true,
        },
      ],
      queues: ['needs_offer', 'not_reconciled'],
    })
    expect(viewRound(refused, 'needs_offer')?.round).toBe(2)
  })
})

// #2996: a round's CampMinder check is pending in two cases, both sent as rounds[].cm_pending with the
// server's own sentence (cm_pending_message): C1 (in CampMinder in full, tonight's tick posts it) and
// V1 (ticked by hand today, tonight's sync checks it). CM ✓ says the pending word; the detail line and
// the CSV say the server's sentence, never a copy.
describe('CM ✓ pending (#2996)', () => {
  const ctx = { view: 'all' as const, today: TODAY }
  const C1_TEXT = 'Server sentence for a C1 round.'
  const V1_TEXT = 'Server sentence for a V1 round.'
  const c1 = gridRow({
    rounds: [
      roundOut(1, 'needs_offer', { decided: 900, cm_pending: true, cm_pending_message: C1_TEXT }),
    ],
    confirmation: null,
    queues: ['waiting_on_family'],
  })
  const v1 = gridRow({
    rounds: [
      roundOut(1, 'posted', {
        decided: 900,
        posted: 900,
        posted_on: '2027-04-01',
        cm_pending: true,
        cm_pending_message: V1_TEXT,
      }),
    ],
    confirmation: confirmationOut({ status: 'awaiting_sync', on: null, locked: 900 }),
    queues: ['waiting_on_family'],
  })

  it('says the pending word on the chip for a C1 round, which has no confirmation yet', () => {
    expect(GRID_COLUMNS.confirmed.value(c1, ctx)).toBe(CM_PENDING_WORD)
    expect(cmChip(c1)).toEqual({ word: CM_PENDING_WORD, tone: 'muted' })
  })

  it("writes the server's own sentence to the detail and the CSV, for C1 and V1 alike", () => {
    expect(cmDetail(c1)).toBe(C1_TEXT)
    expect(GRID_COLUMNS.confirmed.csv?.(c1, ctx)).toBe(C1_TEXT)
    expect(GRID_COLUMNS.confirmed.value(v1, ctx)).toBe(CM_PENDING_WORD)
    expect(cmDetail(v1)).toBe(V1_TEXT)
    expect(GRID_COLUMNS.confirmed.csv?.(v1, ctx)).toBe(V1_TEXT)
  })

  it('reads the confirmation as before when no round is pending', () => {
    const short = gridRow({
      confirmation: confirmationOut({ status: 'short', locked: 1500, in_campminder: 1450 }),
    })
    expect(cmChip(short)?.word).toBe('short')
    expect(cmDetail(short)).toBe('CampMinder shows $1,450; short $50')
    expect(cmChip(gridRow())).toBeNull()
    expect(cmDetail(gridRow())).toBeNull()
  })
})

describe('Not reconciled groups for money with no Posted tick (#2996)', () => {
  it("heads the group by the server's pill when the confirmation itself is reconciled", () => {
    const row = gridRow({
      confirmation: confirmationOut({ status: 'confirmed', reconciled: true }),
      unticked: [
        {
          round: 2,
          code: 'withheld',
          label: 'Changed after posting',
          message: 'A sentence.',
          mark_posted: true,
        },
      ],
      queues: ['not_reconciled'],
    })
    expect(reasonGroup(requestView('not-reconciled'), TODAY)(row)).toEqual({
      id: 'Changed after posting',
      heading: 'Changed after posting',
    })
  })
})

describe('the Tick column (Decision 8, 15)', () => {
  it('shows only for someone who can tick, and only on Waiting on the family (Posted is not ticked here)', () => {
    expect(viewColumns(requestView('needs-offer'), false, true, true)).not.toContain('tick')
    expect(viewColumns(requestView('waiting'), false, true, true)).toContain('tick')
    expect(viewColumns(requestView('waiting'), false, true, false)).not.toContain('tick')
    expect(viewColumns(requestView('all'), false, true, true)).not.toContain('tick')
  })

  it('stays out of Download CSV: a button has nothing to export (M16; build ruling 3)', () => {
    expect(GRID_COLUMNS.tick.inCsv).toBe(false)
  })
})

describe("Needs an offer's new total (⚠ Decision 40, ruled)", () => {
  const CTX = { view: 'needs_offer', today: '2027-04-01' } as const

  it("shows the request's new total beside a Round 2 or 3 amount, and nothing on a Round 1 row", () => {
    expect(viewColumns(requestView('needs-offer'), false, true, true)).toEqual(
      expect.arrayContaining(['decided', 'newTotal'])
    )
    expect(GRID_COLUMNS.newTotal.value(ROW_OLIVIA, CTX)).toBe(2200)
    expect(GRID_COLUMNS.newTotal.value(ROW_EMMA, CTX)).toBeNull()
  })

  // Owner ruling 2026-10-02: New total includes clawed-back rounds (a reversal mid-appeal before the
  // repost syncs). CampMinder then holds $0 for the request, so the figure to type is R1 + R2, which
  // is the server's total_decided as it stands.
  it("includes a clawed-back Round 1 in the new total: it is the server's total_decided", () => {
    const reversed = gridRow({
      request_id: 'reqreversed0001',
      rounds: [
        roundOut(1, 'posted', { decided: 1000, posted: 1000, clawed_back: true }),
        roundOut(2, 'needs_offer', { decided: 500 }),
      ],
      total_decided: 1500,
    })
    expect(GRID_COLUMNS.newTotal.value(reversed, CTX)).toBe(1500)
  })
})
