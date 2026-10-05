import { describe, expect, it } from 'vitest'

import {
  CANCEL_REASON_OPTIONS,
  REASON_POLICY,
  choiceProblem,
  initialReason,
  parseMoneyInput,
  reasonMissing,
} from './editor'

describe('parseMoneyInput', () => {
  it.each([
    ['1200', 1200],
    ['1,200', 1200],
    ['$1,200.50', 1200.5],
    ['  $ 900 ', 900],
    ['0', 0],
  ])('reads %j as %s', (raw, amount) => {
    expect(parseMoneyInput(raw)).toEqual({ kind: 'ok', amount })
  })

  it('is empty when nothing is typed, or only a dollar sign is', () => {
    expect(parseMoneyInput('  ')).toEqual({ kind: 'empty' })
    expect(parseMoneyInput('$')).toEqual({ kind: 'empty' })
  })

  it('takes commas only as thousands groups', () => {
    expect(parseMoneyInput('1,000,000')).toEqual({ kind: 'ok', amount: 1_000_000 })
    expect(parseMoneyInput('999,999.99')).toEqual({ kind: 'ok', amount: 999999.99 })
  })

  it.each([
    ['-5', 'Not an amount'],
    ['twelve', 'Not an amount'],
    ['12.345', 'Cents go to two places'],
    ['1000001', 'More than $1,000,000'],
    ['1,2,3', 'Not an amount'],
    ['12,50', 'Not an amount'],
    ['1.2,5', 'Not an amount'],
    [',', 'Not an amount'],
  ])('refuses %j: %s', (raw, reason) => {
    expect(parseMoneyInput(raw)).toEqual({ kind: 'invalid', reason })
  })
})

describe('the reason policy (D22)', () => {
  it('pre-fills an appeal note with the day the family emailed', () => {
    expect(initialReason(REASON_POLICY.appeal_ask, '2027-04-09')).toBe('Family emailed (Apr 9)')
  })

  it('requires a statement of need for Round 3, and a reason for holds', () => {
    for (const kind of ['round3_ask', 'hold'] as const) {
      expect(REASON_POLICY[kind].kind).toBe('required')
    }
    expect(REASON_POLICY.round3_ask).toEqual({
      kind: 'required',
      label: 'Statement of need',
      maxLength: 4000,
    })
  })

  // B30, owner ruling 10-05: an income correction's reason is optional (#3019 made the server's
  // CorrectionCreate.reason optional too). It starts blank: no pre-filled note.
  it("leaves an income correction's reason optional and blank", () => {
    expect(REASON_POLICY.income_correction.kind).toBe('optional')
    expect(REASON_POLICY.income_correction.label).toBe('Reason')
    expect(initialReason(REASON_POLICY.income_correction, '2027-04-09')).toBe('')
    expect(reasonMissing(REASON_POLICY.income_correction, '  ')).toBe(false)
  })

  it('asks no reason for stage moves and ticks: who and when are logged', () => {
    expect(REASON_POLICY.stage_move.kind).toBe('none')
    expect(REASON_POLICY.tick.kind).toBe('none')
  })

  // The server's limits: a statement of need is 4000 (`_Statement`), a note or reason 2000.
  it('limits the reason field to what the server accepts', () => {
    expect(REASON_POLICY.round3_ask).toMatchObject({ maxLength: 4000 })
    for (const kind of ['appeal_ask', 'round3_amount', 'income_correction', 'hold'] as const) {
      expect(REASON_POLICY[kind]).toMatchObject({ maxLength: 2000 })
    }
  })

  it('treats a blank required reason as missing, and an optional one as fine', () => {
    expect(reasonMissing(REASON_POLICY.hold, '  ')).toBe(true)
    expect(reasonMissing(REASON_POLICY.hold, 'Waiting on a tax return')).toBe(false)
    expect(reasonMissing(REASON_POLICY.appeal_ask, '')).toBe(false)
  })

  // Ruling 2026-10-01 (plan review), finding 5: no reason-code list exists yet
  // (HeadcountSet.reason is free text; there is no cost-override write), so slice 1 decides.
  it('leaves cost overrides and headcounts to slice 1', () => {
    expect(Object.keys(REASON_POLICY)).not.toContain('cost_override')
    expect(Object.keys(REASON_POLICY)).not.toContain('headcount')
  })
})

describe('the cancel reason (D101 as amended by D141; finding 5)', () => {
  it("offers the server's nine reasons, worded as spec §6.3 shows them", () => {
    expect(CANCEL_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'aid_not_enough',
      'medical',
      'schedule',
      'not_ready',
      'did_not_want_to_appeal',
      'not_financially_related',
      'early_cancel',
      'another_reason',
      'not_known',
    ])
    expect(CANCEL_REASON_OPTIONS[0]?.label).toBe('declined: aid not enough / financial constraints')
    expect(REASON_POLICY.cancel.kind).toBe('choice')
  })

  it('needs a reason picked, and a note only for "another reason"', () => {
    expect(choiceProblem(REASON_POLICY.cancel, null, '')).toBe('Pick a cancel reason')
    expect(choiceProblem(REASON_POLICY.cancel, 'bogus', '')).toBe('Pick a cancel reason')
    expect(choiceProblem(REASON_POLICY.cancel, 'medical', '')).toBeNull()
    expect(choiceProblem(REASON_POLICY.cancel, 'another_reason', ' ')).toBe(
      '"another reason" needs a note'
    )
    expect(choiceProblem(REASON_POLICY.cancel, 'another_reason', 'Moved away')).toBeNull()
  })
})
