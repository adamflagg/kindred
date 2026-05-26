import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import GraphFilterPopover from './GraphFilterPopover'
import type { BunkSummary } from '../graphFilter'

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' },
  { cmId: 2, name: 'G-3' },
]

function defaultProps() {
  return {
    open: true,
    onClose: vi.fn(),
    selectedUnits: [] as string[],
    selectedBunks: [] as string[],
    allBunks: ALL_BUNKS,
    onAddUnit: vi.fn(),
    onRemoveUnit: vi.fn(),
    onAddBunk: vi.fn(),
    onRemoveBunk: vi.fn(),
    onClear: vi.fn(),
  }
}

describe('GraphFilterPopover', () => {
  it('renders the tree when open', () => {
    render(<GraphFilterPopover {...defaultProps()} />)
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<GraphFilterPopover {...defaultProps()} open={false} />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('Escape calls onClose', () => {
    const props = defaultProps()
    render(<GraphFilterPopover {...props} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('clicking outside calls onClose', () => {
    const props = defaultProps()
    render(
      <div>
        <div data-testid="outside">outside</div>
        <GraphFilterPopover {...props} />
      </div>
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('does not call onClose when clicking inside the popover', () => {
    const props = defaultProps()
    render(<GraphFilterPopover {...props} />)
    fireEvent.mouseDown(screen.getByRole('searchbox'))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('does not call onClose when click target is the trigger ref', () => {
    const props = defaultProps()
    function Wrapper() {
      const triggerRef = useRef<HTMLButtonElement>(null)
      return (
        <div>
          <button ref={triggerRef} data-testid="trigger">
            trigger
          </button>
          <GraphFilterPopover {...props} triggerRef={triggerRef} />
        </div>
      )
    }
    render(<Wrapper />)
    fireEvent.mouseDown(screen.getByTestId('trigger'))
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
