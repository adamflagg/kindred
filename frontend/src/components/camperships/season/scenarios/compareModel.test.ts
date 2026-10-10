import { describe, expect, it } from 'vitest'

import type { ApiAidCompareColumn, ApiAidRulesDocument } from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { rulesVocabulary } from '../rules/rulesModel'
import {
  columnChoices,
  columnHeads,
  columnParams,
  columnsFromView,
  compareQuery,
  compareRows,
  compareSources,
  cornerWords,
  defaultColumns,
  toggleColumn,
  withNewKeep,
  type ColumnKey,
  type CompareSource,
} from './compareModel'
import { compareOut, OPTIONS, workspace } from './scenarioFixtures'

const WS = workspace({
  pricing_version: 4,
  rules_version: 4,
  last_rules_version: 3,
  options: [...OPTIONS],
})
const [draftColumn, a1Column] = compareOut().columns
const RULES_COLUMN: ApiAidCompareColumn = {
  ...a1Column!,
  code: 'rules',
  label: 'Rules v4 in effect',
  changes: [],
  up: null,
  down: null,
  version: 4,
  approved_at: '2027-01-12T20:00:00Z',
  via: 'B',
}
// B moves three settings in three sections: the minimum, an equity weight on a criterion with a label of its own, and
// a Round 1 cell. RULES_DOCUMENT has no criteria and no weights, and its "general" table is 90/60/20.
const PERSON_OF_COLOR = {
  key: 'bipoc',
  label: 'Person of color',
  source: 'household',
  field: 'bipoc',
  also_fields: [],
  match: 'equals_any',
  values: ['yes'],
  min_value: null,
  enabled: true,
}
const B_DOCUMENT = {
  ...RULES_DOCUMENT,
  awards: { ...RULES_DOCUMENT.awards, minimum: '125' },
  equity: {
    ...RULES_DOCUMENT.equity,
    criteria: [PERSON_OF_COLOR],
    weights: { general: { bipoc: '0.75' } },
  },
  award_tables: {
    general: {
      inherits: null,
      tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '55' }, '3': { r1_pct: '20' } },
      overrides: {},
    },
  },
} as ApiAidRulesDocument
const KEPT_B: ApiAidCompareColumn = {
  ...a1Column!,
  code: 'B',
  label: 'bands $5,000 wider',
  document: B_DOCUMENT,
  changes: [
    { path: ['awards', 'minimum'], kind: 'changed', before: '100', after: '125' },
    { path: ['equity', 'weights', 'general', 'bipoc'], kind: 'added', before: null, after: '0.75' },
    {
      path: ['award_tables', 'general', 'tiers', '2', 'r1_pct'],
      kind: 'changed',
      before: '60',
      after: '55',
    },
  ],
  up: 4,
  down: 1,
}
const COMPARE = compareOut({ columns: [RULES_COLUMN, draftColumn!, KEPT_B] })
const SOURCES = compareSources(COMPARE, true)
// The vocabulary only: each row reads its path under its own section.
const NAMES = rulesVocabulary((section) => (B_DOCUMENT as Record<string, unknown>)[section])

