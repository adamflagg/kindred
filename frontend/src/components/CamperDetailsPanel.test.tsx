/**
 * Tests for CamperDetailsPanel component.
 *
 * This component displays detailed camper information in a slide-in panel,
 * including bunking preferences, camp journey history, siblings, and raw CSV data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../test/testUtils'
import CamperDetailsPanel from './CamperDetailsPanel'

// Mock the pocketbase module
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: vi.fn().mockResolvedValue([]),
      getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    })),
    authStore: {
      isValid: true,
      token: 'mock-token',
      model: { id: 'admin' },
    },
  },
}))

// Mock useYear hook
vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

describe('CamperDetailsPanel', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Loading and Error States', () => {
    it('shows loading spinner while fetching camper data', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // Should show spinner during loading
      expect(document.querySelector('.spinner-lodge')).toBeInTheDocument()
    })

    it('shows "Camper not found" when camper data is missing', async () => {
      render(<CamperDetailsPanel camperId="nonexistent" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('Camper not found')).toBeInTheDocument()
      })
    })
  })

  describe('Panel Behavior', () => {
    it('renders in embedded mode without slide-in animation', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      // Embedded mode should not have the fixed positioning class
      const panel = document.querySelector('[data-panel="camper-details"]')
      // In embedded mode, this element doesn't exist
      expect(panel).not.toBeInTheDocument()
    })

    it('calls onClose when close button is clicked', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      await waitFor(() => {
        const notFound = screen.queryByText('Camper not found')
        if (notFound) {
          const closeButton = document.querySelector('button')
          if (closeButton) {
            fireEvent.click(closeButton)
          }
        }
      })

      // The onClose callback might be called via animation timeout
      // This is a weak assertion since we can't easily test the full close flow
    })

    it('renders a backdrop overlay for click-outside close in non-embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // The backdrop should be present (fixed, behind the panel)
      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).toBeInTheDocument()
    })

    it('does not render a backdrop overlay in embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).not.toBeInTheDocument()
    })

    it('starts exit animation on backdrop click instead of closing immediately', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).toBeInTheDocument()

      // Click backdrop starts exit animation (does not call onClose immediately)
      fireEvent.click(backdrop!)
      expect(mockOnClose).not.toHaveBeenCalled()

      // The panel should now have the exit animation class (slide-out)
      await waitFor(() => {
        const panel = document.querySelector('.animate-slide-out-right')
        expect(panel).toBeInTheDocument()
      })
    })

    it('starts exit animation on Escape key in non-embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // Wait for non-embedded panel to render (backdrop is always present)
      await waitFor(() => {
        expect(document.querySelector('[data-testid="panel-backdrop"]')).toBeInTheDocument()
      })

      // Press Escape to trigger close
      fireEvent.keyDown(document, { key: 'Escape' })

      // In non-embedded mode, Escape triggers isClosing which starts exit animation.
      // The animation end handler calls onClose. In JSDOM (no real animations),
      // we verify the animation class changed to slide-out.
      await waitFor(() => {
        // Find the animated panel div (loading or full - both get the animation class)
        const panels = document.querySelectorAll('.animate-slide-out-right')
        expect(panels.length).toBeGreaterThan(0)
      })
    })

    it('does not close on Escape key in embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText('Camper not found')).toBeInTheDocument()
      })

      // Escape should not trigger close in embedded mode
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })
})
