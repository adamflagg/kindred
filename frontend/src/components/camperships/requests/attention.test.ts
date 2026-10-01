import { describe, expect, it } from 'vitest'

import { attentionFor, attentionItems, codeWords, daysBetween, waitingSince } from './attention'
import { gridRow, roundOut, ROW_EMMA, ROW_LIAM, ROW_RILEY, ROW_SAMUEL } from './gridFixtures'

const TODAY = '2027-04-01'

describe('codeWords (Decision 7)', () => {
  it('names a known check, and puts an unknown one into words', () => {
    expect(codeWords('household_income_conflict')).toBe('Income conflict')
    expect(codeWords('some_new_check')).toBe('Some new check')
  })
})

describe('days', () => {
  it('counts whole camp days between two dates, read by their parts', () => {
    expect(daysBetween('2027-03-09', TODAY)).toBe(23)
    expect(daysBetween('2027-03-09T23:00:00Z', TODAY)).toBe(23)
    expect(daysBetween('not a date', TODAY)).toBeNull()
  })

  it("finds when the oldest posted, unaccepted round was posted (the server's _waiting_since)", () => {
    expect(waitingSince(ROW_SAMUEL)).toBe('2027-03-09')
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', { posted_on: '2027-03-09', accepted: true }),
        roundOut(2, 'posted', { posted_on: '2027-04-20' }),
      ],
    })
    expect(waitingSince(row)).toBe('2027-04-20')
    expect(waitingSince(ROW_EMMA)).toBeNull()
  })
})

describe('attentionFor (§4.4; D24, D31)', () => {
  it("puts a hold's words on its pill and the server's message beside it, with its next step", () => {
    expect(attentionFor(ROW_LIAM, 'all', TODAY)).toEqual({
      item: {
        level: 'hold',
        pill: 'Placeholder income',
        fact: 'Income was entered as $1, so no tier can be set. Call for the real figure and enter it as a correction.',
      },
      queue: 'holds',
      action: 'Enter income',
    })
  })

  it('shows a queue view its own item first, and All the first that matters', () => {
    expect(attentionFor(ROW_RILEY, 'all', TODAY)?.item.pill).toBe('Reverse posting')
    expect(attentionFor(ROW_RILEY, 'cancel_reason', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'Give a reason',
      fact: 'Cancelled: give a reason',
    })
    expect(attentionFor(ROW_SAMUEL, 'not_reconciled', TODAY)?.item.pill).toBe('short $210')
    expect(attentionFor(ROW_SAMUEL, 'waiting_on_family', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'Waiting 23 days',
      fact: "Posted Mar 9; the family hasn't replied. Follow up, then tick Accepted.",
    })
  })

  it("says how much CampMinder still holds on a request to reverse, from the ledger's own figure", () => {
    // The server's To reverse means live ledger lines remain: the amount is what CampMinder holds,
    // not the lock (Ruling 2026-10-01 (plan review), number-meaning fix 2).
    const short = {
      ...ROW_RILEY,
      confirmation: { ...ROW_RILEY.confirmation!, in_campminder: 1290 },
    }
    expect(attentionFor(short, 'to_reverse', TODAY)?.item.fact).toBe(
      'Cancelled Jun 2, but $1,290 is still live in CampMinder. Reverse it there; the row clears on the next sync.'
    )
    expect(attentionFor({ ...ROW_RILEY, confirmation: null }, 'to_reverse', TODAY)?.item.fact).toBe(
      'Cancelled Jun 2. Posted $1,500; reverse it in CampMinder. The row clears on the next sync.'
    )
  })

  it('names a Round 3 waiting on finance with its amount', () => {
    const row = gridRow({
      rounds: [roundOut(3, 'pending_approval', { pending_approval: 450 })],
      queues: ['pending_approval'],
    })
    expect(attentionFor(row, 'pending_approval', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'Pending approval',
      fact: "Round 3 $450 is above the registrar's limit: finance approves it from Today.",
    })
  })

  it('carries a server note as a note, and a row that needs nothing draws nothing', () => {
    const row = gridRow({
      notes: [
        {
          code: 'income_above',
          severity: 'warn',
          message: 'Income is above the season’s note figure.',
        },
      ],
    })
    expect(attentionItems(row, TODAY)).toEqual([
      {
        item: {
          level: 'note',
          pill: 'High income',
          fact: 'Income is above the season’s note figure.',
        },
        queue: null,
        action: null,
      },
    ])
    expect(attentionFor(ROW_EMMA, 'all', TODAY)).toBeNull()
  })

  it('says a confirmed request still waits on a payer share', () => {
    const row = gridRow({
      confirmation: {
        status: 'confirmed',
        locked: 1800,
        in_campminder: 900,
        gap: 0,
        on: '2027-03-10',
        reconciled: false,
        family_unplaced: 0,
        shares: [
          { household_cm_id: 1000001, expected: 900, in_campminder: 900, status: 'confirmed' },
          {
            household_cm_id: 1000003,
            expected: 900,
            in_campminder: 0,
            status: 'not_in_campminder',
          },
        ],
      },
      queues: ['not_reconciled'],
    })
    expect(attentionFor(row, 'not_reconciled', TODAY)?.item.pill).toBe('a share unconfirmed')
  })

  it('names a reversed lock as reversed, never as a share (M2)', () => {
    const row = gridRow({
      confirmation: {
        status: 'reversed',
        locked: 1500,
        in_campminder: 0,
        gap: -1500,
        on: '2027-06-03',
        reconciled: false,
        family_unplaced: 0,
        shares: [],
      },
      queues: ['not_reconciled'],
    })
    expect(attentionFor(row, 'not_reconciled', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'reversed',
      fact: 'CampMinder reversed the posting Jun 3; nothing of the $1,500 posted is live.',
    })
  })
})
