import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidCompareColumn } from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { rulesVocabulary } from '../rules/rulesModel'
import { CompareTable, CompareTools } from './CompareTable'
import { columnChoices } from './compareModel'
import { compareOut, OPTIONS, results, workspace } from './scenarioFixtures'

const WS = workspace({
  pricing_version: 4,
  options: OPTIONS.map((o) =>
    o.code === 'B'
      ? { ...o, promotable: true }
      : {
          ...o,
          promotable: false,
          blocked: 'changes Round 1 settings, locked since Round 1 posted',
        }
  ),
})
const [draftColumn, a1] = compareOut().columns
const KEPT_A1: ApiAidCompareColumn = { ...a1!, code: 'A1' }
const KEPT_B: ApiAidCompareColumn = { ...a1!, code: 'B', up: 4, down: 1 }
const NAMES = rulesVocabulary((s) => (RULES_DOCUMENT as Record<string, unknown>)[s])

function table(over: Partial<Parameters<typeof CompareTable>[0]> = {}) {
  const onPromote = vi.fn()
  const onRename = vi.fn()
  render(
    <CompareTable
      compare={compareOut({ columns: [draftColumn!, KEPT_A1, KEPT_B] })}
      loading={false}
      error={null}
      stale={false}
      workspace={WS}
      lastSeason
      requestSet={{ kind: 'all' }}
      byTier={false}
      locked={false}
      draftName="from B · 1 change"
      effectName="Rules v4"
      names={NAMES}
      canEdit
      printedOn="Feb 3, 2027"
      onPromote={onPromote}
      onRename={onRename}
      {...over}
    />
  )
  return { onPromote, onRename }
}

describe('CompareTable (§S5 H)', () => {
  it('puts what every column is priced on in the corner and a head on each column', () => {
    table()
    expect(screen.getByText('Priced on 420 applications held')).toBeInTheDocument()
    expect(screen.getByText('your draft, not kept')).toBeInTheDocument()
    expect(screen.getByText('Last season, posted')).toBeInTheDocument()
  })

  it('offers Make ‹B› the Rules Draft… where the server allows it, else its reason, and Rename', async () => {
    const { onPromote, onRename } = table()
    await userEvent.click(screen.getByRole('button', { name: 'Make B the Rules Draft…' }))
    expect(onPromote).toHaveBeenCalledWith('B')
    expect(
      screen.getByText('changes Round 1 settings, locked since Round 1 posted')
    ).toBeInTheDocument()
    const head = screen.getByTestId('compare-head-B')
    await userEvent.click(within(head).getByRole('button', { name: 'Rename' }))
    await userEvent.type(within(head).getByRole('textbox', { name: 'Name of B' }), ' too{Enter}')
    expect(onRename).toHaveBeenCalledWith('B', 'bands $5,000 wider too')
  })

  it('draws ▲ in forest and ▼ in red, and a print-only header', () => {
    table()
    expect(screen.getAllByText('▲4')[0]).toHaveClass('text-forest-600')
    expect(screen.getByTestId('compare-print-head')).toHaveTextContent(
      'Season 2027 · Scenarios compare'
    )
    expect(screen.getByTestId('compare-print-head')).toHaveTextContent(
      'Printed Feb 3, 2027 · 420 applications held · Rules v4 in effect'
    )
  })

  it('keeps the last table on screen, dimmed, while a new one loads, and says a refusal in the server’s words', () => {
    table({ stale: true })
    expect(screen.getByTestId('compare-table')).toHaveAttribute('data-stale')
  })

  it('says why last season’s rules were left out, and still shows the other columns (disagreement 16)', () => {
    const words =
      "2026's criteria don't fit 2027's rules in effect (programs.teen.r1_table: no such table): start from the rules and edit instead"
    table({ compare: compareOut({ columns: [draftColumn!, KEPT_B], last_rules_refused: words }) })
    expect(screen.getByText(`Last season's rules are left out: ${words}`)).toBeInTheDocument()
    expect(screen.getByTestId('compare-head-B')).toBeInTheDocument()
  })

  it('shows whole dollars where a figure has cents (coordinator ruling 2026-10-07)', () => {
    table({
      compare: compareOut({
        columns: [{ ...draftColumn!, results: results(735000.5) }, KEPT_A1],
      }),
    })
    const body = screen.getByTestId('compare-table')
    expect(body).toHaveTextContent('$735,001')
    expect(body).not.toHaveTextContent('735,000.50')
  })

  it('reads the corner in the small role’s 400, never the header cell’s bold (V F10)', () => {
    table()
    expect(screen.getByText('Priced on 420 applications held').closest('th')).toHaveClass(
      'font-normal'
    )
  })

  it('gives the setting names the mock’s label column, so they wrap less (V F9)', () => {
    table()
    const corner = screen.getByText('Priced on 420 applications held').closest('th')
    expect(corner).toHaveClass('min-w-[220px]', 'max-w-[280px]')
    expect(screen.getByText('Requests priced').closest('td')).toHaveClass(
      'min-w-[220px]',
      'max-w-[280px]'
    )
  })

  it('sizes the code chips by the head’s small role, never a size of their own (plan review, minor 11)', () => {
    table()
    const chip = within(screen.getByTestId('compare-head-B')).getByText('B')
    expect(chip.className).not.toMatch(/\btext-(xs|sm|base|\[)/)
    expect(chip.parentElement).toHaveClass('text-xs') // CS_SMALL: 12px, the mock's chip
  })
})

describe('CompareTools (§S5 H)', () => {
  it('lists the columns, refuses a fifth in amber, and switches By tier', async () => {
    const onToggle = vi.fn()
    const onByTier = vi.fn()
    render(
      <CompareTools
        choices={columnChoices(WS, false)}
        checked={['rules', 'kept:A']}
        refused="Four kept options are already columns: uncheck one to add C."
        onToggle={onToggle}
        byTier={false}
        onByTier={onByTier}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Columns ▾' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'B · bands $5,000 wider' }))
    expect(onToggle).toHaveBeenCalledWith('kept:B')
    expect(
      screen.getByText('Four kept options are already columns: uncheck one to add C.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'By tier' }))
    expect(onByTier).toHaveBeenCalledWith(true)
  })
})
