import { describe, expect, it } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_SAMUEL } from '../requests/gridFixtures'
import {
  householdCard,
  householdPage,
  householdRequest,
  receiptOut,
  SPLIT_PAGE,
} from './householdFixtures'
import {
  answerValue,
  answerWords,
  appliedBy,
  bandSubtitle,
  bandTitle,
  camperOf,
  campMinderPersonUrl,
  cancellationWords,
  cardShares,
  earlierReceipts,
  expectedKindWords,
  expectedWords,
  householdCsvName,
  householdChipName,
  householdName,
  latestReceipt,
  noteWords,
  opensByItself,
  cardConfirmation,
  cardContactLine,
  cardCost,
  cardPlaceLine,
  postedLabel,
  postingsCsv,
  roundLines,
  shareConfirmation,
  unreachedRounds,
} from './householdModel'

const PAGE = householdPage()

describe('the band (§6.3 item 1; D32, D77; Decision 18)', () => {
  it("names the family as the server does, with no 'family' added", () => {
    expect(bandTitle(PAGE)).toBe('The Johnson Family')
    expect(bandTitle(SPLIT_PAGE)).toBe('The Johnson Family / The Garcia Family')
  })

  it("folds one household's details into the subtitle, and counts several", () => {
    expect(bandSubtitle(PAGE)).toBe('Samuel Johnson · household 1000001 · 555-0100 · Riverside, CA')
    expect(bandSubtitle(SPLIT_PAGE)).toBe(
      '2 households with a financial stake · opened from The Johnson Family'
    )
  })

  it('chips name a household by its short name, falling back to the family name on ""', () => {
    const page = householdPage({
      households: [
        householdCard({
          household_cm_id: 1000001,
          family_name: 'The Johnson Family',
          short_name: 'Johnson',
        }),
        householdCard({
          household_cm_id: 1000002,
          family_name: 'The Garcia Family',
          short_name: '',
          chip: 2,
        }),
      ],
    })
    expect(householdChipName(page, 1000001)).toBe('Johnson')
    expect(householdChipName(page, 1000002)).toBe('The Garcia Family')
    expect(householdChipName(page, 9999999)).toBe('Household 9999999')
    // The full name is untouched: the band and sentences keep it.
    expect(householdName(page, 1000001)).toBe('The Johnson Family')
  })

  // Guard: the server never sends a blank family_name today.
  it('reads a blank family name as missing, in one place', () => {
    const blank = householdPage({
      households: [householdCard({ household_cm_id: 1000001, family_name: '  ' })],
    })
    expect(householdName(blank, 1000001)).toBe('Household 1000001')
    expect(householdName(PAGE, 1000001)).toBe('The Johnson Family')
    const several = householdPage({
      households: [
        householdCard({ household_cm_id: 1000001, family_name: '' }),
        householdCard({ household_cm_id: 1000002, family_name: 'The Garcia Family', chip: 2 }),
      ],
    })
    expect(bandSubtitle(several)).toBe(
      '2 households with a financial stake · opened from Household 1000001'
    )
  })

  it("folds Posted's confirmation states into its label (B2)", () => {
    expect(postedLabel([])).toBe('posted')
    expect(postedLabel([{ status: 'short', count: 1, gap: -210 }])).toBe('posted · 1 short $210')
    expect(
      postedLabel([
        { status: 'awaiting_sync', count: 2, gap: 0 },
        { status: 'over', count: 1, gap: 300 },
      ])
    ).toBe('posted · 2 pending · 1 over $300')
  })

  // D19: the mock's "posted · ✓ confirmed" once every posted request is confirmed.
  it('says ✓ confirmed when every state is confirmed, and keeps the others in full', () => {
    expect(postedLabel([{ status: 'confirmed', count: 2, gap: 0 }])).toBe('posted · ✓ confirmed')
    expect(
      postedLabel([
        { status: 'confirmed', count: 1, gap: 0 },
        { status: 'short', count: 1, gap: -210 },
      ])
    ).toBe('posted · 1 confirmed · 1 short $210')
  })

  // Owner V1 (10-03): the grid's words, lowercase mid-line.
  it('says pending and missing in CM, as the grid does', () => {
    expect(
      postedLabel([
        { status: 'awaiting_sync', count: 1, gap: 0 },
        { status: 'not_in_campminder', count: 2, gap: -880 },
      ])
    ).toBe('posted · 1 pending · 2 missing in CM')
  })
})

