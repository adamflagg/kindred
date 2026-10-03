import { describe, expect, it } from 'vitest'

import { APPROVED_RULES_2026 } from './approvedRulesFixtures'
import { programGroups, programLabel, programLabels, poolLabels } from './programLabel'

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

describe('poolLabels (the rules name their budget pools)', () => {
  it("reads each pool's label from the approved rules' budget section", () => {
    expect(poolLabels(APPROVED_RULES_2026)).toEqual({
      pool_a: 'Camp & Quest',
      pool_b: 'Weekend Programs',
    })
  })

  it('is empty while the read has no answer, or the budget is not approved', () => {
    expect(poolLabels(undefined)).toEqual({})
    const noBudget = {
      ...APPROVED_RULES_2026,
      sections: APPROVED_RULES_2026.sections.map((s) =>
        s.section === 'budget' ? { ...s, content: null } : s
      ),
    }
    expect(poolLabels(noBudget)).toEqual({})
  })
})

describe('programGroups (T6: one Program dropdown, pools as headings)', () => {
  const seen = [
    { program: 'family_camp', pool: 'pool_b' },
    { program: 'summer', pool: 'pool_a' },
    { program: 'quest', pool: 'pool_a' },
    { program: 'summer', pool: 'pool_a' },
  ]

  it("puts each pool's programs under its heading, in the rules' pool order, with the rules' words", () => {
    expect(programGroups(seen, APPROVED_RULES_2026)).toEqual([
      {
        pool: { value: 'pool_a', label: 'Camp & Quest' },
        programs: [
          { value: 'quest', label: 'Quest' },
          { value: 'summer', label: 'Summer' },
        ],
      },
      {
        pool: { value: 'pool_b', label: 'Weekend Programs' },
        programs: [{ value: 'family_camp', label: 'Family camp' }],
      },
    ])
  })

  it("files a program under the rules' budget pool, before the row's own", () => {
    const moved = [{ program: 'tbm', pool: 'pool_b' }]
    expect(programGroups(moved, APPROVED_RULES_2026)[0]?.pool?.value).toBe('pool_a')
  })

  it("groups by the rows' own pools, keys spelled out, while the read has no answer (no blocking)", () => {
    expect(programGroups(seen, undefined)).toEqual([
      {
        pool: { value: 'pool_a', label: 'Pool a' },
        programs: [
          { value: 'quest', label: 'Quest' },
          { value: 'summer', label: 'Summer' },
        ],
      },
      {
        pool: { value: 'pool_b', label: 'Pool b' },
        programs: [{ value: 'family_camp', label: 'Family camp' }],
      },
    ])
  })

  it('lists a program in no pool last, under no heading', () => {
    const groups = programGroups(
      [...seen, { program: 'not_aided', pool: null }],
      APPROVED_RULES_2026
    )
    expect(groups.at(-1)).toEqual({
      pool: null,
      programs: [{ value: 'not_aided', label: 'Not aided' }],
    })
  })

  it('lists a program in no pool last while the read has no answer too', () => {
    const groups = programGroups([{ program: 'not_aided', pool: null }, ...seen], undefined)
    expect(groups.map((g) => g.pool?.value ?? null)).toEqual(['pool_a', 'pool_b', null])
  })
})
