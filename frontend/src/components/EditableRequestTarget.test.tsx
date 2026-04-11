/**
 * Tests for EditableRequestTarget component.
 *
 * Covers the reference banner that shows the lookup context
 * when searching for a camper to assign to a request.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '../test/testUtils'
import EditableRequestTarget from './EditableRequestTarget'

// Mock the pocketbase module
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: vi.fn().mockResolvedValue([]),
    })),
    authStore: {
      isValid: true,
      token: 'mock-token',
      model: { id: 'admin' },
    },
  },
}))

describe('EditableRequestTarget', () => {
  const defaultProps = {
    requestType: 'bunk_with',
    sessionId: 1000001,
    year: 2025,
    requesterCmId: 99999,
    onChange: vi.fn(),
    requestedPersonName: 'Emma Johnson',
  }

  describe('reference banner', () => {
    it('shows session name in the lookup banner when provided', () => {
      render(<EditableRequestTarget {...defaultProps} sessionName="Session 2" />)

      // Open the dropdown to see the banner
      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(screen.getByText('Looking in Session 2 for:')).toBeInTheDocument()
    })

    it('falls back to "Looking for:" when sessionName is not provided', () => {
      render(<EditableRequestTarget {...defaultProps} />)

      // Open the dropdown
      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(screen.getByText('Looking for:')).toBeInTheDocument()
    })
  })
})