describe('Columns ▾ (§S5 H; N11)', () => {
  it('lists every column in the fixed order, the draft only while it has unkept changes', () => {
    expect(columnChoices(WS, false).map((c) => c.key)).toEqual([
      'rules',
      'last_rules',
      'kept:A',
      'kept:A1',
      'kept:B',
      'last_season',
    ])
    expect(columnChoices(WS, true).map((c) => c.key)).toEqual([
      'rules',
      'last_rules',
      'draft',
      'kept:A',
      'kept:A1',
      'kept:B',
      'last_season',
    ])
    expect(columnChoices(WS, false)[0]?.label).toBe('Rules v4 in effect')
    expect(columnChoices(workspace({ last_rules_version: null }), false)[1]).toEqual({
      key: 'last_rules',
      label: "Last season's rules (none approved)",
      disabled: true,
    })
  })

  it('refuses a fifth kept-or-draft column and keeps the fixed order whatever the click order', () => {
    const order = columnChoices(WS, true).map((c) => c.key)
    const four: ColumnKey[] = ['draft', 'kept:A', 'kept:A1', 'kept:B']
    expect(toggleColumn(four, 'kept:C', order)).toEqual({
      checked: four,
      refused: 'Four kept options are already columns: uncheck one to add C.',
    })
    expect(toggleColumn(['kept:B'], 'rules', order).checked).toEqual(['rules', 'kept:B'])
    expect(toggleColumn(['rules', 'kept:B'], 'rules', order).checked).toEqual(['kept:B'])
  })

  it('adds a new keep to the checked columns in its place while there is room (§S5 B)', () => {
    // Columns ▾ read before C arrives: rules, last_rules, kept:A, kept:A1, kept:B, last_season.
    const order = columnChoices(WS, false).map((c) => c.key)
    expect(withNewKeep(['rules', 'kept:B', 'last_season'], 'C', order)).toEqual([
      'rules',
      'kept:B',
      'kept:C',
      'last_season',
    ])
    expect(withNewKeep(['draft', 'kept:A', 'kept:A1', 'kept:B'], 'C', order)).toBeNull() // four already
    expect(withNewKeep([], 'C', order)).toBeNull() // no columns: Compare opens on its defaults, which hold C
  })

  it('opens first with the rules in effect, the three newest kept options and last season', () => {
    expect(defaultColumns(WS)).toEqual(['rules', 'kept:A', 'kept:A1', 'kept:B', 'last_season'])
  })

  it('reads the columns from the URL and asks for exactly them', () => {
    const checked = columnsFromView({
      codes: ['B'],
      rules: true,
      lastRules: false,
      draft: true,
      lastSeason: true,
    })
    expect(checked).toEqual(['rules', 'draft', 'kept:B', 'last_season'])
    expect(compareQuery(checked, { kind: 'deadline' })).toEqual({
      codes: ['B'],
      requestSet: { kind: 'deadline' },
      lastSeason: true,
      rules: true,
      lastRules: false,
      draft: true,
      asIfUnposted: false,
    })
    expect(compareQuery(checked, { kind: 'all' }, true).asIfUnposted).toBe(true)
  })
})

describe('the heads (§S5 H; scenarios-10)', () => {
  it('names each column "‹code› · ‹name›" and says where it came from, with no chip', () => {
    const heads = columnHeads(SOURCES, WS, 'from B · 1 change')
    expect(heads.map((h) => [h.headline, h.meta])).toEqual([
      ['Rules v4 in effect', 'approved Jan 12 · from B'],
      ['Your draft, not kept', 'from B · 1 change'],
      // B was kept Jan 14 on 420 applications: Round 1 740,000 + Round 2 20,500.
      ['B · bands $5,000 wider', 'kept Jan 14 · 420 applications · $760,500'],
      ['Last season, posted', '2026, posted (as of Jan 3, 2027)'],
    ])
    expect(heads[2]?.name).toBe('bands $5,000 wider')
    expect(heads[2]?.option?.code).toBe('B')
    expect(heads[0]).not.toHaveProperty('chip')
  })

  it('carries the kept-day sentence in a kept column’s title', () => {
    const heads = columnHeads(SOURCES, WS, 'from B · 1 change')
    expect(heads[2]?.title).toBe(
      'B · bands $5,000 wider: kept Jan 14 · 420 applications · $760,500; the kept line is what it priced the day it was kept'
    )
    expect(heads[0]?.title).toBe('Rules v4 in effect: approved Jan 12 · from B')
  })
})

