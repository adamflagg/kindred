import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { appealTarget, LIVE_REQUEST_STATUSES } from './gridEditor'
import {
  APPEAL_REFUSAL_R1,
  gridRow,
  roundOut,
  ROW_EMMA,
  ROW_OLIVIA,
  ROW_SAMUEL,
} from './gridFixtures'

// The shared contract: the pytest holds the write's own live set (`_LIVE`) to it (I5).
const MIRRORS = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../tests/fixtures/camperships_frontend_mirrors.json'),
    'utf-8'
  )
) as { live_request_statuses: string[] }

// #2997: the row carries the write's own refusal (`appeal_refusal`), so the frontend keeps no copy of
// the refusal rules or their words. Replaces the tests that held a frontend mirror of `_ask_refusal`
// to the fixture's `ask_refusals` (owner wording, D162).
describe('appealTarget (Decision 13; #2997)', () => {
  it('opens the Round 2 ask when the server names no refusal, on the ask already keyed', () => {
    expect(appealTarget(ROW_OLIVIA)).toEqual({ kind: 'appeal', initialAmount: 1200 })
    expect(appealTarget(ROW_SAMUEL)).toEqual({ kind: 'appeal', initialAmount: null })
  })

  it("says the server's own refusal, verbatim", () => {
    expect(appealTarget(ROW_EMMA)).toEqual({ kind: 'none', why: APPEAL_REFUSAL_R1 })
    expect(APPEAL_REFUSAL_R1).toBe(
      "Round 1 needs to show as posted before you can start an appeal. Once it's posted in CampMinder, this updates overnight. If it's waiting under Not reconciled, mark it posted there. If you meant to fix the original request, edit the Round 1 ask instead."
    )
    const cancelled = gridRow({
      rounds: [roundOut(1, 'posted')],
      appeal_refusal: 'Cancelled in the dashboard: reopen it first',
    })
    expect(appealTarget(cancelled)).toEqual({
      kind: 'none',
      why: 'Cancelled in the dashboard: reopen it first',
    })
  })

  it('works out no refusal of its own: the rounds alone never close the editor', () => {
    const r2Posted = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(2, 'posted', { ask: 900 })],
      appeal_refusal: null,
    })
    expect(appealTarget(r2Posted)).toEqual({ kind: 'appeal', initialAmount: 900 })
    const withdrawn = gridRow({ request_status: 'withdrawn', appeal_refusal: null })
    expect(appealTarget(withdrawn).kind).toBe('appeal')
  })

  it('keeps the live statuses to the shared fixture (the household page reads them)', () => {
    expect([...LIVE_REQUEST_STATUSES].sort()).toEqual([...MIRRORS.live_request_statuses].sort())
  })
})
