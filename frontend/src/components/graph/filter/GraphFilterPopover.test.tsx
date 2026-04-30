import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GraphFilterPopover from './GraphFilterPopover'
import type { BunkSummary } from '../graphFilter'

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' },
  { cmId: 9, name: 'B-9' },
]

function renderPopover(props: Partial<React.ComponentProps<typeof GraphFilterPopover>> = {}) {
  return render(
    <div>
      <button>Outside</button>
      <GraphFilterPopover
        open={props.open ?? true}
        onClose={props.onClose ?? vi.fn()}
        selectedUnits={props.selectedUnits ?? []}
        selectedBunkIds={props.selectedBunkIds ?? []}
        allBunks={ALL_BUNKS}
        edgeMode={props.edgeMode ?? 'strict'}
        onAddUnit={vi.fn()}
        onRemoveUnit={vi.fn()}
        onAddBunk={vi.fn()}
        onRemoveBunk={vi.fn()}
        onSetEdgeMode={props.onSetEdgeMode ?? vi.fn()}
        onClear={props.onClear ?? vi.fn()}
      />
    </div>
  )
}

describe('GraphFilterPopover', () => {
  it('renders nothing when closed', () => {
    renderPopover({ open: false })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('renders combobox when open', () => {
    renderPopover({ open: true })
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('Escape calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderPopover({ onClose })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('outside-click calls onClose', () => {
    const onClose = vi.fn()
    renderPopover({ onClose })
    fireEvent.mouseDown(screen.getByText('Outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('toggling cross-scope edges calls onSetEdgeMode', async () => {
    const onSetEdgeMode = vi.fn()
    const user = userEvent.setup()
    renderPopover({ onSetEdgeMode })
    await user.click(screen.getByLabelText(/Show cross-scope edges/i))
    expect(onSetEdgeMode).toHaveBeenCalledWith('cross-scope')
  })

  it('clear link calls onClear when filter is active', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    renderPopover({ selectedUnits: ['Galil'], onClear })
    await user.click(screen.getByText(/Clear filter/i))
    expect(onClear).toHaveBeenCalled()
  })

  it('hides clear link when filter is empty', () => {
    renderPopover({ selectedUnits: [], selectedBunkIds: [] })
    expect(screen.queryByText(/Clear filter/i)).not.toBeInTheDocument()
  })
})
