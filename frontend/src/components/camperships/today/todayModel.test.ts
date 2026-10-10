import { describe, expect, it } from 'vitest'

import { BUDGET, REGISTRAR_TODAY, STAGES, line } from './todayFixtures'
import {
  bandSentence,
  budgetSegments,
  countWords,
  developmentSegments,
  offerShare,
  overPools,
  pickTodayPage,
  rankLines,
  reasonWords,
  REGISTRAR_ORDER,
  registrarSegments,
  showRegistrarQueue,
} from './todayModel'

function at<T>(a: readonly T[], i: number): T {
  const x = a[i]
  if (x === undefined) throw new Error(`no item at ${String(i)}`)
  return x
}

const can = (...p: string[]) => ({ hasPermission: (x: string) => p.includes(x) })

describe('pickTodayPage (spec §2)', () => {
  it.each([
    [['financial_aid.view', 'financial_aid.casework', 'financial_aid.rules'], 'finance'],
    [['financial_aid.rules'], 'finance'],
    [['financial_aid.view', 'financial_aid.casework'], 'registrar'],
    [['financial_aid.summary', 'financial_aid.grantors'], 'development'],
    [['financial_aid.grantors'], 'development'],
    [['financial_aid.view', 'financial_aid.summary'], 'viewOnly'],
    [['financial_aid.view'], 'viewOnly'],
    [[], 'none'],
  ])('%j → %s', (perms, page) => expect(pickTodayPage(can(...perms))).toBe(page))
})

describe('rankLines (spec §5)', () => {
  it('puts overdue lines first, then the fixed order, drops zeros, keeps five', () => {
    const { top, rest } = rankLines(REGISTRAR_TODAY.casework ?? [], REGISTRAR_ORDER)
    expect(top.map((l) => l.key)).toEqual([
      'needs_offer',
      'waiting_on_family',
      'grants',
      'holds',
      'not_reconciled',
    ])
    expect(rest.map((l) => l.key)).toEqual([
      'to_reverse',
      'session_not_settled',
      'duplicates',
      'late_full_coverage',
      'to_place',
    ])
  })
  it('keeps the fixed order when nothing is overdue', () => {
    const lines = [line('holds', 2), line('needs_offer', 1)]
    expect(rankLines(lines, REGISTRAR_ORDER).top.map((l) => l.key)).toEqual([
      'needs_offer',
      'holds',
    ])
  })
})

describe('showRegistrarQueue (ruling 3)', () => {
  it("shows only when fewer than three of finance's own lines have anything", () => {
    expect(
      showRegistrarQueue([
        line('pending_approval', 1),
        line('rules_sections', 1),
        line('sources', 0),
      ])
    ).toBe(true)
    expect(
      showRegistrarQueue([
        line('pending_approval', 1),
        line('rules_sections', 1),
        line('sources', 2),
      ])
    ).toBe(false)
    expect(showRegistrarQueue(null)).toBe(false)
  })
})

describe('registrar hero', () => {
  it("orders the stages and marks the viewer's own in amber", () => {
    const segs = registrarSegments(STAGES, (s) => `/aid/requests/${s}`)
    expect(segs.map((s) => [s.key, s.value, s.tone, s.mine ?? false])).toEqual([
      ['accepted', 318, 'done', false],
      ['waiting_on_family', 9, 'progress', false],
      ['pending_approval', 6, 'light', false],
      ['needs_offer', 31, 'act', true],
      ['held', 6, 'act2', true],
      ['cancelled', 42, 'mute', false],
    ])
    expect(at(segs, 0).label).toBe('Accepted')
  })
  it('counts the share of live requests with an offer', () => {
    expect(offerShare(STAGES)).toBe(Math.round(((318 + 9 + 6) / (412 - 42)) * 100))
    expect(
      offerShare({
        ...STAGES,
        accepted: 0,
        waiting_on_family: 0,
        pending_approval: 0,
        needs_offer: 0,
        held: 0,
        cancelled: 0,
      })
    ).toBeNull()
  })
})

