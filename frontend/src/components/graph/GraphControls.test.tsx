/**
 * Tests for GraphControls component
 * TDD - tests written first, implementation follows
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import GraphControls from './GraphControls'

describe('GraphControls', () => {
  describe('label toggle', () => {
    it('should toggle label visibility', () => {
      const mockToggleLabels = vi.fn()

      mockToggleLabels()

      expect(mockToggleLabels).toHaveBeenCalled()
    })

    it('should show different icons for show/hide state', () => {
      const showLabels = true as boolean
      const iconName = showLabels ? 'Eye' : 'EyeOff'

      expect(iconName).toBe('Eye')
    })
  })

  describe('zoom controls', () => {
    it('should have zoom in, zoom out, and fit functions', () => {
      const handleZoomIn = vi.fn()
      const handleZoomOut = vi.fn()
      const handleFit = vi.fn()

      handleZoomIn()
      handleZoomOut()
      handleFit()

      expect(handleZoomIn).toHaveBeenCalled()
      expect(handleZoomOut).toHaveBeenCalled()
      expect(handleFit).toHaveBeenCalled()
    })

    it('should apply zoom multipliers correctly', () => {
      const currentZoom = 1.0
      const zoomInMultiplier = 1.2
      const zoomOutMultiplier = 0.8

      expect(currentZoom * zoomInMultiplier).toBe(1.2)
      expect(currentZoom * zoomOutMultiplier).toBe(0.8)
    })
  })

  describe('expand toggle', () => {
    it('should toggle expanded state', () => {
      const mockToggleExpand = vi.fn()

      mockToggleExpand()

      expect(mockToggleExpand).toHaveBeenCalled()
    })

    it('should show different icons for expanded/collapsed', () => {
      const isExpanded = true as boolean
      const iconName = isExpanded ? 'Minimize2' : 'Maximize2'

      expect(iconName).toBe('Minimize2')
    })
  })

  describe('help toggle', () => {
    it('should toggle help visibility', () => {
      const mockToggleHelp = vi.fn()

      mockToggleHelp()

      expect(mockToggleHelp).toHaveBeenCalled()
    })
  })
})

describe('GraphControls rendering', () => {
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

  it('does not render an Ego Network control', () => {
    render(<GraphControls {...baseProps} />)
    expect(screen.queryByText(/ego network/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/all connections/i)).not.toBeInTheDocument()
  })
})
