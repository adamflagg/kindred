/**
 * The one-row toolbar (design-language §5–6; kit .cf-bar / CF.bar / CF.fchip): lead and filters on
 * the left; status, search, actions and Download CSV on the right, on ONE row that never wraps. A
 * filter that came from a link is a removable chip in that row, not a sentence row above the table.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AidFilterChip, AidToolbar, ToolbarLabel } from './Toolbar'

describe('AidToolbar', () => {
  it('lays lead, left, status and right on one row that never wraps, the right group pushed to the edge', () => {
    render(
      <AidToolbar
        lead={<span>13 lines open</span>}
        left={<span>filters</span>}
        status="3 checked · 1 hidden by the filters"
        right={<button type="button">Download CSV</button>}
      />
    )
    const bar = screen.getByTestId('aid-toolbar')
    expect(bar).toHaveClass('flex', 'flex-nowrap', 'items-center')
    expect(bar).not.toHaveClass('flex-wrap')
    const right = screen.getByRole('button', { name: 'Download CSV' }).parentElement
    expect(right).toHaveClass('ml-auto')
    const order = Array.from(bar.querySelectorAll('span,button')).map((e) => e.textContent)
    expect(order.indexOf('13 lines open')).toBeLessThan(order.indexOf('filters'))
  })

  it('truncates the status slot and carries its words in the title', () => {
    render(<AidToolbar status="✓ 2 rounds marked Posted · $1,280" />)
    const status = screen.getByText('✓ 2 rounds marked Posted · $1,280')
    expect(status).toHaveClass('truncate')
    expect(status).toHaveAttribute('title', '✓ 2 rounds marked Posted · $1,280')
  })

  it('labels a filter in the 12.5px muted label', () => {
    render(
      <ToolbarLabel text="Program">
        <span>picker</span>
      </ToolbarLabel>
    )
    const label = screen.getByText('Program')
    expect(label.closest('label')).toHaveClass('text-[12.5px]', 'text-muted-foreground')
  })
})

describe('AidFilterChip', () => {
  it('reads one line with its sentence as the title, and ✕ clears it', async () => {
    const onClear = vi.fn()
    render(
      <AidFilterChip title="Showing live requests only (from the Today link)" onClear={onClear}>
        Live only
      </AidFilterChip>
    )
    const chip = screen.getByText('Live only').closest('span[title]')
    expect(chip).toHaveAttribute('title', 'Showing live requests only (from the Today link)')
    expect(chip).toHaveClass('whitespace-nowrap', 'h-[22px]')
    await userEvent.click(screen.getByRole('button', { name: 'Clear Live only' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('wears amber for a filter that failed', () => {
    render(
      <AidFilterChip title="That household is not on this page" warn onClear={vi.fn()}>
        Household not found
      </AidFilterChip>
    )
    expect(screen.getByText('Household not found').closest('span[title]')?.className).toContain(
      'amber'
    )
  })
})

describe('AidToolbar status', () => {
  it('reads muted, and amber when it is a refusal', () => {
    const { rerender } = render(<AidToolbar status="Copied" />)
    expect(screen.getByText('Copied').className).toContain('text-muted-foreground')
    rerender(<AidToolbar status="Not from this season" statusWarn />)
    const warn = screen.getByText('Not from this season')
    expect(warn.className).toContain('text-amber-700')
    expect(warn.className).not.toContain('text-muted-foreground')
  })
})

describe('ToolbarLabel plain', () => {
  it("is a span, so a segmented well keeps its buttons' own names", () => {
    render(
      <ToolbarLabel text="Round" plain>
        <button type="button">R1</button>
      </ToolbarLabel>
    )
    expect(screen.getByRole('button', { name: 'R1' })).toBeInTheDocument()
    expect(screen.getByText('Round').closest('label')).toBeNull()
  })
})
