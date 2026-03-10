import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AddCoordsPanel } from '../AddCoordsPanel'
import type { GapItem } from '../../../../services/geoService'

const gaps: GapItem[] = [
  {
    name: 'Riverside Elementary',
    count: 14,
    percentage: 8.2,
    source_count: 3,
    state_distribution: {},
  },
  { name: 'Oak Valley Middle', count: 8, percentage: 4.7, source_count: 2, state_distribution: {} },
  { name: 'Hillcrest High', count: 5, percentage: 1.8, source_count: 1, state_distribution: {} },
]

describe('AddCoordsPanel', () => {
  it('renders gap items with name and camper count', () => {
    render(
      <AddCoordsPanel
        gaps={gaps}
        onAdd={vi.fn()}
        onBatchResolve={vi.fn()}
        isBatchResolving={false}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const names = screen.getAllByTestId('gap-name').map((el) => el.textContent)
    expect(names).toEqual(['Riverside Elementary', 'Oak Valley Middle', 'Hillcrest High'])
    // Verify counts are displayed
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('calls onAdd with canonical name when Add button clicked', async () => {
    const onAdd = vi.fn()
    render(
      <AddCoordsPanel
        gaps={gaps}
        onAdd={onAdd}
        onBatchResolve={vi.fn()}
        isBatchResolving={false}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button', { name: /add/i })
    // First Add button (skip Auto-fill All if it matches)
    const addButtons = buttons.filter((b) => b.textContent?.trim() === 'Add')
    await user.click(addButtons[0]!)
    expect(onAdd).toHaveBeenCalledWith('Riverside Elementary')
  })

  it('calls onBatchResolve when Auto-fill All button clicked', async () => {
    const onBatchResolve = vi.fn()
    render(
      <AddCoordsPanel
        gaps={gaps}
        onAdd={vi.fn()}
        onBatchResolve={onBatchResolve}
        isBatchResolving={false}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /auto-fill all/i }))
    expect(onBatchResolve).toHaveBeenCalledOnce()
  })

  it('shows progress state during batch resolve', () => {
    render(
      <AddCoordsPanel
        gaps={gaps}
        onAdd={vi.fn()}
        onBatchResolve={vi.fn()}
        isBatchResolving={true}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    const batchButton = screen.getByRole('button', { name: /resolving/i })
    expect(batchButton).toBeDisabled()
  })

  it('shows empty state when no missing coords', () => {
    render(
      <AddCoordsPanel
        gaps={[]}
        onAdd={vi.fn()}
        onBatchResolve={vi.fn()}
        isBatchResolving={false}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText(/all coordinates added/i)).toBeInTheDocument()
  })

  it('shows count badge in header', () => {
    render(
      <AddCoordsPanel
        gaps={gaps}
        onAdd={vi.fn()}
        onBatchResolve={vi.fn()}
        isBatchResolving={false}
        isOpen={true}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