describe('household cards (§6.3 item 2)', () => {
  it('say which shares each household pays', () => {
    const [johnson, garcia] = SPLIT_PAGE.households
    expect(johnson && cardShares(johnson, SPLIT_PAGE)).toBe('50% of Emma')
    expect(garcia && cardShares(garcia, SPLIT_PAGE)).toBe('50% of Emma')
    const [only] = PAGE.households
    expect(only && cardShares(only, PAGE)).toBe('all of Emma, all of Samuel')
  })

  it('name who applied only when several households are on the page', () => {
    expect(appliedBy(PAGE.requests[0]!, PAGE)).toBeNull()
    expect(appliedBy(SPLIT_PAGE.requests[0]!, SPLIT_PAGE)).toEqual({
      chip: 1,
      name: 'The Johnson Family',
    })
  })
})

describe('an applicant household that pays nothing (review I1)', () => {
  it('says it applied, and claims no share', () => {
    const page = householdPage({
      households: [
        householdCard({ request_ids: ['reqemma00000001'] }),
        householdCard({
          household_cm_id: 1000003,
          chip: 2,
          family_name: 'The Garcia Family',
          request_ids: ['reqemma00000001'],
        }),
        householdCard({
          household_cm_id: 1000004,
          chip: 3,
          family_name: 'The Chen Family',
          request_ids: ['reqemma00000001'],
        }),
      ],
      requests: [
        householdRequest(ROW_EMMA, {
          shares: [
            {
              household_cm_id: 1000003,
              chip: 2,
              share_pct: 50,
              decided: 710,
              posted: null,
              in_campminder: null,
              status: null,
            },
            {
              household_cm_id: 1000004,
              chip: 3,
              share_pct: 50,
              decided: 710,
              posted: null,
              in_campminder: null,
              status: null,
            },
          ],
        }),
      ],
    })
    const [johnson, garcia] = page.households
    expect(johnson && cardShares(johnson, page)).toBe('applied for Emma')
    expect(garcia && cardShares(garcia, page)).toBe('50% of Emma')
  })
})

describe('the decision panel (§6.3 item 4; D50, D52; Decision 22)', () => {
  it('gives each round its amount, words, lock and ticks', () => {
    const [samuel] = roundLines(PAGE.requests[1]!)
    expect(samuel).toMatchObject({
      round: 1,
      amount: 1800,
      words: 'Posted',
      lock: 'locked Mar 9 · Test User',
      posted: true,
      postedOn: '2027-03-09',
      accepted: false,
    })
  })

  it("says the ledger's own lock named no one", () => {
    const request = householdRequest(ROW_SAMUEL, {
      receipts: [receiptOut(1, { kind: 'locked', locked_on: '2027-03-10', lock_source: 'ledger' })],
    })
    // B21 (ruled 10-04 late): the overnight tick is the normal path now, so it reads as CampMinder's match.
    expect(roundLines(request)[0]?.lock).toBe('locked Mar 10 · matched in CampMinder')
  })

  it("keeps a pending Round 3 apart from the amounts, the grid's way, and names each line's basis", () => {
    // Plan review number-meaning fix 3: the amount column is posted locks and decided amounts,
    // which is what the Total under it adds; a pending amount is drawn beside it in amber.
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', {
          decided: 1420,
          posted: 1420,
          would_change_by: 67,
          posted_on: '2027-03-09',
        }),
        roundOut(2, 'needs_offer', { decided: 780 }),
        roundOut(3, 'pending_approval', { pending_approval: 450 }),
      ],
    })
    const lines = roundLines(householdRequest(row))
    expect(lines.map((l) => [l.round, l.basis, l.amount, l.pending])).toEqual([
      [1, 'posted', 1420, null],
      [2, 'decided', 780, null],
      [3, 'pending', null, 450],
    ])
  })

  it("carries each round's ask and the day it came (I6; the mock's ask note)", () => {
    const [, appeal] = roundLines(householdRequest(ROW_OLIVIA))
    expect(appeal).toMatchObject({ round: 2, ask: 1200, askedOn: '2027-04-09' })
  })
})

