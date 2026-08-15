import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import GraphFilterPopover from './GraphFilterPopover'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from '../../ui/modalStack'
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
    fireEvent.keyDown(document, { key: 'Escape' })
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

  // kindred#2237. This popover renders INSIDE the expanded SocialNetworkGraph,
  // which collapses itself on Escape from its own `window` listener. Before the
  // kindred#2205 token stack was wired up here, one Escape press ran both
  // handlers: the popover closed AND the graph collapsed out from under it.
  describe('overlay token (kindred#2237)', () => {
    it('does NOT close once a further overlay has opened on top of it', () => {
      const props = defaultProps()
      render(<GraphFilterPopover {...props} />)

      const topToken = acquireOverlayToken()
      try {
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(props.onClose).not.toHaveBeenCalled()
      } finally {
        // `finally`, not a trailing call: a failing assertion would otherwise
        // leave this token on the stack and every later test in the file would
        // see a phantom overlay above it.
        releaseOverlayToken(topToken)
      }
    })

    it('swallows the key while topmost, so the surface underneath does not also close', () => {
      const props = defaultProps()
      const beneath = vi.fn()
      document.addEventListener('keydown', beneath)
      window.addEventListener('keydown', beneath)
      try {
        render(<GraphFilterPopover {...props} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(props.onClose).toHaveBeenCalled()
        expect(beneath).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', beneath)
        window.removeEventListener('keydown', beneath)
      }
    })

    // A leaked token is invisible to a "does it still close?" test -- a newly
    // acquired token is always last in the stack, so the freshly-opened overlay
    // is topmost either way. Only the emptiness of the stack catches it.
    it('releases its overlay token on unmount, so the stack does not leak', () => {
      const { unmount } = render(<GraphFilterPopover {...defaultProps()} />)
      expect(hasOpenModal()).toBe(true)

      unmount()

      expect(hasOpenModal()).toBe(false)
    })

    it('releases its overlay token when it closes without unmounting', () => {
      const { rerender } = render(<GraphFilterPopover {...defaultProps()} />)
      expect(hasOpenModal()).toBe(true)

      rerender(<GraphFilterPopover {...defaultProps()} open={false} />)

      expect(hasOpenModal()).toBe(false)
    })

    it('registers no token while closed', () => {
      render(<GraphFilterPopover {...defaultProps()} open={false} />)
      expect(hasOpenModal()).toBe(false)
    })
  })
})
