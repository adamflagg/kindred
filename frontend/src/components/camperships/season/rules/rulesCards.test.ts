import { describe, expect, it } from 'vitest'

import { contentOf, RULES_DOCUMENT } from './rulesFixtures'
import {
  CARD_SPECS,
  CHOICE_WORDS,
  HIDDEN_PATHS,
  namedAwardNote,
  namedAwardRows,
  rowWords,
  settingText,
} from './rulesCards'
import { rulesVocabulary } from './rulesModel'

const names = { section: 'income' as const, ...rulesVocabulary((s) => RULES_DOCUMENT[s]) }

describe('card content (spec §6.2 E)', () => {
  it("Counting a family's income: three sub-heads, the Fix 1 descriptions, current-year weight read-only", () => {
    const income = CARD_SPECS.income!
    expect(income.groups.map((g) => g.head)).toEqual([
      'Which years count',
      'Expenses and savings',
      'Dependents',
    ])
    expect(income.groups[0]?.rows.map((r) => [r.label, r.desc])).toEqual([
      ['Prior-year weight', ''],
      [
        'Prior-year income measure',
        '"The confirmed figure" falls back to gross income when a family has none.',
      ],
      ["When this year's income is $0", ''],
    ])
    expect(income.readOnly.map((r) => r.label)).toEqual(['Current-year weight'])
  })

  it('never renders a hidden setting (§6.4)', () => {
    const shown = Object.values(CARD_SPECS).flatMap((spec) => [
      ...spec.groups.flatMap((g) => g.rows.map((r) => r.path.join('.'))),
      ...spec.readOnly.map((r) => r.path.join('.')),
    ])
    for (const hidden of HIDDEN_PATHS) expect(shown).not.toContain(hidden)
    expect(HIDDEN_PATHS).toEqual(
      expect.arrayContaining(['medical_rate', 'floor', 'floor_tier', 'rounding', 'count_when'])
    )
  })

  it("Who can ask, and how much: the registrar's limit with its one description, the rest bare, two read-only checks", () => {
    const r3 = CARD_SPECS.round3!
    expect(r3.groups[0]?.rows.map((r) => [r.label, r.desc])).toEqual([
      ["The registrar's limit", 'A larger amount waits for finance as Pending approval.'],
      ['Most per request', ''],
      ['Most, as a share of the cost', ''],
    ])
    expect(r3.readOnly.map((r) => r.label)).toEqual([
      'Needs a Round 2 decision first',
      'Needs a statement of need',
    ])
  })

  it('Dates opens with the Fix 1 line and lists all seven dates in two groups', () => {
    const dates = CARD_SPECS.milestones!
    expect(dates.lead).toBe(
      'The application deadline is also the default "received through" date for reports and what-ifs.'
    )
    expect(dates.groups.map((g) => [g.head, g.rows.length])).toEqual([
      ['Applications and Round 1', 3],
      ['Round 2 and Round 3', 4],
    ])
  })

  it('reads staff words for each choice', () => {
    expect(CHOICE_WORDS['dependents_mode']).toEqual({
      tier_shift: 'Move the tier',
      income_reduction: 'Lower the income',
      none: 'Not counted',
    })
    expect(CHOICE_WORDS['kind']?.['full_cost_after_aid']).toBe('Full cost after camp aid')
    expect(CHOICE_WORDS['late_grant_policy']?.['flag']).toBe('Leave it out, flag it')
  })

  it('shows a value and, where the draft changed it, "was ‹old›"; whole dollars, never cents', () => {
    const content = { ...contentOf('awards'), minimum: '150' }
    const approved = { ...contentOf('awards'), minimum: '108' }
    const row = CARD_SPECS.awards!.groups[0]!.rows[0]!
    expect(rowWords(row, content, approved, { ...names, section: 'awards' })).toEqual({
      text: '$150',
      was: '$108',
    })
    expect(settingText(null, 'money?', ['max_amount'], names, 'No limit')).toBe('No limit')
    expect(settingText('0.75', 'frac', ['weights', 'prior_year'], names)).toBe('75%')
    expect(settingText(true, 'bool', ['require_round2'], names)).toBe('✓')
    expect(settingText('2027-02-01', 'date?', ['application_deadline'], names)).toBe('Feb 1, 2027')
    expect(settingText(null, 'date?', ['r1_run'], names)).toBe('Not set')
  })
})

it("derives a named award's row note from its kind, in generic words (spec §6.2 E.4)", () => {
  expect(namedAwardNote('full_cost_after_aid')).toBe(
    'Pays the rest after the camp award and outside grants, outside the budget; no extra amount.'
  )
  for (const kind of ['full_cost', 'top_up', 'discretionary'])
    expect(namedAwardNote(kind)).toBeNull()
  // Owner 10-06 (c): named funds are managed in Grants › Grantors; the row only reads.
  const rows = namedAwardRows(
    {
      decision_types: {
        fund: { label: 'Named full-cost fund', kind: 'full_cost_after_aid', round: 1 },
        top: { label: 'Top', kind: 'top_up', round: 2, amount: '300' },
      },
    },
    { ...names, section: 'awards' }
  )
  expect(rows.map((r) => [r.key, r.managedInGrants])).toEqual([
    ['fund', true],
    ['top', false],
  ])
})
