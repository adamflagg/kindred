import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDocument, ApiAidValidationIssue } from '../../../../types/api-types'
import { RULES_DOCUMENT } from './rulesFixtures'
import type { RulesNames, StatusWords } from './rulesModel'
import { TierGridCard } from './TierGridCard'
import { bandsOf } from './tierGrid'

const DOC: ApiAidRulesDocument = {
  ...RULES_DOCUMENT,
  tiers: { ...RULES_DOCUMENT.tiers, bands: bandsOf(0, 35000, 3), income_ceiling: null },
  award_tables: {
    summer: {
      inherits: null,
      tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '75' }, '3': { r1_pct: '55' } },
      overrides: {},
    },
    teen: { inherits: 'summer', tiers: {}, overrides: { '2': { r1_pct: '70' } } },
    family: { inherits: 'summer', tiers: {}, overrides: {} },
  },
  round2: {
    ...RULES_DOCUMENT.round2,
    tables: {
      summer: {
        inherits: null,
        tiers: { '1': { total_pct: '95' }, '2': { total_pct: '85' }, '3': { total_pct: '65' } },
        overrides: {},
      },
      teen: { inherits: 'summer', tiers: {}, overrides: {} },
      family: { inherits: 'summer', tiers: {}, overrides: {} },
    },
  },
  programs: {
    summer: {
      ...(RULES_DOCUMENT.programs['summer'] as Record<string, unknown>),
      equity_class: 'summer',
    },
    weekend: {
      ...(RULES_DOCUMENT.programs['weekend'] as Record<string, unknown>),
      equity_class: 'family',
    },
  },
}

const NAMES: RulesNames = {
  section: 'award_tables',
  pools: {},
  programs: {},
  decisionTypes: {},
  criteria: {},
}
const LOCKED: StatusWords = {
  pill: 'Locked',
  tone: 'stone',
  meta: 'in use since Mar 9, 2027 · Test User',
  note: null,
}
const STATUSES = new Map([
  ['tiers', LOCKED],
  ['award_tables', LOCKED],
  ['round2', LOCKED],
] as const)
const WARNING: ApiAidValidationIssue = {
  section: 'award_tables',
  code: 'value_cannot_bind',
  severity: 'warning',
  path: 'award_tables.summer.tiers.3',
  message:
    "At the dearest price routed to this table (6000), tier 3's R1 % gives 3300, below the 3500 minimum, so the minimum decides every award here",
}

type Props = Parameters<typeof TierGridCard>[0]
function grid(over: Partial<Props> = {}) {
  const onEdit = vi.fn()
  render(
    <TierGridCard
      document={DOC}
      approved={null}
      approvedVersion={3}
      names={NAMES}
      statuses={STATUSES}
      changesBySection={{}}
      issuesBySection={{}}
      canEdit
      onEdit={onEdit}
      editing={null}
      {...over}
    />
  )
  return onEdit
}
const cell = (tier: number, column: number) =>
  screen
    .getByTestId('tier-grid')
    .querySelector(`tr[data-tier="${String(tier)}"]`)
    ?.querySelectorAll('td')[column] as HTMLElement

