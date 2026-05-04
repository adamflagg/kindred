/**
 * Tests for GraphControls component
 * TDD - tests written first, implementation follows
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import GraphControls from './GraphControls'

const baseProps = {
  showLabels: true,
  onToggleLabels: vi.fn(),
  showHelp: false,
  onToggleHelp: vi.fn(),
  isExpanded: false,
  onToggleExpand: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onFit: vi.fn(),
}

describe('GraphControls', () => {
  describe('label toggle', () => {
    it('calls onToggleLabels when the label button is clicked', () => {
      const onToggleLabels = vi.fn()
      render(<GraphControls {...baseProps} onToggleLabels={onToggleLabels} showLabels={true} />)
      fireEvent.click(screen.getByTitle('Hide labels'))
      expect(onToggleLabels).toHaveBeenCalledTimes(1)
    })

    it('shows Hide-labels title when showLabels is true and Show-labels when false', () => {
      const { rerender } = render(<GraphControls {...baseProps} showLabels={true} />)
      expect(screen.getByTitle('Hide labels')).toBeInTheDocument()

      rerender(<GraphControls {...baseProps} showLabels={false} />)
      expect(screen.getByTitle('Show labels')).toBeInTheDocument()
    })
  })

  describe('zoom controls', () => {
    it('calls onZoomIn, onZoomOut, and onFit when their buttons are clicked', () => {
      const onZoomIn = vi.fn()
      const onZoomOut = vi.fn()
      const onFit = vi.fn()
      render(
        <GraphControls {...baseProps} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />
      )
      fireEvent.click(screen.getByTitle('Zoom in'))
      fireEvent.click(screen.getByTitle('Zoom out'))
      fireEvent.click(screen.getByTitle('Fit to screen'))
      expect(onZoomIn).toHaveBeenCalledTimes(1)
      expect(onZoomOut).toHaveBeenCalledTimes(1)
      expect(onFit).toHaveBeenCalledTimes(1)
    })
  })

  describe('expand toggle', () => {
    it('calls onToggleExpand when the expand button is clicked', () => {
      const onToggleExpand = vi.fn()
      render(<GraphControls {...baseProps} onToggleExpand={onToggleExpand} isExpanded={false} />)
      fireEvent.click(screen.getByTitle('Expand graph'))
      expect(onToggleExpand).toHaveBeenCalledTimes(1)
    })

    it('shows "Exit expanded view" title when isExpanded is true and "Expand graph" when false', () => {
      const { rerender } = render(<GraphControls {...baseProps} isExpanded={false} />)
      expect(screen.getByTitle('Expand graph')).toBeInTheDocument()

      rerender(<GraphControls {...baseProps} isExpanded={true} />)
      expect(screen.getByTitle('Exit expanded view')).toBeInTheDocument()
    })
  })

  describe('help toggle', () => {
    it('calls onToggleHelp when the help button is clicked', () => {
      const onToggleHelp = vi.fn()
      render(<GraphControls {...baseProps} onToggleHelp={onToggleHelp} />)
      fireEvent.click(screen.getByTitle('Toggle help information'))
      expect(onToggleHelp).toHaveBeenCalledTimes(1)
    })
  })
})

describe('GraphControls rendering', () => {
  it('does not render an Ego Network control', () => {
    render(<GraphControls {...baseProps} />)
    expect(screen.queryByText(/ego network/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/all connections/i)).not.toBeInTheDocument()
  })

  it('renders filterButton slot when provided', () => {
    render(
      <GraphControls
        showLabels={true}
        onToggleLabels={() => {}}
        showHelp={false}
        onToggleHelp={() => {}}
        isExpanded={false}
        onToggleExpand={() => {}}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onFit={() => {}}
        filterButton={<button>FilterSlot</button>}
      />
    )
    expect(screen.getByRole('button', { name: /FilterSlot/i })).toBeInTheDocument()
  })

  describe('download dropdown', () => {
    it('renders the download trigger when onDownload is provided', () => {
      render(<GraphControls {...baseProps} onDownload={vi.fn()} />)
      expect(screen.getByTitle(/download as png/i)).toBeInTheDocument()
    })

    it('does not render the download trigger when onDownload is omitted', () => {
      render(<GraphControls {...baseProps} />)
      expect(screen.queryByTitle(/download as png/i)).not.toBeInTheDocument()
    })

    it('opens a menu with "Fit to graph" and "Current view" on click', async () => {
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(<GraphControls {...baseProps} onDownload={vi.fn()} />)
      await user.click(screen.getByTitle(/download as png/i))
      expect(screen.getByRole('menuitem', { name: /fit to graph/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /current view/i })).toBeInTheDocument()
    })

    it('invokes onDownload("fit") when "Fit to graph" is clicked', async () => {
      const onDownload = vi.fn()
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(<GraphControls {...baseProps} onDownload={onDownload} />)
      await user.click(screen.getByTitle(/download as png/i))
      await user.click(screen.getByRole('menuitem', { name: /fit to graph/i }))
      expect(onDownload).toHaveBeenCalledTimes(1)
      expect(onDownload).toHaveBeenCalledWith('fit')
    })

    it('invokes onDownload("viewport") when "Current view" is clicked', async () => {
      const onDownload = vi.fn()
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(<GraphControls {...baseProps} onDownload={onDownload} />)
      await user.click(screen.getByTitle(/download as png/i))
      await user.click(screen.getByRole('menuitem', { name: /current view/i }))
      expect(onDownload).toHaveBeenCalledWith('viewport')
    })

    it('closes the menu after a selection', async () => {
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(<GraphControls {...baseProps} onDownload={vi.fn()} />)
      await user.click(screen.getByTitle(/download as png/i))
      await user.click(screen.getByRole('menuitem', { name: /fit to graph/i }))
      expect(screen.queryByRole('menuitem', { name: /fit to graph/i })).not.toBeInTheDocument()
    })

    it('closes the menu when clicking outside', async () => {
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(
        <div>
          <GraphControls {...baseProps} onDownload={vi.fn()} />
          <button data-testid="outside">outside</button>
        </div>
      )
      await user.click(screen.getByTitle(/download as png/i))
      expect(screen.getByRole('menuitem', { name: /fit to graph/i })).toBeInTheDocument()
      await user.click(screen.getByTestId('outside'))
      expect(screen.queryByRole('menuitem', { name: /fit to graph/i })).not.toBeInTheDocument()
    })
  })
})
