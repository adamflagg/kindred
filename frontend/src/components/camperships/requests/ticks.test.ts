import { describe, expect, it } from 'vitest'

import { gridRow, roundOut, ROW_LIAM, ROW_OLIVIA, ROW_RILEY, ROW_SAMUEL } from './gridFixtures'
import * as ticks from './ticks'
import { acceptedTarget, doneWords, hiddenTicks, tickPlan, tickWords } from './ticks'

describe('which round a tick sets (§13; Decision 15)', () => {
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
    expect(
      acceptedTarget({ ...ROW_SAMUEL, cancellation: cancelled.cancellation ?? null })
    ).toBeNull()
  })

  // #2996 (owner 10-03): Mark accepted is allowed the same day on a C1 round (CampMinder covers it
  // in full; tonight's tick posts it), which waits on the family at once. A round merely needing an
  // offer still takes no Accepted tick.
  it('ticks Accepted on a C1 round before tonight posts it, and not on a plain needs-offer round', () => {
    const c1 = gridRow({
      rounds: [roundOut(1, 'needs_offer', { decided: 900, cm_pending: true })],
      queues: ['waiting_on_family'],
    })
    expect(acceptedTarget(c1)).toEqual({ round: 1 })
    const offer = gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 900 })] })
    expect(acceptedTarget(offer)).toBeNull()
  })

  it('never ticks Accepted on a round whose money CampMinder reversed', () => {
    const clawed = gridRow({
      rounds: [roundOut(1, 'posted', { decided: 900, posted: 900, clawed_back: true })],
    })
    expect(acceptedTarget(clawed)).toBeNull()
  })

  it('has no Posted tick to compute: the grid ticks Accepted only', () => {
    expect('postedTarget' in ticks).toBe(false)
    expect('postedBlock' in ticks).toBe(false)
  })
})

describe('tickPlan (§4.10; Decision 17)', () => {
  it('counts requests and families, and names what it leaves out', () => {
    const plan = tickPlan([ROW_SAMUEL, ROW_RILEY, ROW_LIAM], 'accepted')
    expect(plan.rows.map((r) => [r.requestId, r.round])).toEqual([
      ['reqsamuel000005', 1],
      ['reqriley0000004', 1],
    ])
    expect(plan.families).toBe(2)
    expect(plan.skipped).toEqual(['Liam Garcia'])
  })

  it('words the confirmation and the result', () => {
    expect(tickWords(tickPlan([ROW_SAMUEL], 'accepted'))).toBe(
      'Tick Accepted on 1 request · 1 family'
    )
    expect(doneWords({ year: 2027, written: 1, unchanged: 0, operation_id: 'op2' })).toBe(
      'Ticked Accepted on 1 request'
    )
    expect(doneWords({ year: 2027, written: 2, unchanged: 1, operation_id: 'op3' })).toBe(
      'Ticked Accepted on 2 requests (1 was already ticked)'
    )
    expect(doneWords({ year: 2027, written: 0, unchanged: 2, operation_id: '' })).toBe(
      'Nothing changed: 2 were already ticked'
    )
  })

  it('tells two requests of one camper apart by session, and leaves a unique name plain', () => {
    const second = { ...ROW_SAMUEL, request_id: 'reqsamuel000006', session_name: 'Session 4' }
    const plan = tickPlan([ROW_SAMUEL, second, ROW_RILEY], 'accepted')
    expect(plan.rows.map((r) => r.label)).toEqual([
      'Samuel Johnson (Session 3)',
      'Samuel Johnson (Session 4)',
      'Riley Sam',
    ])
  })

  it('marks the rows a search, view or filter hides', () => {
    const plan = tickPlan([ROW_SAMUEL, ROW_RILEY], 'accepted', new Set(['reqsamuel000005']))
    expect(plan.rows.map((r) => [r.label, r.hidden])).toEqual([
      ['Samuel Johnson', true],
      ['Riley Sam', false],
    ])
  })
})

describe('hiddenTicks (PR 4 review M4)', () => {
  const ticked = ['a', 'b', 'c']

  it('counts a tick the search or the page hides, and none that both let through', () => {
    expect([...hiddenTicks(ticked, new Set(['a', 'b']), new Set(['a', 'b', 'c']))]).toEqual(['c'])
    expect([...hiddenTicks(ticked, null, new Set(['a']))]).toEqual(['b', 'c'])
  })

  it("never trusts the table's matching set past the page's own: a row the view just hid is hidden at once", () => {
    // `matching` still holds the previous view's keys for one render after a view or filter change.
    expect([...hiddenTicks(ticked, new Set(['a', 'b', 'c']), new Set(['a']))]).toEqual(['b', 'c'])
  })

  it('counts a row hidden by both the search and a filter once', () => {
    expect([...hiddenTicks(['a'], new Set(), new Set())]).toEqual(['a'])
  })
})
