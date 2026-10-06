import { describe, expect, it } from 'vitest'

import {
  MONEY_SECTIONS,
  SECTION_TITLES,
  SEASON_SECTIONS,
  changeWords,
  formatSetting,
  isChanged,
  isRulesSection,
  issueWords,
  labelOf,
  sectionIssues,
  settingNodes,
  statusWords,
  unitOf,
} from './rulesModel'
import { contentOf, rulesDraft } from './rulesFixtures'

describe("a section's status (D39)", () => {
  it('says approved, with when, who and the approving body', () => {
    expect(
      statusWords(
        {
          state: 'approved',
          approved_at: '2027-01-20T18:00:00Z',
          approved_by: 'Test User',
          note: 'Finance, Jan 20 meeting',
        },
        0
      )
    ).toEqual({
      pill: 'Approved',
      tone: 'emerald',
      meta: 'Jan 20, 2027 · Test User · Finance, Jan 20 meeting',
    })
  })

  it('says locked, since its first lock', () => {
    expect(statusWords({ state: 'locked', locked_at: '2027-03-09T18:00:00Z' }, 0)).toMatchObject({
      pill: 'Locked',
      meta: 'in use since Mar 9, 2027',
    })
  })

  it("counts a draft's changes, and names who edited it and the kept option it came from", () => {
    expect(
      statusWords(
        {
          state: 'draft',
          edited_at: '2027-01-21T17:00:00Z',
          edited_by: 'Test User',
          edited_via: 'B2',
        },
        1
      )
    ).toEqual({
      pill: 'Draft · 1 change',
      tone: 'amber',
      meta: 'Jan 21, 2027 · Test User · from B2',
    })
    expect(statusWords({}, null).pill).toBe('Draft')
  })

  it("counts a section's validation issues, errors first", () => {
    expect(issueWords(2, 1)).toBe('2 errors · 1 warning')
    expect(issueWords(0, 0)).toBeNull()
    const issues = sectionIssues(
      [
        { section: 'budget', code: 'a', severity: 'warning', path: 'x', message: 'w' },
        { section: 'tiers', code: 'b', severity: 'error', path: 'y', message: 'other' },
        { section: 'budget', code: 'c', severity: 'error', path: 'z', message: 'e' },
      ],
      'budget'
    )
    expect(issues.map((i) => i.message)).toEqual(['e', 'w'])
  })

  it('reads an evening approval on its camp-time day, not its UTC day', () => {
    // 8pm Pacific on Jan 20 is stored as 04:00Z on Jan 21.
    expect(statusWords({ state: 'approved', approved_at: '2027-01-21T04:00:00Z' }, 0).meta).toBe(
      'Jan 20, 2027'
    )
    expect(statusWords({ state: 'locked', locked_at: '2027-01-21T04:00:00Z' }, 0).meta).toBe(
      'in use since Jan 20, 2027'
    )
    expect(statusWords({ state: 'draft', edited_at: '2027-01-21T04:00:00Z' }, 0).meta).toBe(
      'Jan 20, 2027'
    )
  })

  it('pluralises a draft change count', () => {
    expect(statusWords({ state: 'draft' }, 3).pill).toBe('Draft · 3 changes')
  })

  it('lists every section exactly once, each with a title', () => {
    const listed = [...MONEY_SECTIONS, ...SEASON_SECTIONS]
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(Object.keys(SECTION_TITLES).sort())
  })

  it('knows a section name from any other word in the URL', () => {
    expect(isRulesSection('award_tables')).toBe(true)
    expect(isRulesSection('bogus')).toBe(false)
    expect(isRulesSection(null)).toBe(false)
  })
})

