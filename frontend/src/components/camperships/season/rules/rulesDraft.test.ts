import { describe, expect, it } from 'vitest'

import {
  draftSections,
  SECTION_ORDER,
  sameSection,
  sectionContent,
  withSection,
} from './rulesDraft'
import { RULES_DOCUMENT, rulesDraft } from './rulesFixtures'

describe('reading the rules draft', () => {
  it('lists the sections still in draft, in the list order', () => {
    expect(draftSections(rulesDraft())).toEqual(['award_tables'])
    expect(SECTION_ORDER).toHaveLength(14)
    expect(new Set(SECTION_ORDER).size).toBe(14)
  })

  it("tells a section that read the same from one that didn't", () => {
    const a = rulesDraft()
    const b = rulesDraft()
    expect(sameSection(a, b, 'awards')).toBe(true)
    const moved = b.sections.find((x) => x.section === 'awards')
    if (moved) moved.fingerprint = 'fp-awards-v5'
    expect(sameSection(a, b, 'awards')).toBe(false)
    expect(sameSection(a, b, 'budget')).toBe(true)
    const c = rulesDraft()
    const row = c.sections.find((s) => s.section === 'budget')
    if (row) row.status = { state: 'draft' }
    expect(sameSection(a, c, 'budget')).toBe(false)
  })
})

describe('withSection (D39: what All settings records)', () => {
  it("replaces exactly one section's settings and leaves the rest of the document alone", () => {
    const content = { ...sectionContent(RULES_DOCUMENT, 'awards'), minimum: '150' }
    const next = withSection(RULES_DOCUMENT, 'awards', content)
    expect(next.awards).toEqual(content)
    expect(next).toEqual({ ...RULES_DOCUMENT, awards: content })
    for (const section of SECTION_ORDER.filter((s) => s !== 'awards')) {
      expect(next[section]).toBe(RULES_DOCUMENT[section])
    }
    expect(next.year).toBe(RULES_DOCUMENT.year)
  })

  it('does not change the document it was given', () => {
    const before = JSON.stringify(RULES_DOCUMENT)
    withSection(RULES_DOCUMENT, 'awards', { minimum: '1' })
    expect(JSON.stringify(RULES_DOCUMENT)).toBe(before)
  })
})
