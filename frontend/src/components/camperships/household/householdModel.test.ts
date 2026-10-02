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
  campMinderPersonUrl,
  cancellationWords,
  cardShares,
  earlierReceipts,
  expectedWords,
  firstCamperOf,
  historyLine,
  householdCsvName,
  latestReceipt,
  linkWords,
  noteWords,
  opensByItself,
  postedLabel,
  postingsCsv,
  roundLines,
  shareConfirmation,
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

  it("folds Posted's confirmation states into its label (B2)", () => {
    expect(postedLabel([])).toBe('posted')
    expect(postedLabel([{ status: 'short', count: 1, gap: -210 }])).toBe('posted · 1 short $210')
    expect(
      postedLabel([
        { status: 'awaiting_sync', count: 2, gap: 0 },
        { status: 'over', count: 1, gap: 300 },
      ])
    ).toBe("posted · 2 awaiting tonight's sync · 1 over $300")
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
      wouldChangeBy: null,
    })
  })

  it("says the ledger's own lock named no one", () => {
    const request = householdRequest(ROW_SAMUEL, {
      receipts: [receiptOut(1, { kind: 'locked', locked_on: '2027-03-10', lock_source: 'ledger' })],
    })
    expect(roundLines(request)[0]?.lock).toBe('locked Mar 10 · by the ledger match')
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
    expect(lines.map((l) => [l.round, l.basis, l.amount, l.pending, l.wouldChangeBy])).toEqual([
      [1, 'posted', 1420, null, 67],
      [2, 'decided', 780, null, null],
      [3, 'pending', null, 450, null],
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

  it('opens by itself on a hold or a would-change flag, and stays folded otherwise', () => {
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
    expect(opensByItself(householdRequest(flagged))).toBe(true)
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
  it('carries a clawed-back round and drops its would-change flag (I1; D54)', () => {
    const row = gridRow({
      rounds: [roundOut(1, 'posted', { posted: 1420, would_change_by: -40, clawed_back: true })],
    })
    expect(roundLines(householdRequest(row))[0]).toMatchObject({
      clawedBack: true,
      wouldChangeBy: null,
    })
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
    ).toBe('Cancelled in Kindred May 2 · declined: aid not enough / financial constraints')
    expect(cancellationWords({ by: 'campminder', on: '2027-06-02', reason: null, note: '' })).toBe(
      'Cancelled in CampMinder Jun 2 · no reason given yet'
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

  it('words a household link and a note key (review M3)', () => {
    expect(
      linkWords({
        id: 'link00000000001',
        year: 2027,
        household_cm_id: 1000003,
        family_key: 'k',
        source: 'staff',
        excluded: true,
        note: 'Same family',
        actor: 'Test User',
      })
    ).toBe('household 1000003 · staff · excluded · Same family')
    expect(noteWords('special_circumstances')).toBe('Special financial circumstances')
  })

  it('names the camper a household card opens in CampMinder (M12)', () => {
    expect(firstCamperOf(PAGE, 1000001)).toEqual({ personCmId: 1000002, name: 'Emma Johnson' })
    expect(firstCamperOf(PAGE, 9999999)).toBeNull()
  })

  it('names an Expected grant without a funder (Decision 21)', () => {
    expect(expectedWords(PAGE.expected[0]!)).toBe('Expected: synagogue grant · Emma Johnson')
    expect(expectedWords({ ...PAGE.expected[0]!, kind: 'one_happy_camper' })).toBe(
      'Expected: incentive grant (family says it applied) · Emma Johnson'
    )
  })

  it('reads a history entry as who, what and why', () => {
    expect(historyLine(PAGE.history[1]!)).toBe(
      'test@example.com · Tick posted · decision events reqsamuel000005:1 · Entered in CampMinder'
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
