import { describe, expect, it } from 'vitest'

import {
  attentionFor,
  attentionItems,
  codeWords,
  daysBetween,
  OPEN_REQUEST,
  waitingSince,
} from './attention'
import {
  confirmationOut,
  gridRow,
  roundOut,
  ROW_EMMA,
  ROW_LIAM,
  ROW_RILEY,
  ROW_SAMUEL,
} from './gridFixtures'

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
      next: { kind: 'link', label: 'Enter the Income', at: 'income' },
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

  // #2996 C1: a round CampMinder covers in full waits on the family at once, before tonight's tick
  // gives it a posting date. It still says why it is in Waiting, with no day count to give.
  it('says a C1 round is waiting on the family though it has no posting date yet', () => {
    const c1 = gridRow({
      rounds: [roundOut(1, 'needs_offer', { decided: 900, cm_pending: true })],
      queues: ['waiting_on_family'],
    })
    expect(attentionFor(c1, 'waiting_on_family', TODAY)).toEqual({
      item: {
        level: 'note',
        pill: 'Waiting on the family',
        fact: "The family hasn't replied: follow up, then tick Accepted.",
      },
      queue: 'waiting_on_family',
      next: null,
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
        next: OPEN_REQUEST,
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
    // Owner ruling V1 (10-03): one vocabulary with the back end's "Short in CM". Was "not in CampMinder".
    expect(attentionFor(missing, 'not_reconciled', TODAY)?.item.pill).toBe('Missing in CM')
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

// Batch 4: each reason's next step for the opened row's detail line. The labels are the round 6
// mock's (grid-layout-options.html nextAction), owner-approved in title case (10-03). #2943 has no
// writers, so every step is a link to where it is done today (the household page: its income
// section, or the request's card) or plain words; a step that is a tick or the editor (the mock's
// buttons) is null here, and #2951 / #2948 add it.
describe('the next step (batch 4; labels owner-approved in title case, 10-03)', () => {
  it('names the open-the-request step in title case', () => {
    expect(OPEN_REQUEST).toEqual({ kind: 'link', label: 'Open the Request', at: 'request' })
  })

  const nextOf = (
    row: Parameters<typeof attentionFor>[0],
    view: Parameters<typeof attentionFor>[1]
  ) => attentionFor(row, view, TODAY)?.next
  const hold = (code: string) =>
    gridRow({ holds: [{ code, severity: 'hold', message: 'A hold.' }], queues: ['holds'] })
  const link = (label: string, at: 'income' | 'request' = 'request') => ({
    kind: 'link' as const,
    label,
    at,
  })

  it('sends an income hold to the household income section', () => {
    expect(nextOf(hold('household_income_conflict'), 'holds')).toEqual(
      link('Enter the Income', 'income')
    )
    expect(nextOf(hold('placeholder_income'), 'holds')).toEqual(link('Enter the Income', 'income'))
  })

  it("sends the other holds to the request's card", () => {
    expect(nextOf(hold('payer_shares_incomplete'), 'holds')).toEqual(link('Check the Payer Shares'))
    expect(nextOf(hold('manual_hold'), 'holds')).toEqual(link('Release the Hold…'))
    expect(nextOf(hold('unmatched_session'), 'holds')).toEqual(link('Pick the Session'))
    expect(nextOf(hold('multiple_grants'), 'holds')).toEqual(OPEN_REQUEST)
  })

  it('leaves the editor and the ticks to the PRs that add them', () => {
    // "Edit the award" opens the editor (#2948); "Tick Accepted" and "Mark posted" are ticks (#2951).
    expect(nextOf(hold('award_above_cost'), 'holds')).toBeNull()
    expect(nextOf(ROW_SAMUEL, 'waiting_on_family')).toBeNull()
    const marked = gridRow({
      notes: [{ code: 'in_campminder_not_ticked', severity: 'warn', message: 'In CampMinder.' }],
    })
    expect(nextOf(marked, 'all')).toBeNull()
  })

  it('says where nothing can be done in Kindred', () => {
    expect(nextOf(ROW_RILEY, 'to_reverse')).toEqual({
      kind: 'text',
      text: 'Reverse it in CampMinder; nothing to do here',
    })
  })

  // Owner V1 (10-03) and #2996: a hand tick awaiting tonight's sync is no exception (the server reads
  // it reconciled and keeps it out of Not reconciled; CM ✓ says pending). The "awaiting tonight's
  // sync" pill, its text and its "Nothing to do; tonight's sync confirms it" step are retired. Was:
  // that step asserted here.
  it("has no item for a check awaiting tonight's sync", () => {
    const awaiting = gridRow({
      confirmation: confirmationOut({ status: 'awaiting_sync', on: null, reconciled: false }),
      queues: [],
    })
    expect(attentionFor(awaiting, 'all', TODAY)).toBeNull()
  })

  it("sends the queue items to the request's card", () => {
    expect(nextOf(ROW_RILEY, 'cancel_reason')).toEqual(link('Pick a Reason'))
    expect(nextOf(ROW_SAMUEL, 'not_reconciled')).toEqual(link('Check the Posting'))
    const pending = gridRow({
      rounds: [roundOut(3, 'pending_approval', { pending_approval: 450 })],
      queues: ['pending_approval'],
    })
    expect(nextOf(pending, 'pending_approval')).toEqual(link('Approve Round 3 (Finance)'))
    expect(
      nextOf(
        gridRow({ request_status: 'unmatched_session', queues: ['session_not_settled'] }),
        'all'
      )
    ).toEqual(link('Pick the Session'))
    expect(
      nextOf(gridRow({ request_status: 'duplicate_pending', queues: ['duplicates'] }), 'all')
    ).toEqual(link('Choose Which to Keep'))
    expect(nextOf(hold('duplicate_survivor_withdrawn'), 'duplicates')).toEqual(
      link('Choose Which to Keep')
    )
    const share = gridRow({
      confirmation: confirmationOut({
        reconciled: false,
        shares: [{ household_cm_id: 1000003, expected: 100, in_campminder: 50, status: 'short' }],
      }),
      queues: ['not_reconciled'],
    })
    expect(nextOf(share, 'not_reconciled')).toEqual(link('Check the Payer Shares'))
  })
})
