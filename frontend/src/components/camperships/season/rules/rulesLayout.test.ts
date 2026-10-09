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
  it('keeps only the Round 3 section in chapter 3', () => {
    expect(CHAPTERS.find((c) => c.n === 3)?.cards).toEqual(['round3'])
  })

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

  it('chapter 5 is one card over two sections, and its marks sum both', () => {
    const chapter = CHAPTERS.find((c) => c.n === 5)!
    expect(chapter.cards).toEqual(['programs_costs'])
    expect(sectionsOf(chapter)).toEqual(['programs', 'cost'])
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

  it("names a folded chapter's errors as errors, in red, before its warnings (scan #3043)", () => {
    const statuses = new Map([
      ['awards', { pill: 'In effect', tone: 'emerald', meta: '', note: null }],
    ] as const)
    expect(chapterSummary(CHAPTERS[1]!, new Map(statuses), 3, 1)).toEqual([
      { text: '1 in effect', tone: 'emerald' },
      { text: '1 error', tone: 'red' },
      { text: '2 warnings', tone: 'amber' },
    ])
  })
})

describe('footnotes (spec §6.2 H; final-v2 season-rules.html: six notes, §12)', () => {
  it('numbers six page notes in the approved mock words, the term bold', () => {
    expect(RULES_FOOTNOTES.map((n) => n.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(RULES_FOOTNOTES.map((n) => n.term)).toEqual([
      'Locked',
      'Tier',
      'Income ceiling',
      'Read-only',
      'Named award kinds',
      'Equity class',
    ])
    expect(RULES_FOOTNOTES[1]?.text).toBe(
      'Tier: tier 1 is the lowest income and gets the most aid. Equity criteria move a family toward it, never past tier 1.'
    )
    expect(RULES_FOOTNOTES[4]?.text).toBe(
      "Named award kinds: Full cost = the cost less grants, plus the extra amount · Full cost after camp aid = what the camp award and grants leave · Fixed top-up = adds its amount · Staff type the amount. One that doesn't count toward the budget sits below the line."
    )
    // Privacy (Global Constraints): the class note is generic, and it names no program or class.
    expect(RULES_FOOTNOTES[5]?.text).toBe(
      "Equity class: picks a program's equity weights and its award table (Round 1 % and appeal caps)."
    )
  })

  it('drops the "always hold" note: Quality checks says it on its own line', () => {
    expect(RULES_FOOTNOTES.some((n) => n.text.includes('always hold'))).toBe(false)
  })
})
