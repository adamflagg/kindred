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
  keyLabel,
  keyWords,
  labelOf,
  rulesVocabulary,
  sectionIssues,
  settingNodes,
  statusWords,
  unitOf,
  versionWords,
  type RulesNames,
} from './rulesModel'
import { RULES_DOCUMENT, contentOf, rulesDraft } from './rulesFixtures'

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
      pill: 'In effect',
      tone: 'emerald',
      meta: 'Jan 20, 2027 · Test User',
      note: 'Finance, Jan 20 meeting',
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
      note: null,
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

  it('words the not-running list as staff read it', () => {
    expect(labelOf(['cost', 'not_running_session_cm_ids'])).toBe('Not running sessions')
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

describe("the rules' own keys read in the document's words, never as codes (#15)", () => {
  // The fixture's pools and programs carry labels; a decision type and an equity criterion are
  // added here so each kind of key has its own label to read.
  const document: Record<string, unknown> = {
    ...RULES_DOCUMENT,
    programs: {
      ...(RULES_DOCUMENT.programs as Record<string, unknown>),
      ffp: { label: 'FFP' },
    },
    awards: {
      ...RULES_DOCUMENT.awards,
      decision_types: {
        appeal_top_up: {
          label: 'Appeal top-up',
          kind: 'top_up',
          round: 2,
          amount: '300',
          extra_amount: '0',
          allows_appeal: true,
          counts_toward_budget: true,
          ceiling_exempt: false,
        },
      },
    },
    equity: {
      criteria: [
        {
          key: 'trans_nb',
          label: 'Transgender / non-binary',
          source: 'camper',
          field: 'gender_identity',
          also_fields: [],
          match: 'contains_any',
          values: ['trans'],
          min_value: null,
        },
      ],
      weights: { summer: { trans_nb: '0.5', bipoc: '0.5' } },
      aggregation: 'ceil',
      max_shift: null,
    },
  }
  const vocabulary = rulesVocabulary(
    (section) => document[section],
    new Map([
      [1000101, 'First Session'],
      [1000201, 'Family Weekend'],
    ])
  )
  const names = (section: RulesNames['section']): RulesNames => ({ section, ...vocabulary })

  it('names a budget pool by its label', () => {
    expect(labelOf(['pools', 'pool_a'], names('budget'))).toBe('Pool A')
    // A pool's own fields keep their names.
    expect(labelOf(['pools', 'pool_a', 'share_pct'], names('budget'))).toBe('Share %')
  })

  it('names a decision type by its label', () => {
    expect(labelOf(['decision_types', 'appeal_top_up'], names('awards'))).toBe('Appeal top-up')
    expect(labelOf(['decision_types', 'discretionary'], names('awards'))).toBe('Discretionary')
  })

  it('names a quality check as the Requests grid does, and its severity in words', () => {
    expect(labelOf(['checks', 'ask_above_cost'], names('quality_checks'))).toBe('Ask above cost')
    expect(labelOf(['checks', 'expense_above'], names('quality_checks'))).toBe('High expenses')
    expect(labelOf(['checks', 'income_above'], names('quality_checks'))).toBe('High income')
    expect(labelOf(['checks', 'multiple_grants'], names('quality_checks'))).toBe('Several grants')
    expect(labelOf(['checks', 'py_confirm_tier_change'], names('quality_checks'))).toBe(
      'Tier change'
    )
    expect(labelOf(['checks', 'some_new_check'], names('quality_checks'))).toBe('Some new check')
    expect(
      formatSetting('warn', ['checks', 'income_above', 'severity'], names('quality_checks'))
    ).toBe('Warning')
    expect(
      formatSetting('hold', ['checks', 'income_above', 'severity'], names('quality_checks'))
    ).toBe('Hold')
  })

  it("names a session by the season's name for it, else as Session and its number", () => {
    expect(labelOf(['tuition', '1000101'], names('cost'))).toBe('First Session')
    expect(labelOf(['tuition', '1000199'], names('cost'))).toBe('Session 1000199')
    expect(formatSetting(1000201, ['family_rates', '0', 'session_cm_id'], names('cost'))).toBe(
      'Family Weekend'
    )
    expect(formatSetting([1000101, 1000199], ['summer', 'session_cm_ids'], names('programs'))).toBe(
      'First Session, Session 1000199'
    )
  })

  it('names a program by its label wherever the rules key one, and a table or class in words', () => {
    expect(labelOf(['weekend'], names('programs'))).toBe('Weekend')
    expect(labelOf(['mens_weekend'], names('programs'))).toBe('Mens weekend')
    expect(formatSetting('pool_a', ['summer', 'budget_pool'], names('programs'))).toBe('Pool A')
    expect(formatSetting('general', ['summer', 'r1_table'], names('programs'))).toBe('General')
    expect(formatSetting('ffp', ['summer', 'equity_class'], names('programs'))).toBe('FFP')
    expect(labelOf(['program_tables', 'weekend'], names('round2'))).toBe('Weekend')
    expect(formatSetting('general', ['program_tables', 'summer'], names('round2'))).toBe('General')
    expect(labelOf(['tables', 'ffp'], names('round2'))).toBe('FFP')
    expect(labelOf(['ffp'], names('award_tables'))).toBe('FFP')
    expect(formatSetting('general', ['ffp', 'inherits'], names('award_tables'))).toBe('General')
    expect(formatSetting('ffp', ['tables', 'family', 'inherits'], names('round2'))).toBe('FFP')
    expect(formatSetting(['summer'], ['offset_programs'], names('grants'))).toBe('Summer')
    expect(formatSetting('weekend', ['offset_programs', '0'], names('grants'))).toBe('Weekend')
  })

  it("names equity's classes and criteria, and income's AGI", () => {
    expect(labelOf(['weights', 'ffp'], names('equity'))).toBe('FFP')
    expect(labelOf(['weights', 'family'], names('equity'))).toBe('Family')
    expect(labelOf(['weights', '*', 'trans_nb'], names('equity'))).toBe('Transgender / non-binary')
    expect(labelOf(['weights', '*', 'bipoc'], names('equity'))).toBe('BIPOC')
    expect(formatSetting('agi', ['basis'], names('income'))).toBe('AGI')
    expect(formatSetting('gross', ['basis'], names('income'))).toBe('gross')
  })

  it('borrows a pool’s label when no program has the key, and words a key with neither', () => {
    const vocab = { ...vocabulary, programs: {}, pools: { pool_b: 'Weekend Pool' } }
    expect(keyLabel('pool_b', vocab)).toBe('Weekend Pool')
    expect(keyLabel('spring_table', vocab)).toBe('Spring table')
  })

  it('words a key named like an Object property, never borrowing an inherited one (CodeRabbit)', () => {
    const vocab = { ...vocabulary, programs: {}, pools: {} }
    expect(keyLabel('constructor', vocab)).toBe('Constructor')
    expect(keyLabel('toString', vocab)).toBe('ToString')
    expect(keyWords('constructor')).toBe('Constructor')
  })

  it('has no word of its own for a program acronym any more', () => {
    expect(keyWords('ffp')).toBe('Ffp')
  })

  it("lays keyed rows out by name, keeping each row's key for the editor", () => {
    const pools = settingNodes(contentOf('budget'), names('budget')).find(
      (n) => n.label === 'Pools'
    )
    if (pools?.kind !== 'table') throw new Error('pools are not a table')
    expect(pools.rows.map((r) => [r.key, r.label])).toEqual([
      ['pool_a', 'Pool A'],
      ['pool_b', 'Pool B'],
    ])
    const [summer] = settingNodes(contentOf('programs'), names('programs'))
    expect(summer).toMatchObject({ kind: 'group', label: 'Summer', path: ['summer'] })
  })

  it('says a change in the same words', () => {
    expect(
      changeWords(
        { path: ['pools', 'pool_a', 'share_pct'], kind: 'changed', before: '90', after: '85' },
        names('budget')
      )
    ).toBe('Pools › Pool A › Share %: 90% → 85%')
  })
})

describe("a version's lead line (#23)", () => {
  const approved = (at: string) => ({ state: 'approved' as const, approved_at: at })
  it('names an approved version and the day its last section was approved', () => {
    expect(
      versionWords(4, [approved('2026-10-04T18:00:00Z'), approved('2026-10-05T18:00:00Z')])
    ).toBe('Rules v4 · approved Oct 5, 2026')
    expect(versionWords(4, [{ state: 'locked', approved_at: '2026-10-03T18:00:00Z' }])).toBe(
      'Rules v4 · approved Oct 3, 2026'
    )
  })

  it('says how many sections of a draft are not approved yet', () => {
    expect(versionWords(5, [approved('2026-10-05T18:00:00Z'), { state: 'draft' }])).toBe(
      'Rules v5 · draft: 1 section not approved yet'
    )
    expect(versionWords(5, [{ state: 'draft' }, {}])).toBe(
      'Rules v5 · draft: 2 sections not approved yet'
    )
  })
})

describe('the budget section after the split (spec §8.2, §8.4)', () => {
  it('is titled Budget and pools and carries none of the old reserve, spillover or commit labels', () => {
    expect(SECTION_TITLES.budget).toBe('Budget and pools')
    for (const key of ['reserves', 'r1_late', 'spillover', 'commit_on']) {
      expect(labelOf([key])).not.toMatch(
        /\(% of the pool\)|Late Round 1|between pools|committed when/
      )
    }
  })
})

describe('the card titles (spec §6.2 D)', () => {
  it('names each of the thirteen sections in staff words, Stages gone', () => {
    expect(SECTION_TITLES).toEqual({
      income: "Counting a family's income",
      tiers: 'Income tiers',
      equity: 'Moving a family up a tier',
      award_tables: 'Round 1 award table',
      awards: 'Minimum award and named awards',
      grants: 'Outside grants',
      round2: 'Appeal caps',
      round3: 'Who can ask, and how much',
      budget: 'Budget and pools',
      programs: 'Programs and their sessions',
      cost: 'Costs and Family Camp rates',
      quality_checks: 'Quality checks',
      milestones: 'Dates',
    })
    expect(isRulesSection('stages')).toBe(false)
  })
})