describe('receipts (§6.5; D34; Decision 35)', () => {
  it('shows the latest round’s, with earlier rounds’ one click away', () => {
    const request = householdRequest(ROW_EMMA, { receipts: [receiptOut(1), receiptOut(2)] })
    expect(latestReceipt(request)?.round).toBe(2)
    expect(earlierReceipts(request).map((r) => r.round)).toEqual([1])
  })

  it('opens by itself on a hold, and stays folded otherwise, a would-change figure included (owner Decision 1)', () => {
    expect(opensByItself(householdRequest(ROW_EMMA))).toBe(false)
    expect(
      opensByItself(
        householdRequest({
          ...ROW_EMMA,
          holds: [{ code: 'manual_hold', severity: 'hold', message: 'Waiting on a call' }],
        })
      )
    ).toBe(true)
    const flagged = gridRow({ rounds: [roundOut(1, 'posted', { would_change_by: -40 })] })
    expect(opensByItself(householdRequest(flagged))).toBe(false)
  })
})

describe('per-share confirmation (D81)', () => {
  it("confirms each payer share against its own household's postings", () => {
    expect(
      shareConfirmation({
        household_cm_id: 1000003,
        chip: 2,
        share_pct: 40,
        decided: 880,
        posted: 880,
        in_campminder: 0,
        status: 'not_in_campminder',
      })
    ).toMatchObject({ status: 'not_in_campminder', locked: 880, in_campminder: 0, gap: -880 })
    expect(
      shareConfirmation({
        household_cm_id: 1000001,
        chip: 1,
        share_pct: 60,
        decided: 1320,
        posted: null,
        in_campminder: null,
        status: null,
      })
    ).toBeNull()
  })
})

describe('fix round 1 model (review of Task 20)', () => {
  it('carries a clawed-back round, and no round line carries a would-change figure (I1; D54; owner Decision 1)', () => {
    const row = gridRow({
      rounds: [roundOut(1, 'posted', { posted: 1420, would_change_by: -40, clawed_back: true })],
    })
    const [line] = roundLines(householdRequest(row))
    expect(line).toMatchObject({ clawedBack: true })
    expect(line).not.toHaveProperty('wouldChangeBy')
  })

  it('gives a share with no posted figure no confirmation, whatever the request-wide state (I2)', () => {
    expect(
      shareConfirmation({
        household_cm_id: 1000001,
        chip: 1,
        share_pct: 60,
        decided: null,
        posted: null,
        in_campminder: 1590,
        status: 'short',
      })
    ).toBeNull()
  })
})

describe('words', () => {
  it('words a cancellation, with its reason from the fixed list (D141)', () => {
    expect(
      cancellationWords({ by: 'kindred', on: '2027-05-02', reason: 'aid_not_enough', note: '' })
    ).toBe('Cancelled in the dashboard May 2 · declined: aid not enough / financial constraints')
    expect(cancellationWords({ by: 'campminder', on: '2027-06-02', reason: null, note: '' })).toBe(
      // B35 / ruling B: a reason is optional, so "yet" would read as a nag.
      'Cancelled in CampMinder Jun 2 · none recorded'
    )
  })

  it('reads an answer as money, a count or yes/no, "—" when blank', () => {
    expect(answerWords('total_adjusted_income')).toBe('Adjusted income')
    expect(answerValue('total_adjusted_income', '84200.00')).toBe('$84,200')
    expect(answerValue('num_children', '3')).toBe('3')
    expect(answerWords('income_confirmed')).toBe('Prior-year confirmed income')
    expect(answerValue('income_confirmed', 'true')).toBe('Yes')
    expect(answerValue('total_rent', '')).toBe('—')
  })

  it('reads an income override as words, not the stored string (review M1)', () => {
    expect(answerWords('income_override')).toBe('Income override')
    expect(answerValue('income_override', 'staff_entered:52000.00')).toBe('Staff entered $52,000')
    expect(answerValue('income_override', 'prior_year_only')).toBe('Prior year only')
    expect(answerValue('income_override', 'current_year_only')).toBe('Current year only')
    expect(answerValue('income_override', 'confirmed_prior_year')).toBe('Confirmed from prior year')
  })

  it("builds CampMinder's person URL as person, then year (review M3)", () => {
    expect(campMinderPersonUrl(1000002, 2027)).toBe(
      'https://system.campminder.com/ui/person/Record#1000002:2027'
    )
  })

  it('words a note key (review M3)', () => {
    expect(noteWords('special_circumstances')).toBe('Special financial circumstances')
  })

  it('names an Expected grant without a funder (Decision 21)', () => {
    expect(expectedWords(PAGE.expected[0]!)).toBe('Expected: synagogue grant · Emma Johnson')
    expect(expectedWords({ ...PAGE.expected[0]!, kind: 'one_happy_camper' })).toBe(
      'Expected: incentive grant (family says it applied) · Emma Johnson'
    )
  })
})