describe('how each setting reads (rules/schema.py)', () => {
  it('names a field, a tier and a session', () => {
    expect(labelOf(['minimum'])).toBe('Minimum award')
    expect(labelOf(['general', 'tiers', '3'])).toBe('Tier 3')
    expect(labelOf(['tuition', '1000101'])).toBe('Session 1000101')
    expect(labelOf(['some_new_field'])).toBe('Some new field')
  })

  it('reads money, percentage points, dates, yes/no and choices as staff do', () => {
    expect(formatSetting('100', ['minimum'])).toBe('$100')
    expect(formatSetting('74.5', ['general', 'tiers', '3', 'r1_pct'])).toBe('74.5%')
    expect(formatSetting('10', ['reserves', 'pool_a', 'r2'])).toBe('10%')
    expect(formatSetting('4000', ['tuition', '1000101'])).toBe('$4,000')
    expect(formatSetting('2027-01-31', ['application_deadline'])).toBe('Jan 31, 2027')
    expect(formatSetting(true, ['ask_cap'])).toBe('yes')
    expect(formatSetting('income_reduction', ['dependents_mode'])).toBe('income reduction')
    expect(formatSetting(null, ['income_ceiling'])).toBe('—')
    expect(formatSetting([], ['offset_programs'])).toBe('none')
  })

  it('reads an override reason as words, never the server code', () => {
    const path = ['cost', 'override_reasons']
    expect(formatSetting(['headcount', 'partial_session'], path)).toBe(
      'number of people, partial session'
    )
    expect(
      formatSetting(
        ['headcount', 'partial_session', 'discount', 'missing_catalog', 'typed_household_total'],
        path
      )
    ).toBe('number of people, partial session, discount, missing catalog, typed household total')
    // One list element, as a rules diff line carries it.
    expect(formatSetting('headcount', [...path, '0'])).toBe('number of people')
    // An unknown code keeps the plain words fallback.
    expect(formatSetting('some_new_reason', path)).toBe('some new reason')
    // Only the override-reasons list is mapped.
    expect(formatSetting('headcount', ['dependents_mode'])).toBe('headcount')
  })

  it('labels the 0-to-1 fractions and the names that fell back to ugly words', () => {
    for (const key of ['medical_rate', 'education_rate', 'savings_inclusion_rate', 'rate'])
      expect(labelOf([key])).toMatch(/\(0 to 1\)$/)
    expect(labelOf(['weights', 'prior_year'])).toMatch(/\(0 to 1\)$/)
    expect(labelOf(['weights', 'current_year'])).toMatch(/\(0 to 1\)$/)
    expect(labelOf(['campminder_description'])).toBe('CampMinder description')
    expect(labelOf(['tables'])).toBe('Round 2 tables')
  })

  it('counts a list entry from 1, as a table row does', () => {
    expect(labelOf(['bands', '0'])).toBe('1')
    expect(labelOf(['bands', '2'])).toBe('3')
    expect(labelOf(['extra_terms', '0'])).toBe('1')
  })

  it("reads an extra term's threshold as money, and a decimal exactly", () => {
    expect(formatSetting('5000', ['extra_terms', '0', 'threshold'])).toBe('$5,000')
    expect(formatSetting('2399.72', ['minimum'])).toBe('$2,399.72')
  })

  it("tells an income term's money threshold from a check's plain one", () => {
    expect(unitOf(['extra_terms', '1', 'threshold'])).toBe('money')
    expect(unitOf(['checks', 'income_above', 'threshold'])).toBe('money')
    expect(unitOf(['checks', 'expense_above', 'threshold'])).toBe('money')
    expect(unitOf(['checks', 'placeholder_income', 'threshold'])).toBe('money')
    expect(unitOf(['checks', 'implausible_dependents', 'threshold'])).toBe('plain')
  })
})

describe('laying a section out', () => {
  it('lists plain settings as lines and nested ones as groups', () => {
    const nodes = settingNodes(contentOf('income'))
    expect(nodes[0]).toMatchObject({ kind: 'group', label: 'Weights' })
    expect(nodes.find((n) => n.label === 'Reduction per dependent')).toMatchObject({
      kind: 'leaf',
      value: '4000',
    })
  })

  it("lays like records out as a table: bands by row, a table's tiers by tier, pools by key", () => {
    const [bands] = settingNodes(contentOf('tiers'))
    expect(bands).toMatchObject({ kind: 'table', label: 'Income bands' })
    if (bands?.kind === 'table') {
      expect(bands.columns.map((c) => c.label)).toEqual(['From', 'To'])
      expect(bands.rows.map((r) => r.label)).toEqual(['1', '2', '3'])
    }
    const [general] = settingNodes(contentOf('award_tables'))
    expect(general?.kind).toBe('group')
    if (general?.kind === 'group') {
      const tiers = general.children.find((c) => c.label === 'Tiers')
      expect(tiers).toMatchObject({ kind: 'table' })
      if (tiers?.kind === 'table')
        expect(tiers.rows.map((r) => r.label)).toEqual(['Tier 1', 'Tier 2', 'Tier 3'])
    }
    const pools = settingNodes(contentOf('budget')).find((n) => n.label === 'Pools')
    expect(pools).toMatchObject({ kind: 'table' })
  })
})

describe('what a draft changed', () => {
  const [change] = rulesDraft().sections.find((s) => s.section === 'award_tables')?.changes ?? []

  it('marks the changed cell and everything around it, and nothing else', () => {
    if (change === undefined) throw new Error('fixture has no change')
    expect(isChanged(['general', 'tiers', '2', 'r1_pct'], [change])).toBe(true)
    expect(isChanged(['general', 'tiers'], [change])).toBe(true)
    expect(isChanged(['general', 'tiers', '1', 'r1_pct'], [change])).toBe(false)
  })

  it('says the change in words, old → new', () => {
    if (change === undefined) throw new Error('fixture has no change')
    expect(changeWords(change)).toBe('General › Tiers › Tier 2 › Round 1 %: 60% → 55%')
    expect(
      changeWords({
        path: ['bands'],
        kind: 'changed',
        before: [{ lower: '0', upper: null }],
        after: [
          { lower: '0', upper: '40000' },
          { lower: '40001', upper: null },
        ],
      })
    ).toBe('Income bands: changed')
    expect(changeWords({ path: ['minimum'], kind: 'changed', before: '100', after: '150' })).toBe(
      'Minimum award: $100 → $150'
    )
  })
})