describe('finance hero (ruling 12: the budget read, no estimate)', () => {
  it('draws posted, needs an offer, pending, remaining, then on hold hatched', () => {
    const { segments, allocated } = budgetSegments(BUDGET.total.total, BUDGET.total.below)
    expect(segments.map((s) => [s.key, s.value, s.tone])).toEqual([
      ['posted', 843380, 'done'],
      ['needs_offer', 125795, 'progress'],
      ['pending', 14820, 'act'],
      ['remaining', 127130, 'gap'],
      ['over', 0, 'over'],
      ['held', 9600, 'est'],
    ])
    expect(allocated).toBe(1111125)
  })
  it('draws the over-hatch only when remaining is negative (review focus 3)', () => {
    const tbm = at(BUDGET.pools, 1)
    const over = budgetSegments(tbm.total, tbm.below).segments
    expect(over.find((s) => s.key === 'over')?.value).toBe(1300)
    expect(over.find((s) => s.key === 'remaining')?.value).toBe(0)
  })
  it('a pool with no allocation draws no marker', () => {
    const none = { ...at(BUDGET.pools, 0).total, allocated: null, remaining: null }
    expect(budgetSegments(none, at(BUDGET.pools, 0).below).allocated).toBeNull()
  })
  it('names the pools that run over', () => {
    expect(overPools(BUDGET)).toEqual([{ label: 'TBM', over: 1300 }])
  })
})

describe('development hero (ruling 9: outside money gets its own bar)', () => {
  const src = (name: string, amount: number, who: 'the camp' | 'another funder', awards = 1) => ({
    source_key: name,
    name,
    who_paid: who,
    incentive: false,
    group: 'camp_quest',
    group_label: 'Camp & Quest',
    amount,
    awards,
  })
  it('splits camp from outside, then the top six funders and one "others"', () => {
    const funders = Array.from({ length: 9 }, (_, i) =>
      src(`Funder ${String(i + 1)}`, 900 - i * 50, 'another funder', 2)
    )
    const {
      main,
      funders: bar,
      own,
      outside,
    } = developmentSegments([src('Camp', 5000, 'the camp', 40), ...funders])
    expect(main.map((s) => s.key)).toEqual(['own', 'outside'])
    expect(own).toBe(5000)
    expect(outside).toBe(funders.reduce((a, f) => a + f.amount, 0))
    expect(bar.map((s) => s.label)).toEqual([
      'Funder 1',
      'Funder 2',
      'Funder 3',
      'Funder 4',
      'Funder 5',
      'Funder 6',
      '3 other funders',
    ])
    expect(at(bar, 6).title).toContain('Funder 9')
    expect(at(bar, 0).figure).toBe('$900 · 2 awards')
  })
  it('has no "others" with seven or fewer funders', () => {
    const seven = Array.from({ length: 7 }, (_, i) => src(`F${String(i)}`, 100, 'another funder'))
    expect(developmentSegments(seven).funders).toHaveLength(7)
  })
})