describe('downloads (§11; D127; Decision 32)', () => {
  it('writes the postings with signed plain numbers, reversals dated', () => {
    const table = postingsCsv(PAGE)
    expect(table.headers).toEqual([
      'Posted on',
      'Household',
      'Amount',
      'Reversed on',
      'Source',
      'Person id',
      'Session id',
      'Program',
      'Note',
    ])
    expect(table.rows[0]).toEqual([
      '2027-03-09',
      '1000001',
      '1800',
      '2027-03-20',
      'camp_aid',
      '1000010',
      '1000102',
      'summer',
      '',
    ])
    expect(householdCsvName(PAGE, 'postings')).toBe(
      'camperships-household-1000001-postings-2027.csv'
    )
  })
})

describe('the round line, trued to the mock (O1, O2; D7, D11)', () => {
  it("gives each round's state its meaning tone, not the grid's per-round tone", () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', { decided: 1420, posted: 1420, posted_on: '2027-03-09' }),
        roundOut(2, 'needs_offer', { decided: 780 }),
        roundOut(3, 'pending_approval', { pending_approval: 450 }),
      ],
    })
    expect(roundLines(householdRequest(row)).map((l) => l.stateTone)).toEqual([
      'posted',
      'offer',
      'finance',
    ])
    const held = gridRow({ rounds: [roundOut(1, 'held'), roundOut(2, 'not_decided')] })
    expect(roundLines(householdRequest(held)).map((l) => l.stateTone)).toEqual(['hold', 'stone'])
  })

  it('names the rounds not reached on a live request, so every card has three round rows', () => {
    const one = gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 780 })] })
    expect(unreachedRounds(householdRequest(one))).toEqual([2, 3])
    const three = gridRow({
      rounds: [
        roundOut(1, 'posted', { decided: 1, posted: 1 }),
        roundOut(2, 'posted', { decided: 1, posted: 1 }),
        roundOut(3, 'needs_offer', { decided: 1 }),
      ],
    })
    expect(unreachedRounds(householdRequest(three))).toEqual([])
  })

  it('draws no unreached rounds on a withdrawn or duplicate request, or one with no rounds', () => {
    const withdrawn = gridRow({
      request_status: 'withdrawn',
      rounds: [roundOut(1, 'posted', { decided: 1, posted: 1 })],
    })
    expect(unreachedRounds(householdRequest(withdrawn))).toEqual([])
    expect(unreachedRounds(householdRequest(gridRow({ rounds: [] })))).toEqual([])
  })
})

