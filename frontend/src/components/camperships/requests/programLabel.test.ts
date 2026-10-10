import { describe, expect, it } from 'vitest'

import { APPROVED_RULES_2026 } from './approvedRulesFixtures'
import { programGroups, programLabel, programLabels, poolLabels, programRank } from './programLabel'

describe('programLabels (the rules name their own programs)', () => {
  it("reads each program's label from the approved rules' programs section", () => {
    expect(programLabels(APPROVED_RULES_2026)).toEqual({
      summer: 'Summer',
      ffp: 'FFP',
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
      pool_a: 'Pool A',
      pool_b: 'Pool B',
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

describe('programGroups (ux3 taxonomy: pool, then the program family under it)', () => {
  const row = (family: string, label: string, pool: string | null) => ({ family, label, pool })
  const seen = [
    row('family_camp', 'Family Camp', 'pool_b'),
    row('summer', 'At Camp', 'pool_a'),
    row('teen', 'Teen Programs', 'pool_a'),
    row('quest', 'Quests', 'pool_a'),
    row('summer', 'At Camp', 'pool_a'),
    row('adult_weekend', 'Adult Weekends', 'pool_b'),
  ]

  it("puts each pool's families under its heading in the rules' pool order, families in the display order, with the server's words", () => {
    expect(programGroups(seen, APPROVED_RULES_2026)).toEqual([
      {
        pool: { value: 'pool_a', label: 'Pool A' },
        programs: [
          { value: 'summer', label: 'At Camp' },
          { value: 'quest', label: 'Quests' },
          { value: 'teen', label: 'Teen Programs' },
        ],
      },
      {
        pool: { value: 'pool_b', label: 'Pool B' },
        programs: [
          { value: 'family_camp', label: 'Family Camp' },
          { value: 'adult_weekend', label: 'Adult Weekends' },
        ],
      },
    ])
  })

  it('has no Family School option unless a row holds one', () => {
    const values = programGroups(seen, APPROVED_RULES_2026).flatMap((g) =>
      g.programs.map((p) => p.value)
    )
    expect(values).not.toContain('family_school')
    const withSchool = programGroups(
      [...seen, row('family_school', 'Family School', 'pool_b')],
      undefined
    )
    expect(withSchool.flatMap((g) => g.programs.map((p) => p.value))).toContain('family_school')
  })

  it("groups by the rows' own pools, keys spelled out, while the read has no answer (no blocking)", () => {
    expect(programGroups(seen, undefined).map((g) => g.pool)).toEqual([
      { value: 'pool_a', label: 'Pool a' },
      { value: 'pool_b', label: 'Pool b' },
    ])
  })

  it('spells the family out when the server sent no word for it', () => {
    expect(programGroups([row('nosuch_family', '', 'pool_a')], undefined)[0]?.programs).toEqual([
      { value: 'nosuch_family', label: 'Nosuch family' },
    ])
  })

  it('lists a family in no pool last, under no heading', () => {
    const groups = programGroups([...seen, row('other', 'Other', null)], APPROVED_RULES_2026)
    expect(groups.at(-1)).toEqual({ pool: null, programs: [{ value: 'other', label: 'Other' }] })
  })
})

describe('programRank (final audit M-E8: pool order, then the rules’ order inside a pool)', () => {
  const entry = (pool: string) => ({ budget_pool: pool })
  const rules = {
    ...APPROVED_RULES_2026,
    sections: [
      {
        ...APPROVED_RULES_2026.sections[1]!,
        // Alphabetical, as the server's object is: not a pool order.
        content: {
          family_camp: entry('weekend'),
          summer: entry('camp_quest'),
          tbm: entry('tbm'),
        },
      },
      {
        ...APPROVED_RULES_2026.sections[2]!,
        content: {
          total: 1,
          pools: {
            camp_quest: { label: 'Camp & Quest' },
            tbm: { label: 'TBM' },
            weekend: { label: 'Weekend Programs' },
          },
        },
      },
    ],
  }

  it('ranks Summer, then the ledger-only Quest and Teen in its pool, then TBM, then Family Camp', () => {
    const rank = programRank(rules)
    const order = ['family_camp', 'bmitzvah', 'teen', 'quest', 'summer', 'tbm', 'other'].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b)
    )
    // B*Mitzvah is the rules' TBM; a family nothing names comes last.
    expect(order).toEqual(['summer', 'quest', 'teen', 'tbm', 'bmitzvah', 'family_camp', 'other'])
  })

  it('sends a program filed under a pool the rules do not list after every listed pool', () => {
    const stray = {
      ...rules,
      sections: [
        {
          ...rules.sections[0]!,
          content: { ...rules.sections[0]!.content, ghost: entry('removed_pool') },
        },
        rules.sections[1]!,
      ],
    }
    const rank = programRank(stray)
    expect(rank('ghost')).toBeGreaterThan(rank('family_camp'))
    expect(rank('ghost')).toBeGreaterThan(rank('summer'))
  })

  it('ranks every key alike while the rules have not loaded', () => {
    const rank = programRank(undefined)
    expect(rank('summer')).toBe(rank('family_camp'))
  })
})
