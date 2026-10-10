import { describe, expect, it } from 'vitest'

import {
  changeWords,
  formatPileMoment,
  keepFigureWords,
  keepName,
  nextLetter,
  fromName,
  nothingNewWords,
  parseView,
  pillWords,
  leadWords,
  PRICE_CHOICES,
  pricedOnFigures,
  pricedOnWords,
  requestSetParam,
  requestSetWords,
  startEntries,
} from './controlsModel'
import { OPTIONS, results, scenarioDraft, workspace } from './scenarioFixtures'

const SNAPSHOT = {
  id: 'snp000000000001',
  taken_at: '2027-02-03T22:10:00Z',
  taken_by: 'Test User',
  requests: 180,
  awaiting_rules: 0,
}

describe('the held pile (§S5 A2–A3; N5)', () => {
  it('says how many applications and as of when, on camp time', () => {
    expect(formatPileMoment('2027-02-03T22:10:00Z')).toBe('Feb 3, 2:10 pm')
    expect(pillWords(SNAPSHOT)).toBe('180 applications · as of Feb 3, 2:10 pm')
    expect(pillWords({ ...SNAPSHOT, requests: 1 })).toBe('1 application · as of Feb 3, 2:10 pm')
  })

  it('adds the requests waiting for approved rules, and says when nothing is held', () => {
    expect(pillWords({ ...SNAPSHOT, awaiting_rules: 3 })).toBe(
      '180 applications · as of Feb 3, 2:10 pm · 3 held until the rules are approved'
    )
    expect(pillWords(null)).toBe('No applications held yet')
    expect(nothingNewWords(SNAPSHOT)).toBe('Nothing new since Feb 3, 2:10 pm')
  })
})

describe('the toolbar lead (scenarios-2)', () => {
  it('reads "‹n› held" and the moment apart, so the moment can be muted; the full sentence stays pillWords', () => {
    expect(leadWords(SNAPSHOT)).toEqual({ held: '180 held', when: 'Feb 3, 2:10 pm' })
    expect(leadWords(null)).toEqual({ held: 'No applications held yet', when: null })
  })

  it('words Price in the toolbar’s short labels', () => {
    expect(PRICE_CHOICES.map((c) => c.label)).toEqual([
      'All held',
      'Through the R1 deadline',
      'Through a date…',
    ])
  })
})

describe('Start from (§S5 A5; §S15 item 4)', () => {
  it('offers the rules in effect, the rules draft only while it differs, and last season', () => {
    const differs = workspace({
      pricing_version: 4,
      rules_version: 5,
      rules_draft_version: 5,
      last_rules_version: 3,
    })
    expect(startEntries(differs)).toEqual([
      { value: 'rules', label: 'Rules in effect · v4', disabled: false },
      { value: 'rules_draft', label: 'Rules draft · v5', disabled: false },
      { value: 'last_rules', label: "Last season's rules", disabled: false },
    ])
    const same = workspace({
      pricing_version: 4,
      rules_version: 4,
      rules_draft_version: null,
      last_rules_version: 3,
    })
    expect(startEntries(same).map((e) => e.value)).toEqual(['rules', 'last_rules'])
  })

  it('names the draft first when no version is in effect, and disables last season with none approved', () => {
    const none = workspace({
      pricing_version: null,
      rules_version: 2,
      rules_draft_version: null,
      last_rules_version: null,
    })
    expect(startEntries(none)).toEqual([
      { value: 'rules', label: 'Rules draft · v2', disabled: false },
      { value: 'last_rules', label: "Last season's rules (none approved)", disabled: true },
    ])
  })

  it('names what the draft is from, as the strip says it', () => {
    const ws = workspace({ pricing_version: 4, rules_version: 5, rules_draft_version: 5 })
    expect(fromName(scenarioDraft({ from_code: 'rules' }), ws)).toBe('Rules v4')
    expect(fromName(scenarioDraft({ from_code: 'rules_draft' }), ws)).toBe('Rules draft v5')
    expect(fromName(scenarioDraft({ from_code: 'last_rules' }), ws)).toBe("last season's rules")
    expect(fromName(scenarioDraft({ from_code: 'B' }), ws)).toBe('B')
  })
})

describe('the change count (§S5 A6)', () => {
  it('counts, and says what the sandbox is the same as', () => {
    const ws = workspace({ pricing_version: 4 })
    expect(changeWords(0, null, ws)).toBeNull()
    expect(changeWords(1, null, ws)).toBe('1 change')
    expect(changeWords(4, 'B', ws)).toBe('4 changes, same as B')
    expect(changeWords(2, 'rules', ws)).toBe('2 changes, same as Rules v4')
  })
})

