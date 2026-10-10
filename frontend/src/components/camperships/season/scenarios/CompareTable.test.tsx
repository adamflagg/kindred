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
      held
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
    expect(screen.getByText('Your draft, not kept')).toBeInTheDocument()
    expect(screen.getByText('from B · 1 change')).toBeInTheDocument()
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

  it('draws ▲ in forest and ▼ in amber (the 10-09 mock; owner Q10), and a print-only header', () => {
    table()
    expect(screen.getAllByText('▲4')[0]).toHaveClass('text-forest-600')
    expect(screen.getAllByText('▼1')[0]).toHaveClass('text-amber-700', 'dark:text-amber-300')
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

  it('draws the corner as the header cell: 12px/600 muted in the fill, never regular on white (scenarios-10)', () => {
    table()
    const corner = screen.getByText('Priced on 420 applications held').closest('th')
    expect(corner).toHaveClass('bg-muted', 'text-muted-foreground', 'font-semibold', 'text-xs')
    expect(corner).not.toHaveClass('font-normal')
  })

  it('is the kit grid: fixed layout, a 300px label column and equal option columns, no inner card padding (scenarios-1)', () => {
    table()
    const wrap = screen.getByTestId('compare-table')
    expect(wrap.className).not.toMatch(/\bp-\d/)
    const grid = wrap.querySelector('table')!
    expect(grid).toHaveClass('table-fixed')
    const cols = [...grid.querySelectorAll('col')]
    expect(cols[0]).toHaveStyle({ width: '300px' })
    expect(cols.slice(1).every((c) => c.getAttribute('style') === null)).toBe(true)
  })

  it('fills the header, rules every column, and draws the group rule before the first option column (scenarios-1)', () => {
    table()
    const heads = screen.getByTestId('compare-table').querySelectorAll('thead th')
    expect(heads[1]?.className).toContain('var(--color-foreground)_10%') // CS_RULE_GROUP
    expect(heads[2]?.className).toContain('var(--color-border)_75%') // CS_RULE
    const cell = screen.getByText('Requests priced').closest('tr')!.querySelectorAll('td')
    expect(cell[1]?.className).toContain('var(--color-foreground)_10%')
    expect(cell[2]?.className).toContain('var(--color-border)_75%')
  })

  it('draws a section row in the green band, 13.5px bold foreground, with its edge (scenarios-1)', () => {
    table()
    const section = screen.getByText('Spend, by pool').closest('td')!
    expect(section.className).toContain('forest-200')
    expect(section.className).toContain('dark:bg-[color-mix(in_oklab,var(--color-forest-900)')
    expect(section).toHaveClass('text-foreground', 'font-bold', 'text-[13.5px]')
    expect(section.className).toContain('border-t')
    expect(section.className).not.toContain('bg-muted/30')
  })

  it('gives the setting names the mock’s 300px label column (scenarios-1)', () => {
    table()
    expect(screen.getByText('Requests priced').closest('td')).toHaveClass('sticky', 'left-0')
  })

  it('heads each column "‹code› · ‹name›" in bold with no chip, its meta on one line, the kept sentence in the title (scenarios-10)', () => {
    table()
    const head = screen.getByTestId('compare-head-B')
    const name = within(head).getByText('B · bands $5,000 wider')
    expect(name.tagName).toBe('B')
    expect(name).toHaveClass('text-foreground', 'text-[12.5px]', 'truncate')
    expect(head.title).toContain('the kept line is what it priced the day it was kept')
    const meta = within(head).getByText(/^kept /)
    expect(meta).toHaveClass('text-[11px]', 'truncate')
    expect(within(head).queryByText('B', { exact: true })).toBeNull() // no chip
  })

  it('cuts a long head name to one line with the full name in a native title (scenarios-16)', () => {
    const long = 'x'.repeat(80)
    table({
      workspace: {
        ...WS,
        options: WS.options.map((o) => (o.code === 'B' ? { ...o, name: long } : o)),
      },
    })
    const name = within(screen.getByTestId('compare-head-B')).getByText(`B · ${long}`)
    expect(name).toHaveClass('truncate')
    expect(name).toHaveAttribute('title', `B · ${long}`)
  })

  it('reads the Rules head "Rules vN in effect" over "approved ‹date›"', () => {
    const rules: ApiAidCompareColumn = {
      ...a1!,
      code: 'rules',
      label: 'Rules v4 in effect',
      approved_at: '2027-01-12T18:00:00Z',
    }
    table({ compare: compareOut({ columns: [rules, KEPT_B] }) })
    const head = screen.getByTestId('compare-head-rules')
    expect(within(head).getByText('Rules v4 in effect')).toBeInTheDocument()
    expect(within(head).getByText('approved Jan 12')).toBeInTheDocument()
  })

  it('offers its actions as small links, in the head of a kept option only', () => {
    table()
    const link = screen.getByRole('button', { name: 'Make B the Rules Draft…' })
    expect(link).toHaveClass('text-xs')
    expect(link.className).not.toMatch(/\bborder\b/)
  })

  it('reads each cell on one line, the second part muted after "·" (the mock)', () => {
    table({ byTier: true })
    const cell = screen.getAllByText(/of ask/)[0]!
    expect(cell).toHaveClass('text-muted-foreground')
    expect(cell.textContent).toMatch(/^ · \d/)
    expect(cell.closest('td')?.textContent).toMatch(/^\$[\d,]+ · [\d.]+% of ask$/)
  })

  it('shades a setting unlike the rules in effect as an amber cell, with what the rules have in its title', () => {
    const rules: ApiAidCompareColumn = { ...a1!, code: 'rules', label: 'Rules v4 in effect' }
    table({ compare: compareOut({ columns: [rules, draftColumn!] }), lastSeason: false })
    const cell = screen.getByText('$150').closest('td')!
    expect(cell.className).toContain('amber-100')
    expect(cell.className).toContain('dark:bg-[color-mix(in_oklab,var(--color-amber-900)')
    expect(cell).toHaveAttribute('title', 'Differs from Rules v4 ($100)')
  })

  it('notes the Projected season row and the corner (the registry’s Projected, and Change colours)', () => {
    table()
    const projected = screen.getByText('Projected season').closest('td')!
    expect(within(projected).getByText('3', { selector: 'sup' })).toBeInTheDocument()
    const corner = screen.getByText('Priced on 420 applications held').closest('th')!
    expect(within(corner).getByText('5', { selector: 'sup' })).toBeInTheDocument()
  })

  it('shows the kit’s dashed empty box when no applications are held (scenarios-12)', () => {
    table({ held: false, compare: undefined })
    const box = screen.getByText(/No applications are held yet:/)
    expect(box).toHaveClass('border-dashed')
    expect(within(box).getByText('Update Applications').tagName).toBe('B')
    expect(box).toHaveTextContent(
      'No applications are held yet: Update Applications first, then Compare prices every column on them.'
    )
  })
})

