import { describe, expect, it } from 'vitest'

import { APPROVED_RULES_2026 } from './approvedRulesFixtures'
import { programLabel, programLabels } from './programLabel'

describe('programLabels (the rules name their own programs)', () => {
  it("reads each program's label from the approved rules' programs section", () => {
    expect(programLabels(APPROVED_RULES_2026)).toEqual({
      summer: 'Summer',
      tbm: 'TBM',
      family_camp: 'Family camp',
      womens_weekend: "Women's weekend",
      mens_weekend: "Men's weekend",
    })
  })

  it('is empty while the read is loading, failed, or answered "no rules yet"', () => {
    expect(programLabels(undefined)).toEqual({})
  })

  it('is empty when the programs section is not approved yet', () => {
    const noPrograms = {
      ...APPROVED_RULES_2026,
      sections: APPROVED_RULES_2026.sections.filter((s) => s.section !== 'programs'),
    }
    expect(programLabels(noPrograms)).toEqual({})
    const draftPrograms = {
      ...APPROVED_RULES_2026,
      sections: APPROVED_RULES_2026.sections.map((s) =>
        s.section === 'programs' ? { ...s, content: null } : s
      ),
    }
    expect(programLabels(draftPrograms)).toEqual({})
  })

  it('skips an entry that has no label string', () => {
    const odd = {
      ...APPROVED_RULES_2026,
      sections: [
        {
          ...APPROVED_RULES_2026.sections[1]!,
          content: { summer: { label: 'Summer' }, broken: { label: 7 }, nothing: null },
        },
      ],
    }
    expect(programLabels(odd)).toEqual({ summer: 'Summer' })
  })
})

describe('programLabel', () => {
  const labels = programLabels(APPROVED_RULES_2026)

  it("shows the rules' own label for a key they name", () => {
    expect(programLabel(labels, 'family_camp')).toBe('Family camp')
    expect(programLabel(labels, 'womens_weekend')).toBe("Women's weekend")
  })

  it('spells out a key with no label, never the raw underscore form', () => {
    expect(programLabel({}, 'summer')).toBe('Summer')
    expect(programLabel(labels, 'quest')).toBe('Quest')
    expect(programLabel({}, 'winter_retreat')).toBe('Winter retreat')
  })
})
