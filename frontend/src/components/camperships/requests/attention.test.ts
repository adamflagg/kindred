import { describe, expect, it } from 'vitest'

import { attentionFor, attentionItems, codeWords, daysBetween, waitingSince } from './attention'
import { gridRow, roundOut, ROW_EMMA, ROW_LIAM, ROW_RILEY, ROW_SAMUEL } from './gridFixtures'

const TODAY = '2027-04-01'

describe('codeWords (Decision 7)', () => {
  it('names a known check, and puts an unknown one into words', () => {
    expect(codeWords('household_income_conflict')).toBe('Income conflict')
    expect(codeWords('some_new_check')).toBe('Some new check')
  })

  it('has real words, not code words, for every pill that read as one', () => {
    expect(codeWords('in_campminder_not_ticked')).toBe('Mark posted')
    expect(codeWords('no_round1_table')).toBe('No Round 1 table')
    expect(codeWords('round3_not_allowed')).toBe('No Round 3')
    expect(codeWords('round3_not_eligible')).toBe('Round 3 not eligible')
    expect(codeWords('r2_cap_negative')).toBe('Round 2 cap')
    expect(codeWords('unknown_override_reason')).toBe('Unknown reason')
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
      fact: 'No reason recorded',
    })
    expect(attentionFor(ROW_SAMUEL, 'not_reconciled', TODAY)?.item.pill).toBe('short $210')
    expect(attentionFor(ROW_SAMUEL, 'waiting_on_family', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'Waiting 23 days',
      fact: "The family hasn't replied: follow up, then tick Accepted.",
    })
  })

  it('says "day" for one day and "days" otherwise on the waiting pill', () => {
    expect(attentionFor(ROW_SAMUEL, 'waiting_on_family', '2027-03-10')?.item.pill).toBe(
      'Waiting 1 day'
    )
    expect(attentionFor(ROW_SAMUEL, 'waiting_on_family', '2027-03-11')?.item.pill).toBe(
      'Waiting 2 days'
    )
  })

  it("says how much CampMinder still holds on a request to reverse, from the ledger's own figure", () => {
    // The server's To reverse means live ledger lines remain: the amount is what CampMinder holds,
    // not the lock (Ruling 2026-10-01 (plan review), number-meaning fix 2).
    const short = {
      ...ROW_RILEY,
      confirmation: { ...ROW_RILEY.confirmation!, in_campminder: 1290 },
    }
    expect(attentionFor(short, 'to_reverse', TODAY, true)?.item.fact).toBe(
      '$1,290 still live in CampMinder: reverse it there; the row clears on the next sync.'
    )
    expect(
      attentionFor({ ...ROW_RILEY, confirmation: null }, 'to_reverse', TODAY, true)?.item.fact
    ).toBe('Reverse the posting in CampMinder; the row clears on the next sync.')
  })

  it('keeps the cancel date on the line where the visible columns have no Cancelled on (O2)', () => {
    const short = {
      ...ROW_RILEY,
      confirmation: { ...ROW_RILEY.confirmation!, in_campminder: 1290 },
    }
    expect(attentionFor(short, 'to_reverse', TODAY, false)?.item.fact).toBe(
      'Cancelled Jun 2: $1,290 still live in CampMinder: reverse it there; the row clears on the next sync.'
    )
    expect(attentionFor(short, 'all', TODAY)?.item.fact).toMatch(/^Cancelled Jun 2: /)
    expect(attentionFor({ ...ROW_RILEY, confirmation: null }, 'all', TODAY, false)?.item.fact).toBe(
      'Cancelled Jun 2: Reverse the posting in CampMinder; the row clears on the next sync.'
    )
  })

  it('leads a withdrawn or duplicate request to reverse with that word in every view, never Cancelled (F1a/F1b)', () => {
    for (const [status, word] of [
      ['withdrawn', 'Withdrawn'],
      ['duplicate', 'Duplicate'],
    ] as const) {
      const live = { ...ROW_RILEY, request_status: status, cancellation: null }
      const none = { ...live, confirmation: null }
      for (const shown of [true, false]) {
        expect(attentionFor(live, 'to_reverse', TODAY, shown)?.item.fact).toBe(
          `${word}: $1,500 still live in CampMinder: reverse it there; the row clears on the next sync.`
        )
        expect(attentionFor(none, 'to_reverse', TODAY, shown)?.item.fact).toBe(
          `${word}: Reverse the posting in CampMinder; the row clears on the next sync.`
        )
      }
    }
  })

  it('names a Round 3 waiting on finance with its amount', () => {
    const row = gridRow({
      rounds: [roundOut(3, 'pending_approval', { pending_approval: 450 })],
      queues: ['pending_approval'],
    })
    expect(attentionFor(row, 'pending_approval', TODAY)?.item).toEqual({
      level: 'note',
      pill: 'Pending approval',
      fact: "R3 $450 is above the registrar's limit: finance approves it from Today.",
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

  it('draws no text for a reversed lock: it is always reconciled, and would print $0 (F6e)', () => {
    const row = gridRow({
      confirmation: {
        status: 'reversed',
        locked: 0,
        in_campminder: 0,
        gap: 0,
        on: '2027-06-03',
        reconciled: false,
        family_unplaced: 0,
        shares: [],
      },
      queues: ['not_reconciled'],
    })
    expect(attentionFor(row, 'not_reconciled', TODAY)).toBeNull()
  })

  it('words the reconciliation facts without repeating the Posted column or the pill (F6a, F6b, F6d)', () => {
    const base = ROW_SAMUEL.confirmation!
    const short = attentionFor(ROW_SAMUEL, 'not_reconciled', TODAY)?.item
    expect(short?.fact).toMatch(/^CampMinder shows \$[\d,]+\.$/)
    const missing = gridRow({
      confirmation: {
        ...base,
        status: 'not_in_campminder',
        in_campminder: 0,
        gap: -1000,
        locked: 1000,
        reconciled: false,
      },
      queues: ['not_reconciled'],
    })
    expect(attentionFor(missing, 'not_reconciled', TODAY)?.item.fact).toBe(
      'Posted $1,000; the last sync found nothing for it.'
    )
  })

  it('words the payer-share fact as a to-do, not as a repeat of the pill (F6d)', () => {
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
          { household_cm_id: 1, expected: 900, in_campminder: 0, status: 'not_in_campminder' },
        ],
      },
      queues: ['not_reconciled'],
    })
    expect(attentionFor(row, 'not_reconciled', TODAY)?.item.fact).toBe(
      'Check the payer shares on the household page.'
    )
  })

  it('words the queue items that repeated their pill (F2, F4, F5)', () => {
    const unsettled = gridRow({
      request_status: 'unmatched_session',
      queues: ['session_not_settled'],
    })
    expect(attentionFor(unsettled, 'session_not_settled', TODAY)?.item.fact).toBe(
      'Resolve it on the household page.'
    )
    const dup = gridRow({
      request_status: 'duplicate_pending',
      camper_name: 'Emma Lee',
      queues: ['duplicates'],
    })
    expect(attentionFor(dup, 'duplicates', TODAY)?.item.fact).toBe(
      'Same camper and session as another request: keep one on the household page.'
    )
    expect(attentionFor({ ...dup, camper_name: '' }, 'duplicates', TODAY)?.item.fact).toBe(
      'Same family and session as another request: keep one on the household page.'
    )
  })

  it('shows just the pill when a server text only repeats it, in the grid only (O1)', () => {
    const row = gridRow({
      notes: [
        { code: 'ask_above_cost', severity: 'warn', message: 'The ask is above the cost' },
        { code: 'income_above', severity: 'warn', message: 'Adjusted income is above $150,000' },
      ],
    })
    const [first, second] = attentionItems(row, TODAY)
    expect(first?.item).toEqual({ level: 'note', pill: 'Ask above cost', fact: '' })
    expect(second?.item.fact).toBe('Adjusted income is above $150,000')
  })
})
