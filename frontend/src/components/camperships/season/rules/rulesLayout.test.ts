import { describe, expect, it } from 'vitest'

import { rulesDraft } from './rulesFixtures'
import {
  CHAPTERS,
  chapterMarks,
  chapterOfSection,
  chapterSummary,
  defaultOpen,
  GRID_TITLES,
  parseOpenChapters,
  RULES_FOOTNOTES,
  sectionsOf,
  toggleChapter,
} from './rulesLayout'

describe('chapters (spec §6.2 C)', () => {
  it('lists the seven chapters in their groups, Round 2 gone', () => {
    expect(CHAPTERS.map((c) => [c.n, c.title, c.group])).toEqual([
      [1, 'Tiers & equity', 'Awards'],
      [2, 'Awards', 'Awards'],
      [3, 'Round 3', 'Awards'],
      [4, 'Checks', 'Awards'],
      [5, 'Programs', 'Setup'],
      [6, 'Dates', 'Setup'],
      [7, 'Grants', 'Setup'],
    ])
    expect(sectionsOf(CHAPTERS[0]!)).toEqual([
      'income',
      'tiers',
      'award_tables',
      'round2',
      'equity',
    ])
    expect(chapterOfSection('round2')?.n).toBe(1)
    expect(chapterOfSection('budget')).toBeNull()
    expect(GRID_TITLES).toEqual({
      tiers: 'Income tiers',
      award_tables: 'Round 1 award table',
      round2: 'Appeal caps, by tier',
    })
  })

  it('opens the chapters holding a draft section or an issue, and folds the rest', () => {
    expect(defaultOpen(rulesDraft())).toEqual([1]) // award_tables is the fixture's draft section
    const d = rulesDraft()
    const warned = {
      ...d,
      sections: d.sections.map((s) => (s.section === 'milestones' ? { ...s, warnings: 1 } : s)),
    }
    expect(defaultOpen(warned)).toEqual([1, 6])
    expect(defaultOpen(null)).toEqual([])
  })

  it('reads ?open= as chapter numbers, and writes it back on a click', () => {
    expect(parseOpenChapters('1,5')).toEqual([1, 5])
    expect(parseOpenChapters(null)).toBeNull()
    expect(parseOpenChapters('x,9')).toEqual([])
    expect(toggleChapter([1, 5], 5)).toBe('1')
    expect(toggleChapter([1], 1)).toBe('')
  })
})

describe('chip marks (spec §6.2 A)', () => {
  it('a dot for a draft section, a count for its issues, nothing for a receipt or the registrar', () => {
    const d = rulesDraft()
    expect(chapterMarks(CHAPTERS[0]!, d)).toEqual({
      draft: true,
      issues: d.sections
        .filter((s) => ['income', 'tiers', 'award_tables', 'round2', 'equity'].includes(s.section))
        .reduce((n, s) => n + s.errors + s.warnings, 0),
    })
    expect(chapterMarks(CHAPTERS[4]!, null)).toEqual({ draft: false, issues: 0 })
  })
})

describe('a folded chapter (spec §6.2 C; disagreement 8)', () => {
  it('counts locked and in-effect sections and names each draft one', () => {
    const statuses = new Map([
      ['income', { pill: 'Locked', tone: 'stone', meta: '', note: null }],
      ['tiers', { pill: 'Locked', tone: 'stone', meta: '', note: null }],
      ['award_tables', { pill: 'Draft · 1 change', tone: 'amber', meta: '', note: null }],
      ['round2', { pill: 'In effect', tone: 'emerald', meta: '', note: null }],
      ['equity', { pill: 'Locked', tone: 'stone', meta: '', note: null }],
    ] as const)
    expect(chapterSummary(CHAPTERS[0]!, new Map(statuses), 2)).toEqual([
      { text: '3 locked', tone: 'stone' },
      { text: '1 in effect', tone: 'emerald' },
      { text: 'Round 1 award table: draft · 1 change', tone: 'amber' },
      { text: '2 warnings', tone: 'amber' },
    ])
  })
})

describe('footnotes (spec §6.2 H; rules-v3 Fix 1)', () => {
  it('numbers the seven page notes in the mock words', () => {
    expect(RULES_FOOTNOTES.map((n) => n.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(RULES_FOOTNOTES[1]?.text).toBe(
      'Tier: tier 1 is the lowest income and gets the most aid; equity criteria can move a family toward it, never past tier 1.'
    )
    expect(RULES_FOOTNOTES[4]?.text).toContain(
      'full cost after camp aid pays what the camp award and outside grants leave of the cost'
    )
    // Privacy (Global Constraints): the class note is generic, and it names no program or class.
    expect(RULES_FOOTNOTES[6]?.text).toBe(
      "Equity class: picks both the program's row of equity weights and its award table (Round 1 % and appeal caps)."
    )
  })
})
