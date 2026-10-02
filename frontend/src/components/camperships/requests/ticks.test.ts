import { describe, expect, it } from 'vitest'

import {
  gridRow,
  roundOut,
  ROW_EMMA,
  ROW_LIAM,
  ROW_OLIVIA,
  ROW_RILEY,
  ROW_SAMUEL,
} from './gridFixtures'
import { acceptedTarget, doneWords, postedTarget, tickPlan, tickWords } from './ticks'

describe('which round a tick sets (§13; Decision 15)', () => {
  it('ticks Posted on the lowest round that needs an offer, at its decided amount', () => {
    expect(postedTarget(ROW_EMMA)).toEqual({ round: 1, amount: 1420 })
    expect(postedTarget(ROW_OLIVIA)).toEqual({ round: 2, amount: 780 })
    expect(postedTarget(ROW_LIAM)).toBeNull()
  })

  it('ticks Accepted on the lowest posted round the family has not accepted', () => {
    expect(acceptedTarget(ROW_SAMUEL)).toEqual({ round: 1 })
    expect(acceptedTarget(ROW_OLIVIA)).toBeNull()
    // CampMinder's cancellation still takes the tick; Kindred's own refuses it (the server's rule).
    expect(acceptedTarget(ROW_RILEY)).toEqual({ round: 1 })
  })

  it('ticks nothing on a request cancelled in Kindred', () => {
    const cancelled = gridRow({
      cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' },
    })
    expect(postedTarget(cancelled)).toBeNull()
    expect(
      acceptedTarget({ ...ROW_SAMUEL, cancellation: cancelled.cancellation ?? null })
    ).toBeNull()
  })

  it('never ticks Accepted on a round whose money CampMinder reversed', () => {
    const clawed = gridRow({
      rounds: [roundOut(1, 'posted', { decided: 900, posted: 900, clawed_back: true })],
    })
    expect(acceptedTarget(clawed)).toBeNull()
  })
})

describe('tickPlan (§4.10; Decision 17)', () => {
  it('counts requests and families, totals what it locks to the cent, and names what it leaves out', () => {
    const plan = tickPlan([ROW_EMMA, ROW_OLIVIA, ROW_LIAM], 'posted')
    expect(plan.rows.map((r) => [r.requestId, r.round, r.amount])).toEqual([
      ['reqemma00000001', 1, 1420],
      ['reqolivia000003', 2, 780],
    ])
    expect(plan.families).toBe(2)
    expect(plan.total).toBe(2200)
    expect(plan.skipped).toEqual(['Liam Garcia'])
    const cents = tickPlan(
      [
        gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 0.1 })] }),
        gridRow({
          request_id: 'reqother0000099',
          rounds: [roundOut(1, 'needs_offer', { decided: 0.2 })],
        }),
      ],
      'posted'
    )
    expect(cents.total).toBe(0.3)
  })

  it('words the confirmation and the result', () => {
    expect(tickWords(tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted'))).toBe(
      'Tick Posted on 2 requests · 2 families · $2,200 locked'
    )
    expect(tickWords(tickPlan([ROW_SAMUEL], 'accepted'))).toBe(
      'Tick Accepted on 1 request · 1 family'
    )
    expect(
      doneWords('posted', {
        year: 2027,
        written: 2,
        unchanged: 1,
        operation_id: 'op1',
        total_locked: 2200,
      })
    ).toBe('Ticked Posted on 2 requests · $2,200 locked (1 was already ticked)')
    expect(
      doneWords('accepted', { year: 2027, written: 1, unchanged: 0, operation_id: 'op2' })
    ).toBe('Ticked Accepted on 1 request')
  })
})

describe('a Posted tick the server would refuse (fix round: M4, M7, M8, M6, M1)', () => {
  const EARLIER_UNPOSTED = gridRow({
    request_id: 'reqearlier00001',
    camper_name: 'Samuel Johnson',
    rounds: [
      roundOut(1, 'pending_approval', { ask: 2000 }),
      roundOut(2, 'needs_offer', { ask: 900, decided: 700 }),
    ],
  })

  it('skips a row whose earlier round is not posted, with the reason, as the server would refuse it', () => {
    expect(postedTarget(EARLIER_UNPOSTED)).toBeNull()
    const plan = tickPlan([ROW_EMMA, EARLIER_UNPOSTED], 'posted')
    expect(plan.rows.map((r) => r.requestId)).toEqual(['reqemma00000001'])
    expect(plan.blocked).toEqual([{ label: 'Samuel Johnson', why: "Round 1 isn't posted yet" }])
  })

  it('ticks a later round once the earlier ones are posted', () => {
    expect(postedTarget(ROW_OLIVIA)).toEqual({ round: 2, amount: 780 })
  })

  it('tells two requests of one camper apart by session, and leaves a unique name plain', () => {
    const second = gridRow({ request_id: 'reqemma00000002', session_name: 'Session 3' })
    const plan = tickPlan([ROW_EMMA, second, ROW_OLIVIA], 'posted')
    expect(plan.rows.map((r) => r.label)).toEqual([
      'Emma Johnson (Session 2)',
      'Emma Johnson (Session 3)',
      'Olivia Chen',
    ])
  })

  it('marks the rows a search, view or filter hides', () => {
    const plan = tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted', new Set(['reqemma00000001']))
    expect(plan.rows.map((r) => [r.label, r.hidden])).toEqual([
      ['Emma Johnson', true],
      ['Olivia Chen', false],
    ])
  })

  it('says in plain words which rules sections the server did not lock, and that nothing changed when all were ticked', () => {
    expect(
      doneWords('posted', {
        year: 2027,
        written: 1,
        unchanged: 0,
        operation_id: 'op1',
        total_locked: 1420,
        sections_not_locked: ['income', 'award_tables'],
      })
    ).toBe(
      'Ticked Posted on 1 request · $1,420 locked · rules not locked yet: income, award tables'
    )
    expect(doneWords('posted', { year: 2027, written: 0, unchanged: 2, operation_id: '' })).toBe(
      'Nothing changed: 2 were already ticked'
    )
  })
})

describe("an appeal line's new total (PR 4 review I2; ⚠ Decision 40)", () => {
  it('carries the request total_decided on a Round 2 or 3 Posted row, and nothing on Round 1', () => {
    const plan = tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')
    expect(plan.rows.map((r) => (r.action === 'posted' ? r.newTotal : 'n/a'))).toEqual([null, 2200])
  })
})