describe('a cancelled request keeps its cost on the card (O6, ruled 10-04 late)', () => {
  it("reads the session's price from the receipt when the server leaves the row's cost out", () => {
    const row = gridRow({
      cost: null,
      cancellation: { by: 'kindred', on: '2027-05-02', reason: 'schedule', note: '' },
    })
    expect(cardCost(householdRequest(row, { receipts: [receiptOut(1)] }))).toBe(5000)
  })

  it("keeps the row's own cost, and invents none where neither is there", () => {
    expect(cardCost(householdRequest(gridRow({ cost: 3600 })))).toBe(3600)
    const live = gridRow({ cost: null })
    expect(cardCost(householdRequest(live, { receipts: [receiptOut(1)] }))).toBeNull()
    const cancelled = gridRow({
      cost: null,
      cancellation: { by: 'campminder', on: null, reason: null, note: '' },
    })
    expect(cardCost(householdRequest(cancelled, { receipts: [] }))).toBeNull()
  })
})

describe('a household card, trued to the mock (D14, D15)', () => {
  it('puts the household and its city on one line, and the first adult with phone and email on the next', () => {
    const card = householdCard({ adults: ['Samuel Johnson (dad)', 'Olivia Johnson (mom)'] })
    expect(cardPlaceLine(card)).toBe('household 1000001 · Riverside, CA')
    expect(cardContactLine(card)).toBe('Samuel Johnson · 555-0100 · test@example.com')
  })

  it('drops a missing field with its separator', () => {
    const bare = householdCard({ adults: [], phone: '', emails: [], city: '' })
    expect(cardPlaceLine(bare)).toBe('household 1000001')
    expect(cardContactLine(bare)).toBe('')
  })

  it('words its confirmation as pills: ✓ confirmed, or what CampMinder shows and the gap', () => {
    const confirmed = householdCard({
      money: {
        decided: 1800,
        posted: 1800,
        in_campminder: 1800,
        states: [{ status: 'confirmed', count: 1, gap: 0 }],
      },
    })
    expect(cardConfirmation(confirmed)).toEqual({
      shows: null,
      pills: [{ tone: 'emerald', text: '✓ confirmed' }],
    })
    const short = householdCard({
      money: {
        decided: 710,
        posted: 500,
        in_campminder: 290,
        states: [{ status: 'short', count: 1, gap: -210 }],
      },
    })
    expect(cardConfirmation(short)).toEqual({
      shows: 'CampMinder shows $290',
      pills: [{ tone: 'amber', text: 'short $210' }],
    })
  })

  it('counts the requests once a household has several', () => {
    const mixed = householdCard({
      money: {
        decided: 3220,
        posted: 3000,
        in_campminder: 2790,
        states: [
          { status: 'confirmed', count: 1, gap: 0 },
          { status: 'short', count: 1, gap: -210 },
        ],
      },
    })
    expect(cardConfirmation(mixed)).toEqual({
      shows: 'CampMinder shows $2,790',
      pills: [
        { tone: 'emerald', text: '✓ 1 confirmed' },
        { tone: 'amber', text: '1 short $210' },
      ],
    })
  })
})

describe('expectedKindWords (Grants › Expected; D56, P-25)', () => {
  it('names the grantor the server sends, else the generic words', () => {
    const [expected] = PAGE.expected
    if (expected === undefined) throw new Error('fixture')
    expect(expectedKindWords(expected)).toBe('Expected: synagogue grant')
    expect(expectedKindWords({ ...expected, display_name: 'Grantor B' })).toBe(
      'Expected: Grantor B'
    )
    expect(expectedKindWords({ ...expected, display_name: null })).toBe('Expected: synagogue grant')
  })
})

// Final audit: a household-level card is titled with the household's label, as Requests reads it.
describe('camperOf (a card’s name)', () => {
  it('is the camper, else the household label, never "Household request"', () => {
    const camper = householdRequest(gridRow({ camper_name: 'Emma Johnson' }))
    expect(camperOf(camper)).toBe('Emma Johnson')
    const household = householdRequest(
      gridRow({
        camper_name: '',
        person_cm_id: 0,
        household_label: 'Mia & Noah Johnson',
        household_label_tiebreak: 'Riverside',
      })
    )
    expect(camperOf(household)).toBe('Mia & Noah Johnson')
    const noLabel = householdRequest(
      gridRow({
        camper_name: '',
        person_cm_id: 0,
        household_label: '',
        family_name: 'The Johnson Family',
      })
    )
    expect(camperOf(noLabel)).toBe('The Johnson Family')
  })
})
