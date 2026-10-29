import { describe, expect, it } from 'vitest'

import type { ApiAidDevelopment } from '../../../types/api-types'

import { resolveStrip } from '../requests/strip'
import { REQUEST_VIEWS } from '../requests/views'
import { BUDGET, REGISTRAR_TODAY, STAGES, line } from './todayFixtures'
import {
  bandSentence,
  clockWords,
  budgetSegments,
  countParts,
  countWords,
  LINE_WORDS,
  reasonsLine,
  reasonsTitle,
  reportingGroupRows,
  reportingGroupTotal,
  upkeepItems,
  developmentSegments,
  offerShare,
  overPools,
  pickTodayPage,
  rankLines,
  reasonWords,
  REGISTRAR_ORDER,
  registrarFlags,
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

describe('showRegistrarQueue (controller ruling V4, 2026-10-11: the mock draws it always)', () => {
  it("always draws the registrar's queue for finance, however much finance has of its own", () => {
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
    ).toBe(true)
    expect(showRegistrarQueue(null)).toBe(false)
  })
})

describe('registrar hero (ruling 17: five stages on the bar, the strip flags as chips)', () => {
  const VIEW = { year: 2027, asOf: { kind: 'live' } } as const
  const stripStage = (href: string | undefined) => {
    const url = new URL(href ?? '', 'http://x')
    expect(url.pathname).toBe('/aid/requests')
    expect(url.searchParams.get('year')).toBe('2027')
    return (
      resolveStrip(url.searchParams.get('view'), url.searchParams.get('lens')).stage?.key ?? null
    )
  }
  it('draws Needs an offer, Pending approval, Waiting on the family, On hold and Accepted, summing to the live season', () => {
    const segs = registrarSegments(STAGES, VIEW)
    expect(segs.map((s) => [s.key, s.label, s.value])).toEqual([
      ['needs_offer', 'Needs an offer', 31],
      ['pending_approval', 'Pending approval', 6],
      ['waiting_on_family', 'Waiting on the family', 9],
      ['on_hold', 'On hold', 6],
      ['accepted', 'Accepted', 318],
    ])
    for (const s of segs.slice(0, 3)) {
      expect(s.label).toBe(REQUEST_VIEWS.find((v) => v.key === s.key)?.label)
    }
    expect(segs.reduce((sum, s) => sum + s.value, 0)).toBe(STAGES.live)
  })
  it('opens each linear stage on the strip, On hold on Holds, and Accepted on the whole season', () => {
    const segs = registrarSegments(STAGES, VIEW)
    expect(segs.map((s) => stripStage(s.href))).toEqual([
      'needs_offer',
      'pending_approval',
      'waiting_on_family',
      'holds',
      null,
    ])
  })
  it("marks the registrar's own segments in amber", () => {
    const mine = registrarSegments(STAGES, VIEW)
      .filter((s) => s.mine)
      .map((s) => s.key)
    expect(mine).toEqual(['needs_offer', 'on_hold'])
  })
  it("gives each flag the strip's count, word and view, in the strip's order, and hides zeros", () => {
    const chips = registrarFlags(STAGES, VIEW)
    expect(chips.map((c) => [c.key, c.label, c.count])).toEqual([
      ['not_reconciled', 'Not reconciled', 8],
      ['session_not_settled', 'Session unclear', 2],
      ['to_reverse', 'To reverse', 1],
      ['cancel_reason', 'Cancelled: give a reason', 3],
    ])
    for (const c of chips) expect(stripStage(c.href)).toBe(c.key)
  })
  it('says honestly that the Holds list can show more than the On hold segment, and never that a segment always matches', () => {
    const segs = registrarSegments(STAGES, VIEW)
    const hold = segs.find((s) => s.key === 'on_hold')
    expect(hold?.title).toMatch(/Holds list can show more/)
    expect(hold?.title).toMatch(/after an offer/)
    for (const s of segs) expect(s.title ?? '').not.toMatch(/always/i)
  })
  it('has no chip for holds and no Not ready to offer segment', () => {
    expect(
      registrarFlags({ ...STAGES, flags: { ...STAGES.flags } }, VIEW).map((c) => c.key)
    ).not.toContain('holds')
    expect(registrarSegments(STAGES, VIEW).map((s) => s.label)).not.toContain('Not ready to offer')
  })
  it('counts the share of live requests with an offer, consistent with the bar', () => {
    expect(offerShare(STAGES)).toBe(
      Math.round(
        ((STAGES.pending_approval + STAGES.waiting_on_family + STAGES.accepted) / 370) * 100
      )
    )
    expect(offerShare({ ...STAGES, live: 0, offered: 0 })).toBeNull()
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
  it('an over-budget bar draws the overrun once, ending its spending at the allocation (final check S3)', () => {
    // Allocated 100; Posted 120 + Needs an offer 50 + Pending 30 = 200, so 100 over.
    const cell = {
      ...BUDGET.total.total,
      allocated: 100,
      posted: 120,
      needs_offer: 50,
      pending_approval: 30,
      remaining: -100,
    }
    const { segments, total, allocated } = budgetSegments(cell, {
      ...BUDGET.total.below,
      held_asked: 0,
    })
    const width = (key: string) => {
      const s = segments.find((x) => x.key === key)
      return s ? (s.drawn ?? s.value) : 0
    }
    const spent = width('posted') + width('needs_offer') + width('pending')
    expect(spent).toBe(allocated)
    expect(width('over')).toBe(100)
    expect(segments.reduce((a, s) => a + (s.drawn ?? s.value), 0)).toBe(total)
    // The key row still reads every amount.
    expect(segments.map((s) => [s.key, s.value])).toEqual([
      ['posted', 120],
      ['needs_offer', 50],
      ['pending', 30],
      ['remaining', 0],
      ['over', 100],
      ['held', 0],
    ])
  })
  it('the TBM pool, $1,300 over, ends its spending at its $60,000 allocation', () => {
    const tbm = at(BUDGET.pools, 1)
    const { segments, total } = budgetSegments(tbm.total, tbm.below)
    const drawn = segments.map((s) => s.drawn ?? s.value)
    expect(drawn).toEqual([46300, 12000, 1700, 0, 1300, 0])
    expect(drawn.reduce((a, b) => a + b, 0)).toBe(total)
  })
  it('a pool within budget draws every amount as it is', () => {
    const { segments } = budgetSegments(BUDGET.total.total, BUDGET.total.below)
    expect(segments.every((s) => (s.drawn ?? s.value) === s.value)).toBe(true)
  })
  it('a pool with no allocation draws no marker', () => {
    const none = { ...at(BUDGET.pools, 0).total, allocated: null, remaining: null }
    expect(budgetSegments(none, at(BUDGET.pools, 0).below).allocated).toBeNull()
  })
  it('names the pools that run over', () => {
    expect(overPools(BUDGET)).toEqual([{ label: 'TBM', over: 1300 }])
  })
  it('words money in the bar compactly, and its key figures as the week card does (audit N9)', () => {
    const cell = {
      ...BUDGET.total.total,
      posted: 116600,
      needs_offer: 999.6,
      pending_approval: 1750,
      remaining: 1110000,
    }
    const { segments } = budgetSegments(cell, BUDGET.total.below)
    const seg = (key: string) => segments.find((s) => s.key === key)
    expect(seg('posted')?.inner).toBe('Posted $116k')
    expect(seg('remaining')?.inner).toBe('$1,110k remaining')
    // A key figure under $10,000 is exact (formatMoneyFigure): $1,750 never reads "$1k", about half its value.
    expect(seg('pending')?.figure).toBe('$1,750')
    expect(seg('needs_offer')?.figure).toBe('$1,000')
    expect(seg('posted')?.figure).toBe('$116k')
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
  it('names each funder once, adding up the sources it pays through (audit D3)', () => {
    const { funders } = developmentSegments([
      { ...src('Community Foundation A', 950, 'another funder', 2), source_key: 'cfa grant' },
      {
        ...src('Community Foundation A', 800, 'another funder', 1),
        source_key: 'cfa award',
        group: '',
      },
      src('Lakeside', 1000, 'another funder'),
    ])
    expect(funders.map((s) => [s.label, s.value])).toEqual([
      ['Community Foundation A', 1750],
      ['Lakeside', 1000],
    ])
    expect(at(funders, 0).figure).toBe('$1,750 · 3 awards') // audit N9: exact under $10,000, never "$1k"
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
      '$172,400 from outside funders so far · 4 upkeep items need a look'
    )
  })
  it('development: counts every upkeep item, funders and descriptions alike (audit D18)', () => {
    const t = {
      ...REGISTRAR_TODAY,
      development: [
        line('no_contact', 2, { item_kind: 'funders' }),
        line('needs_group', 1, { item_kind: 'descriptions' }),
      ],
    }
    // Ruling W3 (audit N7): the count holds descriptions too, so the words say upkeep items, not funder records.
    expect(bandSentence('development', t, undefined, null)).toBe('3 upkeep items need a look')
    expect(upkeepItems(t.development)).toBe(3)
  })
  it('development: singular wording for one upkeep item', () => {
    const t = { ...REGISTRAR_TODAY, development: [line('no_contact', 1, { item_kind: 'funders' })] }
    expect(bandSentence('development', t, undefined, null)).toBe('1 upkeep item needs a look')
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
    ['not_posted', 'Not yet in CM'], // audit N13: the mock's words
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
  it.each([
    ['campminder_aid', 'CM aid on no request'],
    ['enrolled_no_request', 'Enrolled, no request'],
    ['session_unclear', 'Session unclear'],
    ['registration_ask_unreviewed', 'Reg. ask to review'],
  ])("words Form intake's Needs a look reason %s (the visual audit)", (code, words) => {
    expect(reasonWords('form_intake', reason(code))).toBe(words)
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

describe('countParts (audit R4: bold figures, muted units)', () => {
  it('splits a request line into its figures and units', () => {
    expect(countParts(line('needs_offer', 31, { families: 23 }))).toEqual([
      { figure: '31', unit: 'req' },
      { figure: '23', unit: 'fam' },
    ])
  })
  it('a line of other things has one part, in the singular for one', () => {
    expect(
      countParts(line('rules_sections', 1, { item_kind: 'sections', families: null }))
    ).toEqual([{ figure: '1', unit: 'section' }])
  })
})

describe('reasonsLine (audit R13: one sentence, capitalised once)', () => {
  it('capitalises the first reason only, keeping an acronym as it is', () => {
    const l = line('not_reconciled', 8, {
      reasons: [
        { code: 'short', families: null, items: 4 },
        { code: 'not_in_campminder', families: null, items: 3 },
        { code: 'over', families: null, items: 1 },
      ],
    })
    expect(reasonsLine(l)).toBe('Short 4 · missing in CM 3 · over 1')
  })
  it('names a rules section without a count', () => {
    const l = line('rules_sections', 1, {
      item_kind: 'sections',
      reasons: [{ code: 'round3', families: null, items: 1 }],
    })
    expect(reasonsLine(l)).toBe('Who can ask, and how much')
  })
  it('owner 2a: the two most common reasons, then "+N more" as plain text, when there are more than three', () => {
    const l = line('holds', 20, {
      reasons: [
        { code: 'short', families: null, items: 1 },
        { code: 'not_in_campminder', families: null, items: 6 },
        { code: 'over', families: null, items: 2 },
        { code: 'session_not_settled', families: null, items: 9 },
        { code: 'duplicates', families: null, items: 2 },
      ],
    })
    expect(reasonsLine(l)).toMatch(/^\S.* 9 · .* 6 · \+3 more$/)
    expect(reasonsLine(l).split(' · ')).toHaveLength(3)
  })
  it('owner 2a: three reasons or fewer all show, most common first', () => {
    const l = line('not_reconciled', 8, {
      reasons: [
        { code: 'over', families: null, items: 1 },
        { code: 'short', families: null, items: 4 },
        { code: 'not_in_campminder', families: null, items: 3 },
      ],
    })
    expect(reasonsLine(l)).toBe('Short 4 · missing in CM 3 · over 1')
  })
  it('owner 2a: reasonsTitle keeps every reason, for the cell title', () => {
    const l = line('holds', 20, {
      reasons: [
        { code: 'short', families: null, items: 1 },
        { code: 'not_in_campminder', families: null, items: 6 },
        { code: 'over', families: null, items: 2 },
        { code: 'session_not_settled', families: null, items: 9 },
      ],
    })
    expect(reasonsTitle(l).split(' · ')).toHaveLength(4)
    expect(reasonsTitle(l)).not.toContain('more')
  })
  it("words To place's money when it has no reasons (audit R17)", () => {
    expect(reasonsLine(line('to_place', 3, { item_kind: 'lines', amount: 2150 }))).toBe('$2,150')
  })
})

describe('LINE_WORDS (controller ruling V8)', () => {
  it('names the reporting-group upkeep line by what it counts, descriptions', () => {
    expect(LINE_WORDS.needs_group).toBe('Descriptions with no reporting group')
  })

  it('words the cancel-reason line as its Requests view does, and its clock as the cancellation (D164)', () => {
    expect(LINE_WORDS.cancel_reason).toBe('Cancelled: give a reason')
    expect(LINE_WORDS.cancel_reason).toBe(
      REQUEST_VIEWS.find((v) => v.key === 'cancel_reason')?.label
    )
    expect(clockWords('cancel_reason', 12)).toBe('cancelled 12 days ago')
    expect(REGISTRAR_ORDER.indexOf('cancel_reason')).toBe(REGISTRAR_ORDER.indexOf('duplicates') + 1)
  })
})

describe('reportingGroupRows (audit D11, D13, D14)', () => {
  const dev = {
    year: 2027,
    figures_on: '2027-04-10',
    groups: [
      { key: 'camp_quest', label: 'Camp & Quest', kind: 'summer', families: [] },
      { key: 'tbm', label: 'TBM', kind: 'campers', families: [] },
      { key: 'weekend', label: 'Weekend Programs', kind: 'families', families: [] },
    ],
    columns: [
      { season: 2026, basis: 'r', as_of: null, label: '2026' },
      { season: 2027, basis: 'P', as_of: '2027-04-10', label: '2027' },
    ],
    rows: [
      { key: 'recipients', group: 'camp_quest', values: [480, 33] },
      { key: 'recipients', group: 'tbm', values: [29, 2] },
      { key: 'recipients', group: 'weekend', values: [58, 3] },
      { key: 'recipients', group: null, values: [null, 38] },
    ],
    sources: [
      {
        source_key: '',
        name: 'The camp',
        who_paid: 'the camp',
        incentive: false,
        group: 'weekend',
        group_label: 'Weekend Programs',
        amount: 5000,
        awards: 3,
      },
      {
        source_key: 'a',
        name: 'A',
        who_paid: 'another funder',
        incentive: false,
        group: '',
        group_label: '',
        amount: 800,
        awards: 1,
      },
      {
        source_key: '',
        name: 'The camp',
        who_paid: 'the camp',
        incentive: false,
        group: 'tbm',
        group_label: 'TBM',
        amount: 2300,
        awards: 2,
      },
      {
        source_key: '',
        name: 'The camp',
        who_paid: 'the camp',
        incentive: false,
        group: 'camp_quest',
        group_label: 'Camp & Quest',
        amount: 96000,
        awards: 30,
      },
      {
        source_key: 'b',
        name: 'B',
        who_paid: 'another funder',
        incentive: false,
        group: 'camp_quest',
        group_label: 'Camp & Quest',
        amount: 1000,
        awards: 1,
      },
    ],
  } as unknown as ApiAidDevelopment
  it("lists the groups in the rules' pool order, no group last, with campers helped from the live column", () => {
    const rows = reportingGroupRows(dev)
    expect(rows.map((r) => [r.label, r.total, r.outside, r.campers])).toEqual([
      ['Camp & Quest', 97000, 1000, 33],
      ['TBM', 2300, 0, 2],
      ['Weekend Programs', 5000, 0, 3],
      ['In no group', 800, 800, null],
    ])
    expect(reportingGroupTotal(dev)).toEqual({ total: 105100, outside: 1800, campers: 38 })
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

describe('the Form intake line (PR 3; spec 71 §2.4)', () => {
  it('words the line as the mock does, and counts people (owner Q4: adults too)', () => {
    expect(LINE_WORDS.form_intake).toBe('Form intake: needs a look')
    expect(countWords(line('form_intake', 5, { item_kind: 'campers', families: 4 }))).toBe(
      '5 people'
    )
    expect(countWords(line('form_intake', 1, { item_kind: 'campers', families: 1 }))).toBe(
      '1 person'
    )
  })

  it('sits on the registrar queue after Session not settled', () => {
    expect(REGISTRAR_ORDER.indexOf('form_intake')).toBe(
      REGISTRAR_ORDER.indexOf('session_not_settled') + 1
    )
  })
})

describe('Form intake: needs a look, with the adult aid form (adult aid form mock v2, owner Q4)', () => {
  it('counts people, not campers: the line now counts adults too', () => {
    const l = line('form_intake', 10, { item_kind: 'campers', families: null })
    expect(countParts(l)).toEqual([{ figure: '10', unit: 'people' }])
    expect(countWords(l)).toBe('10 people')
    expect(countWords(line('form_intake', 1, { item_kind: 'campers', families: null }))).toBe(
      '1 person'
    )
  })

  it('words the adult aid form reasons, responses to link first by count', () => {
    const l = line('form_intake', 10, {
      item_kind: 'campers',
      families: null,
      reasons: [
        { code: 'form_response_to_link', families: null, items: 5 },
        { code: 'session_unclear', families: null, items: 2 },
        { code: 'form_response_deleted', families: null, items: 1 },
      ],
    })
    expect(reasonsLine(l)).toBe('Responses to link 5 · session unclear 2 · response deleted 1')
    const more = line('form_intake', 3, {
      item_kind: 'campers',
      families: null,
      reasons: [
        { code: 'form_changed_after_decision', families: null, items: 1 },
        { code: 'form_pull_refused', families: null, items: 1 },
        { code: 'form_choice_unclear', families: null, items: 1 },
      ],
    })
    expect(reasonsLine(more)).toBe(
      'Second response after a decision 1 · read from Google refused 1 · program choice unclear 1'
    )
  })
})