describe('CompareTools (§S5 H; scenarios-11)', () => {
  function tools(over: Partial<Parameters<typeof CompareTools>[0]> = {}) {
    const onToggle = vi.fn()
    const onByTier = vi.fn()
    render(
      <CompareTools
        choices={columnChoices(WS, false)}
        checked={['rules', 'kept:A']}
        onToggle={onToggle}
        byTier={false}
        onByTier={onByTier}
        {...over}
      />
    )
    return { onToggle, onByTier }
  }

  it('is the kit multi-choice picker "Columns · N", a checkbox per column', async () => {
    const { onToggle } = tools()
    const button = screen.getByRole('button', { name: /^Columns:/ })
    expect(button).toHaveTextContent('Columns · 2')
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('option', { name: /B · bands \$5,000 wider/ }))
    expect(onToggle).toHaveBeenCalledWith('kept:B')
  })

  it('unchecks a checked column through the same toggle', async () => {
    const { onToggle } = tools()
    await userEvent.click(screen.getByRole('button', { name: /^Columns:/ }))
    await userEvent.click(screen.getByRole('option', { name: /A · / }))
    expect(onToggle).toHaveBeenCalledWith('kept:A')
  })

  it('switches By tier as a check in foreground ink, accent-primary 13px, and prints', async () => {
    const { onByTier } = tools()
    const box = screen.getByRole('checkbox', { name: 'By tier' })
    expect(box).toHaveClass('accent-primary', 'h-[13px]', 'w-[13px]')
    expect(box.closest('label')).toHaveClass('text-foreground')
    await userEvent.click(box)
    expect(onByTier).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
  })
})