describe('the rows (§S5 H; N3, N4, N10)', () => {
  const rows = compareRows(SOURCES, {
    byTier: false,
    locked: false,
    effectName: 'Rules v4',
    names: NAMES,
  })
  const row = (label: string) => rows.find((r) => r.label === label)

  it('names each setting as the Rules tab does, by its own section, and marks the columns that differ', () => {
    // Literal labels (plan review M4): the section's card title (parent Task 19's SECTION_TITLES), then each step of
    // the path read under that section. Columns: the rules in effect, the draft (minimum 150), B, last season.
    expect(rows[0]).toMatchObject({ kind: 'section', label: 'Settings that differ from Rules v4' })
    const cells = (label: string) => row(label)?.cells.map((c) => [c.text, c.tone ?? null])
    expect(cells('Minimum award and named awards › Minimum award')).toEqual([
      ['$100', null],
      ['$150', 'changed'],
      ['$125', 'changed'],
      ['—', null],
    ])
    // The criterion's own label, never its key ("Bipoc") or the vocabulary's word for it ("BIPOC").
    expect(cells('Moving a family up a tier › Weights › General › Person of color')).toEqual([
      ['—', null],
      ['—', null],
      ['0.75', 'changed'],
      ['—', null],
    ])
    expect(cells('Round 1 award table › General › Tiers › Tier 2 › Round 1 %')).toEqual([
      ['60%', null],
      ['60%', null],
      ['55%', 'changed'],
      ['—', null],
    ])
  })

  it('titles a changed cell with the rules in effect’s own figure (the mock: "Differs from Rules v3 ($108)")', () => {
    const minimum = row('Minimum award and named awards › Minimum award')
    expect(minimum?.cells[1]?.title).toBe('Differs from Rules v4 ($100)')
    expect(minimum?.cells[0]?.title).toBeUndefined()
  })

  it('averages Round 1 over the requests priced, as the mock does (owner Q11), never the committee’s tier-rows figure', () => {
    const cells = row('Average Round 1 per request')?.cells.map((c) => c.text)
    // Columns: rules, draft (735,000), B (760,000), each on 420 requests priced; last season's fixture view carries
    // no request count, so there is nothing to divide by.
    expect(cells).toEqual(['$1,810', '$1,750', '$1,810', '—'])
  })

  it('shows an em dash for the average when no requests were priced', () => {
    const none = compareRows(
      compareSources(
        compareOut({
          columns: [{ ...KEPT_B, results: { ...KEPT_B.results, requests: 0 } }],
        }),
        false
      ),
      { byTier: false, locked: false, effectName: 'Rules v4', names: NAMES }
    ).find((r) => r.label === 'Average Round 1 per request')
    expect(none?.cells[0]?.text).toBe('—')
  })

  it('points the Projected season row at the Projected note (3)', () => {
    expect(row('Projected season')?.defNote).toBe(3)
  })

  it('says none differ when every column has the rules’ settings', () => {
    const plain = compareRows(compareSources(compareOut({ columns: [RULES_COLUMN] }), false), {
      byTier: false,
      locked: false,
      effectName: 'Rules v4',
      names: NAMES,
    })
    expect(plain[1]).toMatchObject({
      kind: 'note',
      label: "None: every column has the rules' settings.",
    })
  })

  it('spends by pool, with Round 2 and 3 before any appeal, and last season’s posted money', () => {
    expect(row('Round 1')?.cells.map((c) => c.text)).toEqual([
      '$760,000',
      '$735,000',
      '$760,000',
      '$649,247',
    ])
    expect(row('Round 2')?.cells.map((c) => [c.text, c.tone ?? null])).toEqual([
      ['no appeals yet', 'muted'],
      ['no appeals yet', 'muted'],
      ['no appeals yet', 'muted'],
      ['$20,500', null],
    ])
    expect(row('Round 3')?.cells.map((c) => c.text)).toEqual([
      'none yet',
      'none yet',
      'none yet',
      '$0',
    ])
  })

  it('counts requests up and down against the rules in effect, never on the rules or last season', () => {
    expect(
      row('Requests up / down against Rules v4')?.cells.map((c) => c.upDown ?? c.text)
    ).toEqual(['—', { up: 12, down: 3 }, { up: 4, down: 1 }, '—'])
  })

  it('says posted Round 1 stands after the lock on a column whose Round 1 settings differ', () => {
    const after = compareRows(SOURCES, {
      byTier: false,
      locked: true,
      effectName: 'Rules v4',
      names: NAMES,
    })
    const round1 = after.find((r) => r.label === 'Round 1')
    expect(round1?.cells.map((c) => c.note ?? null)).toEqual([
      null,
      'posted Round 1 stands',
      'posted Round 1 stands',
      null,
    ])
    expect(after.some((r) => r.label === 'Round 2, appeals keyed so far')).toBe(true)
  })

  it('prices every column as if nothing is posted when the server says so: no posted Round 1 stands, and it says what it would cost', () => {
    const fresh: CompareSource[] = SOURCES.map((s) =>
      s.kind === 'priced'
        ? {
            kind: 'priced',
            column: { ...s.column, results: { ...s.column.results, as_if_unposted: true } },
          }
        : s
    )
    const after = compareRows(fresh, {
      byTier: false,
      locked: true,
      effectName: 'Rules v4',
      names: NAMES,
    })
    const labels = after.map((r) => r.label)
    expect(labels).toContain('Spend as if nothing is posted, by pool')
    expect(labels).not.toContain('Spend, by pool')
    expect(labels).toContain('Would remain')
    expect(labels).not.toContain('Remaining')
    expect(after.find((r) => r.label === 'Round 1')?.cells.map((c) => c.note ?? null)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('projects each priced column, never last season', () => {
    const projected = compareRows(
      compareSources(
        compareOut({
          columns: [
            {
              ...KEPT_B,
              results: {
                ...KEPT_B.results,
                projection: {
                  share: 0.4,
                  through: '2027-02-03',
                  basis_year: 2026,
                  aligned_on: 'application_deadline',
                  requests: 1050,
                  round1: 1900400,
                  round1_and_2: 1950000,
                  remaining: -950000,
                  pools: [],
                },
              },
            },
          ],
        }),
        true
      ),
      { byTier: false, locked: false, effectName: 'Rules v4', names: NAMES }
    ).find((r) => r.label === 'Projected season')
    expect(projected?.cells.map((c) => [c.text, c.sub ?? null])).toEqual([
      ['≈$1,900,000', 'Remaining ≈−$950,000'],
      ['— its whole season', null],
    ])
  })

  it('adds Round 1 by tier against what was asked', () => {
    const tiers = compareRows(SOURCES, {
      byTier: true,
      locked: false,
      effectName: 'Rules v4',
      names: NAMES,
    })
    const tier1 = tiers.find((r) => r.label === 'Tier 1')
    expect(tier1?.cells[0]).toEqual({ text: '$350,000', sub: '70% of ask' })
  })

  it('says in the corner what every column is priced on', () => {
    expect(cornerWords(SOURCES, { kind: 'all' })).toBe('Priced on 420 applications held')
    // The columns' own request set, not Price ▾'s: kept figures from a read on every application held stay worded
    // so while Price ▾ asks for the deadline (CodeRabbit on #3047; lead #29 ruling 3).
    expect(cornerWords(SOURCES, { kind: 'deadline' })).toBe('Priced on 420 applications held')
  })

  it('shows whole dollars where a figure has cents (coordinator ruling 2026-10-07)', () => {
    const cents: ApiAidCompareColumn = {
      ...KEPT_B,
      results: { ...KEPT_B.results, round1: 760000.5, remaining: -41495.66 },
    }
    const fractional = compareSources(compareOut({ columns: [cents] }), false)
    const out = compareRows(fractional, {
      byTier: false,
      locked: false,
      effectName: 'Rules v4',
      names: NAMES,
    })
    expect(out.find((r) => r.label === 'Round 1')?.cells[0]?.text).toBe('$760,001')
    expect(out.find((r) => r.label === 'Remaining')?.cells[0]).toEqual({
      text: '−$41,496',
      tone: 'total-negative',
    })
  })

  it('shows a money setting with cents in whole dollars, and words income bands (coordinator ruling 1; V F1)', () => {
    // A fractional threshold and a changed list of bands. The shared formatSetting would print "$1,500.50" and the
    // bands as raw JSON; Compare reads whole dollars and the bands as the Rules tab's tier grid words a range.
    const bands = [
      { lower: '0', upper: '35000' },
      { lower: '35001', upper: null },
    ]
    const fractional: ApiAidCompareColumn = {
      ...KEPT_B,
      document: {
        ...RULES_DOCUMENT,
        income: { ...RULES_DOCUMENT.income, medical_threshold: '1500.5' },
        tiers: { ...RULES_DOCUMENT.tiers, bands },
      },
      changes: [
        { path: ['income', 'medical_threshold'], kind: 'changed', before: '5000', after: '1500.5' },
        {
          path: ['tiers', 'bands'],
          kind: 'changed',
          before: RULES_DOCUMENT.tiers.bands,
          after: bands,
        },
      ],
    }
    const out = compareRows(
      compareSources(compareOut({ columns: [RULES_COLUMN, fractional] }), false),
      { byTier: false, locked: false, effectName: 'Rules v4', names: NAMES }
    )
    const cells = (label: string) =>
      out.find((r) => r.label === label)?.cells.map((c) => [c.text, c.tone ?? null])
    expect(cells("Counting a family's income › Medical expenses counted above")).toEqual([
      ['$5,000', null],
      ['$1,501', 'changed'],
    ])
    expect(cells('Income tiers › Income bands')).toEqual([
      ['$0 – $40,000, $40,001 – $70,000, $70,001 and up', null],
      ['$0 – $35,000, $35,001 and up', 'changed'],
    ])
  })
})

describe('the URL (§S5 L)', () => {
  it('writes the checked columns back to the URL (§S5 L)', () => {
    expect(columnParams(['rules', 'draft', 'kept:B', 'kept:A', 'last_season'])).toEqual({
      compare: 'B,A',
      rules: '1',
      lastrules: null,
      draft: '1',
      last: '1',
    })
    expect(columnParams([])).toEqual({
      compare: null,
      rules: null,
      lastrules: null,
      draft: null,
      last: null,
    })
  })
})
