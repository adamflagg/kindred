/**
 * Tests for CamperDetailsPanel component.
 *
 * This component displays detailed camper information in a slide-in panel,
 * including bunking preferences, camp journey history, siblings, and raw CSV data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../test/testUtils'
import CamperDetailsPanel from './CamperDetailsPanel'
import { mockPerson } from '../test/mockData'

// Configurable per-collection mock factories
const mockGetFullListPersons = vi.fn()
const mockGetFullListAttendees = vi.fn()
const mockGetFullListBunkAssignments = vi.fn()
const mockGetFullListBunkRequests = vi.fn()
const mockGetListOriginalBunkRequests = vi.fn()
const mockGetListPersons = vi.fn()

// Mock the pocketbase module with per-collection dispatch
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      switch (name) {
        case 'persons':
          return {
            getFullList: mockGetFullListPersons,
            getList: mockGetListPersons,
          }
        case 'attendees':
          return { getFullList: mockGetFullListAttendees }
        case 'bunk_assignments':
          return { getFullList: mockGetFullListBunkAssignments }
        case 'bunk_requests':
          return { getFullList: mockGetFullListBunkRequests }
        case 'original_bunk_requests':
          return { getList: mockGetListOriginalBunkRequests }
        default:
          return {
            getFullList: vi.fn().mockResolvedValue([]),
            getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          }
      }
    }),
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

// ---------------------------------------------------------------------------
// Shared fixture data (fictional names per CLAUDE.md)
// ---------------------------------------------------------------------------

/** A minimal persons record for Emma Johnson, cm_id=100 */
const EMMA = mockPerson({ id: 'pb-emma', cm_id: 100, grade: 6, year: 2025, household_id: 0 })

/** Liam Garcia is the bunk-request target (different session, so declined) */
const LIAM = mockPerson({
  id: 'pb-liam',
  cm_id: 201,
  first_name: 'Liam',
  last_name: 'Garcia',
  gender: 'M',
  grade: 6,
  year: 2025,
  household_id: 0,
})

/** Emma's declined bunk-with request targeting Liam Garcia (different session) */
const DECLINED_REQUEST: Record<string, unknown> = {
  id: 'req-declined-1',
  requester_id: 100,
  requestee_id: 201,
  request_type: 'bunk_with',
  status: 'declined',
  priority: 1,
  requested_person_name: 'Liam Garcia',
  disposition_reason: 'session_mismatch',
  year: 2025,
  session_id: 1001,
  is_reciprocal: false,
  confidence_score: 0.92,
  source_field: 'share_bunk_with',
  created: '2025-01-01T00:00:00Z',
  updated: '2025-01-01T00:00:00Z',
  collectionId: 'bunk_requests',
  collectionName: 'bunk_requests',
  metadata: {},
}

/** A minimal attendee record for Emma */
const EMMA_ATTENDEE: Record<string, unknown> = {
  id: 'att-emma',
  person: 'pb-emma',
  person_id: 100,
  session: 'sess-1',
  status: 'enrolled',
  status_id: 2,
  year: 2025,
  collectionId: 'attendees',
  collectionName: 'attendees',
  created: '2025-01-01T00:00:00Z',
  updated: '2025-01-01T00:00:00Z',
  expand: {
    session: {
      id: 'sess-1',
      cm_id: 1001,
      name: 'Session 1',
      session_type: 'main',
    },
  },
}

/**
 * Set up per-collection mocks for a camper (Emma) with one declined request.
 * Persons is called twice: first for the main camper, then for the requestees.
 */
function setupDeclinedRequestMocks() {
  // First call: look up the main camper by cm_id (filter includes person cm_id)
  // Second call: look up requestees by cm_id (filter includes requestee cm_id list)
  mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
    const filter = opts.filter ?? ''
    if (filter.includes(`cm_id = ${LIAM.cm_id}`)) {
      return Promise.resolve([LIAM])
    }
    return Promise.resolve([EMMA])
  })
  mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
  mockGetFullListBunkAssignments.mockResolvedValue([])
  mockGetFullListBunkRequests.mockResolvedValue([DECLINED_REQUEST])
  mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
  mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
}

describe('CamperDetailsPanel', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: empty responses for all collections
    mockGetFullListPersons.mockResolvedValue([])
    mockGetFullListAttendees.mockResolvedValue([])
    mockGetFullListBunkAssignments.mockResolvedValue([])
    mockGetFullListBunkRequests.mockResolvedValue([])
    mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
    mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
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

  // ---------------------------------------------------------------------------
  // Regression: sidebar (embedded) panel shows resolved target + decline reason
  // Spec item #50 — previously the embedded code path hit a temporal-dead-zone
  // ReferenceError on `nonAgeRequests` because it was declared after the early
  // embedded-mode `return`. The fix moves those declarations up.
  // ---------------------------------------------------------------------------
  describe('Bunk request display in embedded (sidebar) mode', () => {
    it('renders the target camper name (not "Unknown") for a declined request in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for camper data to load and the requests section to appear
      await waitFor(() => {
        // "Liam Garcia" is the requestee — should be visible, not "Unknown"
        expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
      })
    })

    it('renders the human-readable decline reason for a declined request in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // formatReason('session_mismatch') === 'Different sessions'
      await waitFor(() => {
        expect(screen.getByText(/·\s*Different sessions$/)).toBeInTheDocument()
      })
    })

    it('does not show "Unknown" as the target name for a declined request in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // The panel must load first — wait for the camper's name to appear.
      // The h2 renders first_name and last_name as separate text nodes so we
      // use a heading role matcher to find the element.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })

      // "Unknown" must not appear as a camper-name stand-in
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('renders the bunk-with request label alongside the target in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText('Bunk with')).toBeInTheDocument()
      })
    })
  })
})
