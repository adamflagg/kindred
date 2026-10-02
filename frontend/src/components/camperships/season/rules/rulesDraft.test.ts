import { describe, expect, it } from 'vitest'

import { draftSections, SECTION_ORDER, sameSection } from './rulesDraft'
import { rulesDraft } from './rulesFixtures'

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
    b.document.awards = { ...b.document.awards, minimum: '120' }
    expect(sameSection(a, b, 'awards')).toBe(false)
    expect(sameSection(a, b, 'budget')).toBe(true)
    const c = rulesDraft()
    const row = c.sections.find((s) => s.section === 'budget')
    if (row) row.status = { state: 'draft' }
    expect(sameSection(a, c, 'budget')).toBe(false)
  })
})