describe('bandSentence (spec §3)', () => {
  it('registrar: overdue, then needs an offer; drops a clause at zero', () => {
    expect(bandSentence('registrar', REGISTRAR_TODAY, undefined, null)).toBe(
      '2 lines are overdue, and 31 requests need an offer'
    )
    const calm = { ...REGISTRAR_TODAY, casework: [line('needs_offer', 0)] }
    expect(bandSentence('registrar', calm, undefined, null)).toBe('Nothing is waiting on you')
  })
  it('registrar: singular wording for one line and one request', () => {
    const one = { ...REGISTRAR_TODAY, casework: [line('needs_offer', 1, { overdue: true })] }
    expect(bandSentence('registrar', one, undefined, null)).toBe(
      '1 line is overdue, and 1 request needs an offer'
    )
  })
  it('finance: pending approvals and a pool over', () => {
    const t = { ...REGISTRAR_TODAY, finance: [line('pending_approval', 6)] }
    expect(bandSentence('finance', t, BUDGET, null)).toBe(
      '6 requests wait on your approval · TBM is $1,300 over'
    )
  })
  it('finance: singular wording for one approval', () => {
    const t = { ...REGISTRAR_TODAY, finance: [line('pending_approval', 1)] }
    expect(bandSentence('finance', t, undefined, null)).toBe('1 request waits on your approval')
  })
  it('development: outside money and funder upkeep', () => {
    const t = {
      ...REGISTRAR_TODAY,
      development: [
        line('no_contact', 2, { item_kind: 'funders' }),
        line('no_eligibility', 2, { item_kind: 'funders' }),
      ],
    }
    expect(bandSentence('development', t, undefined, 172400)).toBe(
      '$172,400 from outside funders so far · 4 funder records need a look'
    )
  })
  it('development: singular wording for one funder record', () => {
    const t = { ...REGISTRAR_TODAY, development: [line('no_contact', 1, { item_kind: 'funders' })] }
    expect(bandSentence('development', t, undefined, null)).toBe('1 funder record needs a look')
  })
})

const reason = (code: string, over: { label?: string; items?: number } = {}) => ({
  code,
  families: null,
  items: over.items ?? 1,
  ...(over.label === undefined ? {} : { label: over.label }),
})

describe('reasonWords: staff text never shows a snake_case code', () => {
  it("uses the server's label when it sends one", () => {
    expect(reasonWords('grants', reason('not_posted', { label: 'Not posted' }))).toBe('Not posted')
  })
  it.each([
    ['needs_camper', 'Needs a camper'],
    ['not_posted', 'Commitment not yet in CampMinder'],
    ['posted_then_reversed', 'Posted, then reversed'],
    ['possible_match', 'Possible match'],
    ['camper_cancelled', 'Camper cancelled'],
    ['no_grantor', 'No grantor'],
    ['unclassified', 'Unclassified'],
    ['needs_group', 'Needs a group'],
    ['short', 'Short'],
    ['over', 'Over'],
    ['not_in_campminder', 'Missing in CM'],
    ['r1', 'R1'],
    ['r2', 'R2'],
    ['r3', 'R3'],
  ])('words the grant and source code %s', (code, words) => {
    expect(reasonWords('grants', reason(code))).toBe(words)
  })
  it("reuses the Rules page's section titles for rules sections", () => {
    expect(reasonWords('rules_sections', reason('award_tables'))).toBe('Round 1 award table')
    expect(reasonWords('rules_sections', reason('quality_checks'))).toBe('Quality checks')
  })
  it("reuses the Requests grid's hold and check words for intake", () => {
    expect(reasonWords('intake', reason('awaiting_approved_rules'))).toBe('Awaiting rules')
  })
  it('falls back to sentence case with spaces for anything unknown', () => {
    expect(reasonWords('intake', reason('some_new_code'))).toBe('Some new code')
  })
})

describe('countWords singulars', () => {
  it.each([
    ['sections', 1, '1 section'],
    ['sections', 2, '2 sections'],
    ['funders', 1, '1 funder'],
    ['descriptions', 1, '1 description'],
    ['grants', 1, '1 grant'],
    ['grants', 4, '4 grants'],
    ['fields', 1, '1 field'],
    ['lines', 1, '1 line'],
  ] as const)('%s x%i reads %s', (kind, n, words) => {
    expect(countWords(line('intake', n, { item_kind: kind, families: null }))).toBe(words)
  })
  it('counts the synthetic over-budget line in pools', () => {
    const over = (n: number) =>
      line('intake', n, { key: 'over_budget' as never, item_kind: 'lines', families: null })
    expect(countWords(over(1))).toBe('1 pool')
    expect(countWords(over(2))).toBe('2 pools')
  })
})
