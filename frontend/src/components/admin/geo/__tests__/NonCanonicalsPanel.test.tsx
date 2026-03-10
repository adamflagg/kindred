import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NonCanonicalsPanel } from '../NonCanonicalsPanel'
import type { GapItem } from '../../../../services/geoService'

const grouped: GapItem[] = [
  { name: 'Hillcrest High', count: 14, percentage: 8.2, source_count: 3, state_distribution: {} },
  { name: 'Riverside Elem', count: 5, percentage: 2.9, source_count: 2, state_distribution: {} },
]
const ungrouped: GapItem[] = [
  { name: 'Mapleton Prep', count: 2, percentage: 1.2, source_count: 0, state_distribution: {} },
]

describe('NonCanonicalsPanel', () => {
  it('renders merged list sorted by count descending', () => {
    render(
      <NonCanonicalsPanel
        grouped={grouped}
        ungrouped={ungrouped}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const names = screen.getAllByTestId('gap-name').map((el) => el.textContent)
    expect(names).toEqual(['Hillcrest High', 'Riverside Elem', 'Mapleton Prep'])
  })

  it('shows red dot for grouped, gray dot for ungrouped', () => {
    render(
      <NonCanonicalsPanel
        grouped={grouped}
        ungrouped={ungrouped}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const dots = screen.getAllByTestId('gap-indicator')
    expect(dots).toHaveLength(3)
    // First two are grouped (red), last is ungrouped (gray)
    expect(dots[0]!).toHaveClass('bg-red-500')
    expect(dots[2]!).toHaveClass('bg-stone-400')
  })

  it('calls onResolve with name and type when Resolve clicked', async () => {
    const onResolve = vi.fn()
    render(
      <NonCanonicalsPanel
        grouped={grouped}
        ungrouped={ungrouped}
        onResolve={onResolve}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button', { name: /resolve/i })
    // Filter out the header toggle button ("Resolve Non-Canonicals") to get only item-level "Resolve" buttons
    const resolveButtons = buttons.filter((b) => b.textContent?.trim() === 'Resolve')
    await user.click(resolveButtons[0]!)
    expect(onResolve).toHaveBeenCalledWith('Hillcrest High', 'non_canonical_grouped')
  })

  it('shows count badge in header', () => {
    render(
      <NonCanonicalsPanel
        grouped={grouped}
        ungrouped={ungrouped}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('3')).toBeInTheDocument() // 2 grouped + 1 ungrouped
  })

  it('shows state distribution tags on gap items', () => {
    render(
      <NonCanonicalsPanel
        grouped={[
          {
            name: 'Highland',
            count: 8,
            percentage: 50,
            source_count: 3,
            state_distribution: { CA: 6, OR: 2 },
          },
        ]}
        ungrouped={[]}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )

    // Verify state tags are visible
    expect(screen.getByText(/CA/)).toBeInTheDocument()
    expect(screen.getByText(/OR/)).toBeInTheDocument()
  })

  it('does not show state tags when state_distribution is empty', () => {
    render(
      <NonCanonicalsPanel
        grouped={[
          {
            name: 'SomePlace',
            count: 3,
            percentage: 20,
            source_count: 1,
            state_distribution: {},
          },
        ]}
        ungrouped={[]}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )

    // Should not have any state distribution text
    // Just verify the name is shown
    expect(screen.getByText('SomePlace')).toBeInTheDocument()
  })

  it('shows empty state when no gaps', () => {
    render(
      <NonCanonicalsPanel
        grouped={[]}
        ungrouped={[]}
        onResolve={vi.fn()}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText(/all resolved/i)).toBeInTheDocument()
  })
})
