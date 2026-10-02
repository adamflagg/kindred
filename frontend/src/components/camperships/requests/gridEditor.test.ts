import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { appealTarget, LIVE_REQUEST_STATUSES } from './gridEditor'
import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_SAMUEL } from './gridFixtures'

// The shared contract: the pytest holds the write's own refusals (`_ask_refusal`) to it (I5).
const MIRRORS = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../tests/fixtures/camperships_frontend_mirrors.json'),
    'utf-8'
  )
) as { ask_refusals: Record<string, string>; live_request_statuses: string[] }
const WORDS = MIRRORS.ask_refusals
const LIVE_STATUSES_FIXTURE = MIRRORS.live_request_statuses

describe('appealTarget (Decision 13)', () => {
  it('opens the Round 2 ask once Round 1 is posted, on the ask already keyed', () => {
    expect(appealTarget(ROW_OLIVIA)).toEqual({ kind: 'appeal', initialAmount: 1200 })
    expect(appealTarget(ROW_SAMUEL)).toEqual({ kind: 'appeal', initialAmount: null })
  })

  it("says why in the server's own words when an appeal can't be keyed", () => {
    expect(appealTarget(ROW_EMMA)).toEqual({
      kind: 'none',
      why: 'An appeal answers a posted offer: tick Round 1 Posted first, or correct the Round 1 ask',
    })
    const r2Posted = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(2, 'posted', { ask: 900 })],
    })
    expect(appealTarget(r2Posted)).toEqual({
      kind: 'none',
      why: "Round 2 is posted; its ask can't change",
    })
    const cancelled = gridRow({
      rounds: [roundOut(1, 'posted')],
      cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' },
    })
    expect(appealTarget(cancelled)).toEqual({
      kind: 'none',
      why: 'Cancelled in Kindred: reopen it first',
    })
  })

  it("says each refusal in the write's own words, through the shared fixture", () => {
    expect(appealTarget(ROW_EMMA)).toEqual({ kind: 'none', why: WORDS['round1_not_posted'] })
    const r2 = gridRow({ rounds: [roundOut(1, 'posted'), roundOut(2, 'posted')] })
    expect(appealTarget(r2)).toEqual({ kind: 'none', why: WORDS['round2_posted'] })
    const r3 = gridRow({ rounds: [roundOut(1, 'posted'), roundOut(3, 'posted')] })
    expect(appealTarget(r3)).toEqual({ kind: 'none', why: WORDS['round3_posted'] })
    const cancelled = gridRow({
      cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' },
    })
    expect(appealTarget(cancelled)).toEqual({ kind: 'none', why: WORDS['cancelled_in_kindred'] })
  })

  it("gets no editor for a request that isn't live, and says why in the write's words", () => {
    for (const status of ['withdrawn', 'duplicate', 'duplicate_pending']) {
      const row = gridRow({ request_status: status, rounds: [roundOut(1, 'posted')] })
      expect(appealTarget(row)).toEqual({
        kind: 'none',
        why: (WORDS['not_live'] ?? '').replace('{status}', status),
      })
    }
  })

  it('keeps an editor for the statuses the server treats as live, through the shared fixture', () => {
    for (const status of LIVE_STATUSES_FIXTURE) {
      const row = gridRow({ request_status: status, rounds: [roundOut(1, 'posted')] })
      expect(appealTarget(row).kind).toBe('appeal')
    }
    expect([...LIVE_REQUEST_STATUSES].sort()).toEqual([...LIVE_STATUSES_FIXTURE].sort())
  })
})
