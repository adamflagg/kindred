import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NonCanonicalsPanel } from '../NonCanonicalsPanel'
import type { GapItem } from '../../../../services/geoService'

const grouped: GapItem[] = [
  { name: 'Hillcrest High', count: 14, percentage: 8.2, source_count: 3 },
  { name: 'Riverside Elem', count: 5, percentage: 2.9, source_count: 2 },
]
const ungrouped: GapItem[] = [{ name: 'Mapleton Prep', count: 2, percentage: 1.2, source_count: 0 }]

describe('NonCanonicalsPanel', () => {
  it('renders merged list sorted by count descending', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    const names = screen.getAllByTestId('gap-name').map((el) => el.textContent)
    expect(names).toEqual(['Hillcrest High', 'Riverside Elem', 'Mapleton Prep'])
  })

  it('shows red dot for grouped, gray dot for ungrouped', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    const dots = screen.getAllByTestId('gap-indicator')
    expect(dots).toHaveLength(3)
    // First two are grouped (red), last is ungrouped (gray)
    expect(dots[0]!).toHaveClass('bg-red-500')
    expect(dots[2]!).toHaveClass('bg-stone-400')
  })

  it('calls onResolve with name and type when Resolve clicked', async () => {
    const onResolve = vi.fn()
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={onResolve} />)
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button', { name: /resolve/i })
    await user.click(buttons[0]!)
    expect(onResolve).toHaveBeenCalledWith('Hillcrest High', 'non_canonical_grouped')
  })

  it('shows count badge in header', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument() // 2 grouped + 1 ungrouped
  })

  it('shows empty state when no gaps', () => {
    render(<NonCanonicalsPanel grouped={[]} ungrouped={[]} onResolve={vi.fn()} />)
    expect(screen.getByText(/all resolved/i)).toBeInTheDocument()
  })
})