describe('the tier grid card (spec §6.2 E.2)', () => {
  it('stacks three headers, Income tiers · Round 1 award table · Appeal caps, by tier, each with its own Edit…', async () => {
    const onEdit = grid()
    expect(screen.getByRole('heading', { name: 'Income tiers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Round 1 award table' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Appeal caps, by tier' })).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByTestId('card-head-tiers')).getByRole('button', { name: 'Edit…' })
    )
    expect(onEdit).toHaveBeenCalledWith('tiers')
  })

  it('reads the one line from the bands, with the ceiling footnote', () => {
    grid()
    expect(screen.getByTestId('tier-line')).toHaveTextContent(
      '$35,000 bands from $0 · 3 tiers · no income ceiling3'
    )
  })

  it('heads a Round 1 group and a Round 1 + 2 cap group, one column per class, each captioned', () => {
    grid()
    expect(
      within(screen.getByTestId('tier-grid'))
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual([
      'Tier2',
      'Counted income',
      'Round 1 % of the cost',
      'Round 1 + 2 cap, % of the cost',
      'Summerits own',
      'Familysame as Summer',
      'Teensame as Summer, with changes',
      'Summerits own',
      'Familysame as Summer',
      'Teensame as Summer',
    ])
  })

  it("shows an inherited cell's parent value, muted, and an override as its own", () => {
    grid()
    expect(cell(1, 1)).toHaveTextContent('$0 – $35,000')
    expect(cell(1, 3)).toHaveTextContent('90%') // Family, tier 1: inherited from Summer
    expect(cell(1, 3)).toHaveClass('text-muted-foreground')
    expect(cell(2, 4)).toHaveTextContent('70%') // Teen, tier 2: its own override
    expect(cell(2, 4)).not.toHaveClass('text-muted-foreground')
  })

  it("marks a warned Round 1 cell with ⚠, whose click lists that table's warnings", async () => {
    grid({ issuesBySection: { award_tables: [WARNING] } })
    expect(screen.queryByTestId('card-issue')).toBeNull()
    await userEvent.click(
      within(cell(3, 2)).getByRole('button', { name: "Show this table's warnings" })
    )
    expect(screen.getAllByTestId('card-issue').map((li) => li.textContent)).toEqual([
      WARNING.message,
    ])
    expect(within(cell(2, 2)).queryByRole('button')).toBeNull()
  })

  describe("one warnings list: the chip's, which a cell ⚠ opens filtered to its table (coordinator B2)", () => {
    const issue = (table: string, tier: number): ApiAidValidationIssue => ({
      ...WARNING,
      path: `award_tables.${table}.tiers.${String(tier)}`,
      message: `${table} tier ${String(tier)}: the minimum decides every award here`,
    })
    // The server's order: by path as text, so tier 10 and 11 come before 8 and 9.
    const ISSUES = [
      issue('summer', 11),
      issue('teen', 10),
      issue('teen', 11),
      issue('teen', 8),
      issue('teen', 9),
    ]
    const eleven = { ...DOC, tiers: { ...DOC.tiers, bands: bandsOf(0, 35000, 11) } }
    const listed = () => screen.queryAllByTestId('card-issue').map((li) => li.textContent)
    const chip = () =>
      within(screen.getByTestId('card-head-award_tables')).getByRole('button', {
        name: '5 warnings',
      })
    const warn = (tier: number, column: number) =>
      within(cell(tier, column)).getByRole('button', { name: "Show this table's warnings" })

    it("a cell ⚠ lists only its table's warnings, in tier order", async () => {
      grid({ document: eleven, issuesBySection: { award_tables: ISSUES } })
      await userEvent.click(warn(10, 4)) // Teen, tier 10
      expect(listed()).toEqual([
        'teen tier 8: the minimum decides every award here',
        'teen tier 9: the minimum decides every award here',
        'teen tier 10: the minimum decides every award here',
        'teen tier 11: the minimum decides every award here',
      ])
    })

    it("the chip's own click still lists them all, table by table in the grid's order, each in tier order", async () => {
      grid({ document: eleven, issuesBySection: { award_tables: ISSUES } })
      await userEvent.click(chip())
      expect(listed()).toEqual([
        'summer tier 11: the minimum decides every award here',
        'teen tier 8: the minimum decides every award here',
        'teen tier 9: the minimum decides every award here',
        'teen tier 10: the minimum decides every award here',
        'teen tier 11: the minimum decides every award here',
      ])
    })

    it('nothing renders twice, whichever opened the list', async () => {
      grid({ document: eleven, issuesBySection: { award_tables: ISSUES } })
      await userEvent.click(warn(11, 2)) // Summer, tier 11
      expect(screen.getAllByText(ISSUES[0]!.message)).toHaveLength(1)
      await userEvent.click(chip())
      for (const i of ISSUES) expect(screen.getAllByText(i.message)).toHaveLength(1)
      expect(screen.queryByTestId('grid-warnings')).toBeNull()
    })

    it('a second click on the same ⚠ closes the list', async () => {
      grid({ document: eleven, issuesBySection: { award_tables: ISSUES } })
      await userEvent.click(warn(10, 4))
      await userEvent.click(warn(10, 4))
      expect(listed()).toEqual([])
    })

    it('the chip and the ⚠ show a pointer', () => {
      grid({ document: eleven, issuesBySection: { award_tables: ISSUES } })
      expect(chip()).toHaveClass('cursor-pointer')
      expect(warn(10, 4)).toHaveClass('cursor-pointer')
    })
  })

  it('shows "—" in every table cell of a tier the tables do not have yet (more tiers)', () => {
    grid({ document: { ...DOC, tiers: { ...DOC.tiers, bands: bandsOf(0, 35000, 4) } } })
    expect(cell(4, 1)).toHaveTextContent('$105,001 and up')
    for (const column of [2, 3, 4, 5, 6, 7]) expect(cell(4, column)).toHaveTextContent(/^—$/)
  })

  it('says what the draft changed under its header', () => {
    grid({
      changesBySection: {
        award_tables: [
          { path: ['summer', 'tiers', '2', 'r1_pct'], kind: 'changed', before: '75', after: '72' },
        ],
      },
    })
    expect(
      screen.getByText('Changed since v3: Summer › Tiers › Tier 2 › Round 1 %: 75% → 72%')
    ).toBeInTheDocument()
  })

  it("a table editor takes the grid's place, and no header offers Edit… while it is open", () => {
    grid({ editing: { part: 'award_tables', node: <div>Round 1 table editor</div> } })
    expect(
      within(screen.getByTestId('grid-editor-award_tables')).getByText('Round 1 table editor')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tier-grid')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
  })
})