describe('the URL view (§S5 L)', () => {
  it('reads each param, and an old trail link as the sandbox', () => {
    const view = parseView(
      new URLSearchParams(
        'panel=compare&through=deadline&compare=B,A,b,B&rules=1&lastrules=1&draft=1&last=1&tiers=1'
      )
    )
    expect(view).toEqual({
      panel: 'compare',
      requestSet: { kind: 'deadline' },
      codes: ['B', 'A'],
      rules: true,
      lastRules: true,
      draft: true,
      lastSeason: true,
      byTier: true,
      anyColumn: true,
    })
    const old = parseView(new URLSearchParams('panel=trail&trail_page=3&through=2027-02-30'))
    expect([old.panel, old.requestSet, old.anyColumn]).toEqual(['sandbox', { kind: 'all' }, false])
  })

  it('writes a request set back, and words it for the corner cell', () => {
    expect([
      requestSetParam({ kind: 'all' }),
      requestSetParam({ kind: 'deadline' }),
      requestSetParam({ kind: 'date', date: '2027-02-01' }),
    ]).toEqual([null, 'deadline', '2027-02-01'])
    expect(requestSetWords({ kind: 'all' }, null)).toBe('the applications held')
    expect(requestSetWords({ kind: 'deadline' }, '2027-02-01')).toBe(
      'received through Feb 1 (the Round 1 deadline)'
    )
    expect(requestSetWords({ kind: 'date', date: '2027-01-20' }, '2027-01-20')).toBe(
      'received through Jan 20'
    )
  })

  it('never prints a blank date, and words what the shown figures were priced on (CodeRabbit, lead #29 ruling 3)', () => {
    // A deadline read the server refused leaves no date: the words drop it rather than "received through  (…)".
    expect(requestSetWords({ kind: 'deadline' }, null)).toBe(
      'received through the Round 1 deadline'
    )
    // Figures priced on every application held (no request_set) stay worded so while Price ▾ asks for the deadline.
    expect(pricedOnFigures(results(735000), { kind: 'deadline' })).toBe('420 applications held')
    const deadline = {
      ...results(735000),
      request_set: {
        basis: 'round1_deadline' as const,
        through: '2027-02-01',
        label: 'received through Feb 1',
        left_out: 3,
        unknown: 0,
      },
    }
    expect(pricedOnFigures(deadline, { kind: 'all' })).toBe(
      '420 received through Feb 1 (the Round 1 deadline)'
    )
    expect(
      pricedOnFigures(
        { ...deadline, request_set: { ...deadline.request_set, basis: 'date' as const } },
        { kind: 'all' }
      )
    ).toBe('420 received through Feb 1')
    // No figures yet: the words follow Price ▾.
    expect(pricedOnFigures(null, { kind: 'all' })).toBe('0 applications held')
  })

  it('puts a count before the words without a stray "the" (V F6)', () => {
    // After a count the Price ▾ label's "the applications held" reads "51 applications held", one "application".
    expect(pricedOnWords(51, { kind: 'all' }, null)).toBe('51 applications held')
    expect(pricedOnWords(1, { kind: 'all' }, null)).toBe('1 application held')
    expect(pricedOnWords(51, { kind: 'deadline' }, '2027-02-01')).toBe(
      '51 received through Feb 1 (the Round 1 deadline)'
    )
    expect(pricedOnWords(12, { kind: 'date', date: '2027-01-20' }, '2027-01-20')).toBe(
      '12 received through Jan 20'
    )
  })
})

describe('Keep… (§S5 B; §S11.1)', () => {
  it('names the next flat letter: variants kept before PR 10 never take one', () => {
    expect(nextLetter(OPTIONS)).toBe('C') // A, A1 and B are kept: A and B are starting points
    expect(nextLetter([])).toBe('A')
  })

  it('says what the draft prices now, on the whole held pile', () => {
    expect(keepFigureWords(results(295413))).toBe(
      'with what it prices now: $315,913 on 420 applications'
    )
    expect(keepFigureWords(null)).toBe('')
  })

  it('words a fractional figure in whole dollars (coordinator ruling 2026-10-07)', () => {
    expect(
      keepFigureWords({ ...results(295413), round1: 100000.5, round2: 20000.4, requests: 1 })
    ).toBe('with what it prices now: $120,001 on 1 application')
  })

  it('cuts a long label to the name field as the server cuts a blank name: 80 characters, the last "…" (plan review M3)', () => {
    // A three-phrase label (Task 53's words) of 82 characters: KeepIn.name refuses anything past 80.
    const long =
      'Round 1 % › Teen › Tier 2 75% · Minimum $150 · Round 1 + 2 cap › Teen › Tier 2 92%'
    expect(keepName(long)).toBe(
      'Round 1 % › Teen › Tier 2 75% · Minimum $150 · Round 1 + 2 cap › Teen › Tier 2 …'
    )
    expect(keepName(long)).toHaveLength(80)
    expect(keepName('Minimum $75')).toBe('Minimum $75')
  })
})
