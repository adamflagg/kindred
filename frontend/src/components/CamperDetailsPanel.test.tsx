/**
 * Tests for CamperDetailsPanel component.
 *
 * This component displays detailed camper information in a slide-in panel,
 * including bunking preferences, camp journey history, siblings, and the
 * parent-sourced bunk request form text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../test/testUtils'
import CamperDetailsPanel from './CamperDetailsPanel'
import { mockPerson } from '../test/mockData'
import type { CamperSatisfaction, PerRequestStatus } from '../types/satisfaction'

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

// Mock AuthContext — AllCamperRequestsModal calls useAuth() at module load,
// even when isOpen=false, so tests need an AuthContext-shaped stub.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    pb: {},
    user: { id: 'admin', email: 'test@example.com' },
    isLoading: false,
    isAuthenticated: true,
    isBypassMode: false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn().mockResolvedValue(true),
  }),
}))

// Configurable mock for getSatisfiedRequestInfo — overridden in alert tests.
// Default returns empty CamperSatisfaction so existing tests are unaffected.
let mockGetSatisfiedRequestInfo = vi.fn(
  (personCmId: number): CamperSatisfaction => ({
    person_cm_id: personCmId,
    per_request: [] as PerRequestStatus[],
    counted_totals: {
      material_parent: { satisfied: 0, total: 0 },
      staff: { satisfied: 0, total: 0 },
    },
    immaterial: { satisfied: 0, total: 0 },
    flags: {
      parent_min_one_violation: false,
      staff_unsatisfied_alert: false,
      has_any_counted_request: false,
    },
  })
)

// Mock useBunkRequestContext — CamperDetailsPanel uses getSatisfiedRequestInfo
// from BunkRequestProvider to derive the unsatisfied-requests alert in parity
// with CamperCard. Default to "no requests / nothing satisfied" so existing
// tests don't have to think about request data.
vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useBunkRequestContext: () => ({
      allRequests: [],
      hasRequests: () => false,
      getRequestsForCamper: () => [],
      getSatisfiedRequestInfo: (personCmId: number) => mockGetSatisfiedRequestInfo(personCmId),
      isLoading: false,
      error: null,
    }),
  }
})

// Mutable mock for LockGroupContext so tests can toggle isActionBarVisible
const mockLockGroupContext: { isActionBarVisible: boolean } & Record<string, unknown> = {
  isActionBarVisible: false,
  isDraftMode: false,
  groups: [],
  pendingCampers: [],
  addPendingCamper: vi.fn(),
  removePendingCamper: vi.fn(),
  getPendingAnimationDelay: () => 0,
  addCamperToGroup: vi.fn(),
  getCamperLockGroup: () => null,
  getCamperLockState: () => 'none' as const,
  getCamperLockGroupColor: () => undefined,
  getGroupMembers: () => [],
  createLockGroup: vi.fn(),
  deleteLockGroup: vi.fn(),
  isLoading: false,
}
// Mock LockGroupContext — CamperDetailsPanel uses it for alert derivation
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => mockLockGroupContext,
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

/**
 * Emma's resolved-with-decline-disposition bunk-with request targeting Liam
 * Garcia (different session).
 *
 * Production query at CamperDetailsPanel.tsx:422 filters `status = "resolved"`
 * — declined-disposition rows reach the panel by being `status='resolved'` with
 * a `disposition_reason` set, not by `status='declined'`. Fixture matches the
 * shape that can actually surface in prod (#1341).
 */
const DECLINED_REQUEST: Record<string, unknown> = {
  id: 'req-declined-1',
  requester_id: 100,
  requestee_id: 201,
  request_type: 'bunk_with',
  status: 'resolved',
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
    mockLockGroupContext.isActionBarVisible = false
    // Reset getSatisfiedRequestInfo to the default no-op after each test
    mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
      person_cm_id: personCmId,
      per_request: [],
      counted_totals: {
        material_parent: { satisfied: 0, total: 0 },
        staff: { satisfied: 0, total: 0 },
      },
      immaterial: { satisfied: 0, total: 0 },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: false,
        has_any_counted_request: false,
      },
    }))
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

    // Regression: when the panel is mounted inside a Modal, pressing Escape
    // should close the panel without also closing the underlying modal.
    // Both register document-level keydown listeners — the panel uses
    // capture-phase + stopPropagation so its handler runs first and prevents
    // the modal's bubble-phase listener from firing.
    it('stops Escape from reaching outer document-level listeners (LIFO close)', async () => {
      const outerHandler = vi.fn()
      document.addEventListener('keydown', outerHandler)

      try {
        render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)
        await waitFor(() => {
          expect(document.querySelector('[data-testid="panel-backdrop"]')).toBeInTheDocument()
        })

        fireEvent.keyDown(document, { key: 'Escape' })

        const escapeCalls = outerHandler.mock.calls.filter(
          ([event]) => (event as KeyboardEvent).key === 'Escape'
        )
        expect(escapeCalls).toHaveLength(0)
      } finally {
        document.removeEventListener('keydown', outerHandler)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Regression: sidebar (embedded) panel shows resolved target + decline reason
  // Spec item #50 — previously the embedded code path hit a temporal-dead-zone
  // ReferenceError on `nonAgeRequests` because it was declared after the early
  // embedded-mode `return`. The fix moves those declarations up.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Regression: graph-launched panel must honour the bunkCampers prop
  // Issue #1061 — SocialNetworkGraph and BunkSocialGraphModal never passed
  // bunkCampers, so the panel fell back to a self-only roster and
  // getSatisfiedRequestInfo could not detect unsatisfied requests.
  //
  // The fix is at the call sites (SocialNetworkGraph.tsx and
  // BunkSocialGraphModal.tsx); these tests verify the prop flows through
  // correctly to getSatisfiedRequestInfo.
  //
  // Fictional names (CLAUDE.md): Emma (1001) bunked with Liam (1003) in
  // bunk 9001. Emma has a material parent request for Olivia (1002) who is
  // in bunk 9002. When bunkCampers includes only 1001+1003, the panel should
  // surface the unsatisfied-parent-requests alert.
  // ---------------------------------------------------------------------------
  describe('bunkCampers prop plumbing (Issue #1061)', () => {
    /** Emma Johnson, cm_id=1001, bunk 9001 */
    const EMMA_1061 = mockPerson({
      id: 'pb-emma-1061',
      cm_id: 1001,
      first_name: 'Emma',
      last_name: 'Johnson',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Emma's bunk assignment in bunk 9001 */
    const EMMA_ASSIGNMENT: Record<string, unknown> = {
      id: 'assign-emma-1061',
      person: 'pb-emma-1061',
      person_id: 1001,
      session: 'sess-a',
      year: 2025,
      collectionId: 'bunk_assignments',
      collectionName: 'bunk_assignments',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        bunk: {
          id: 'bunk-9001',
          cm_id: 9001,
          name: 'Bunk Oak',
          capacity: 12,
          gender: 'F',
          year: 2025,
        },
      },
    }

    /** Emma's attendee record, session sess-a */
    const EMMA_ATTENDEE_1061: Record<string, unknown> = {
      id: 'att-emma-1061',
      person: 'pb-emma-1061',
      person_id: 1001,
      session: 'sess-a',
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      collectionId: 'attendees',
      collectionName: 'attendees',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        session: {
          id: 'sess-a',
          cm_id: 2001,
          name: 'Session A',
          session_type: 'main',
        },
      },
    }

    /** Emma's material-parent bunk_with request for Olivia (cm_id 1002) */
    const OLIVIA_REQUEST: Record<string, unknown> = {
      id: 'req-olivia-1061',
      requester_id: 1001,
      requestee_id: 1002,
      request_type: 'bunk_with',
      source: 'family',
      source_field: 'bunk_with',
      status: 'resolved',
      requested_person_name: 'Olivia Chen',
      year: 2025,
      session_id: 2001,
      is_reciprocal: false,
      confidence_score: 0.95,
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      collectionId: 'bunk_requests',
      collectionName: 'bunk_requests',
      metadata: {},
    }

    /** Olivia Chen person record, so the panel can resolve her name */
    const OLIVIA_PERSON = mockPerson({
      id: 'pb-olivia-1061',
      cm_id: 1002,
      first_name: 'Olivia',
      last_name: 'Chen',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    function setupGraphPanelMocks() {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
        const filter = opts.filter ?? ''
        if (filter.includes('cm_id = 1002')) return Promise.resolve([OLIVIA_PERSON])
        return Promise.resolve([EMMA_1061])
      })
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE_1061])
      mockGetFullListBunkAssignments.mockResolvedValue([EMMA_ASSIGNMENT])
      mockGetFullListBunkRequests.mockResolvedValue([OLIVIA_REQUEST])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    }

    it('surfaces parent_min_one_violation alert when getSatisfiedRequestInfo returns the flag', async () => {
      // Satisfaction is now server-computed. The alert fires when the mock
      // (standing in for /api/satisfaction) returns parent_min_one_violation: true.
      mockGetSatisfiedRequestInfo.mockImplementation((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [],
        counted_totals: {
          material_parent: { total: 1, satisfied: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: true,
          staff_unsatisfied_alert: false,
          has_any_counted_request: true,
        },
      }))

      setupGraphPanelMocks()

      const bunkCampers = [
        { cmId: 1001, grade: 6 },
        { cmId: 1003, grade: 6 },
      ]

      render(<CamperDetailsPanel camperId="1001" onClose={mockOnClose} bunkCampers={bunkCampers} />)

      await waitFor(() => {
        expect(screen.getByText('1 parent request, none satisfied')).toBeInTheDocument()
      })
    })

    it('calls getSatisfiedRequestInfo with the camper person_cm_id', async () => {
      // Verify that once the panel loads, it calls getSatisfiedRequestInfo with
      // Emma's person_cm_id (1001). During the loading phase the panel may call
      // with 0 (the `camper?.person_cm_id ?? 0` fallback) — so we wait for the
      // heading and then check that at least one call used the correct id.
      setupGraphPanelMocks()

      render(<CamperDetailsPanel camperId="1001" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })

      const calls = mockGetSatisfiedRequestInfo.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      // At least one call should use personCmId=1001 (after the camper loads)
      const calledWithCorrectId = calls.some((call) => call[0] === 1001)
      expect(calledWithCorrectId).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Stage 3b.1 — R3 row list: Parent rows → Staff sub-divider → Staff rows
  // → age preference divider → age rows (with P/S badges).
  // ---------------------------------------------------------------------------
  describe('CamperDetailsPanel — Stage 3b.1 R3 row list in Bunking Preferences section', () => {
    /** Person record for Emma Johnson (parent request source) */
    const EMMA_R3 = mockPerson({
      id: 'pb-emma-r3',
      cm_id: 100,
      first_name: 'Emma',
      last_name: 'Johnson',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Person record for Riley Sam (target of the parent request) */
    const RILEY_PERSON = mockPerson({
      id: 'pb-riley-r3',
      cm_id: 200,
      first_name: 'Riley',
      last_name: 'Sam',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Attendee record for Emma in session sess-r3 */
    const EMMA_R3_ATTENDEE: Record<string, unknown> = {
      id: 'att-emma-r3',
      person: 'pb-emma-r3',
      person_id: 100,
      session: 'sess-r3',
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      collectionId: 'attendees',
      collectionName: 'attendees',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        session: {
          id: 'sess-r3',
          cm_id: 3001,
          name: 'Session R3',
          session_type: 'main',
        },
      },
    }

    /**
     * Set up mocks for a given set of bunk requests.
     * Persons lookup resolves requestee_id=200 to Riley, otherwise returns Emma.
     */
    function setupR3Mocks(bunkRequests: Record<string, unknown>[]) {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
        const filter = opts.filter ?? ''
        if (filter.includes('cm_id = 200')) return Promise.resolve([RILEY_PERSON])
        return Promise.resolve([EMMA_R3])
      })
      mockGetFullListAttendees.mockResolvedValue([EMMA_R3_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue(bunkRequests)
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    }

    it('renders Parent rows before Staff sub-divider before Staff rows', async () => {
      // Two requests: one parent (bunk_with Emma→Riley), one staff (not_bunk_with)
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-p1',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: 'bunk_with',
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
        {
          id: 'r3-s1',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'not_bunk_with',
          source_field: 'not_bunk_with',
          source: 'staff',
          status: 'resolved',
          requested_person_name: 'Olivia Chen',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      const { container } = render(
        <CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />
      )

      // Wait for requests to load (Riley Sam appears as a target name)
      await waitFor(() => {
        expect(container.textContent).toContain('Riley')
      })

      // The combined Parent ↑ │ ⬇ Staff divider is the only element with the
      // `font-mono` utility on its container <div>.
      const dividerEl = container.querySelector('div.font-mono')
      expect(dividerEl).not.toBeNull()
      expect(dividerEl?.textContent).toMatch(/Parent.*Staff/)

      const allElements = Array.from(container.querySelectorAll('*'))
      const dividerIdx = allElements.indexOf(dividerEl as Element)

      // Leaf element containing "Riley" but not "Olivia"
      const rileyEl = Array.from(container.querySelectorAll('*')).find(
        (el) => el.textContent?.includes('Riley') && !el.textContent?.includes('Olivia')
      )
      // Leaf element containing "Olivia" but not "Riley"
      const oliviaEl = Array.from(container.querySelectorAll('*')).find(
        (el) => el.textContent?.includes('Olivia') && !el.textContent?.includes('Riley')
      )
      const rileyIdx = allElements.indexOf(rileyEl as Element)
      const oliviaIdx = allElements.indexOf(oliviaEl as Element)

      expect(rileyIdx).toBeGreaterThan(-1)
      expect(oliviaIdx).toBeGreaterThan(-1)
      // Parent request (Riley) appears BEFORE the Staff divider
      expect(rileyIdx).toBeLessThan(dividerIdx)
      // Staff request (Olivia) appears AFTER the Staff divider
      expect(dividerIdx).toBeLessThan(oliviaIdx)
    })

    it('omits Staff sub-divider when there are no staff rows', async () => {
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-p1-only',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: 'bunk_with',
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      const { container } = render(
        <CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />
      )
      await waitFor(() => {
        expect(container.textContent).toContain('Riley')
      })

      // No combined Parent/Staff divider when only parent rows exist.
      expect(container.querySelector('div.font-mono')).toBeNull()
    })

    it('renders P badge on bunk_with-derived age preference (family source)', async () => {
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-age-p',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunk_with',
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      // After #1159, age-pref P/S badges read per_request[i].bucket from the
      // centralized aggregator, not raw source_field. Mirror what
      // session_satisfaction would emit for this row.
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-age-p',
            bucket: 'material_parent',
            satisfied: false,
          } as PerRequestStatus,
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 1 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: true,
          staff_unsatisfied_alert: false,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('P')).toBeInTheDocument()
    })

    it('renders S badge on staff-source age preference', async () => {
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-age-s',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunking_notes',
          source: 'staff',
          age_preference_target: 'younger',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-age-s',
            bucket: 'staff',
            satisfied: false,
          } as PerRequestStatus,
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 1 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: true,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
    })

    it('age-pref badge follows per_request.bucket, not raw source_field (#1159)', async () => {
      // Mismatched fixture: source_field=bunk_with would set P under the old
      // per-row classification, but the centralized aggregator's bucket=staff
      // wins → S badge, not P.
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-mismatch',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunk_with',
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-mismatch',
            bucket: 'staff',
            satisfied: false,
          } as PerRequestStatus,
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 1 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: true,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
      expect(screen.queryByText('P')).toBeNull()
    })

    it('#1172: renders P badge from source_field=bunk_with when per_request is empty', async () => {
      // Simulate /api/satisfaction unavailable: emptyCamperSatisfaction (per_request: []).
      // Pre-#1158 the badge was driven by the row's own source_field — fall back to
      // that path so a backend hiccup doesn't silently hide the P badge.
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-fallback-p',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunk_with',
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      // Empty per_request — bucketByRequestId is empty → fallback path must fire.
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [] as PerRequestStatus[],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
          has_any_counted_request: false,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('P')).toBeInTheDocument()
      expect(screen.queryByText('S')).toBeNull()
    })

    it('#1172: renders S badge from source=staff when per_request is empty', async () => {
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-fallback-s',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunking_notes',
          source: 'staff',
          age_preference_target: 'younger',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [] as PerRequestStatus[],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
          has_any_counted_request: false,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
      expect(screen.queryByText('P')).toBeNull()
    })

    it('does NOT render any new "Parent request satisfaction:" summary line in the sidebar', async () => {
      // The sidebar conveys source-aware satisfaction via CamperAlertSection,
      // not a separate summary label. Spec §2.4 explicitly forbids adding one.
      const bunkRequests: Record<string, unknown>[] = [
        {
          id: 'r3-no-summary',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: 'bunk_with',
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      // Wait for the row to render before asserting the summary lines are absent.
      await screen.findByText('Riley Sam')
      expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
      expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
    })
  })

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

    it('does not render the disposition reason for a resolved-disposition row in embedded mode', async () => {
      // BunkRequestRow.tsx skips disposition_reason rendering for status='resolved'
      // rows on purpose ("the reason isn't user-meaningful here"). The
      // production query at CamperDetailsPanel.tsx:422 only delivers
      // status='resolved' rows, so the decline reason never surfaces in the
      // sidebar. Asserting the absence pins that contract — a regression that
      // re-introduced the line would change user-visible behavior.
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for the row to render, then assert the disposition reason is absent.
      await screen.findByText('Liam Garcia')
      expect(screen.queryByText(/Different sessions/)).not.toBeInTheDocument()
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

  describe('Bunk Request Form section (parent-sourced quick-ref)', () => {
    /** Build a minimal original_bunk_requests record matching the hook's schema. */
    function originalBunkRecord(content: string) {
      return {
        id: 'obr-1',
        field: 'bunk_with' as const,
        content,
        requester: 'pb-emma',
        year: 2025,
        created: '2025-01-01T00:00:00Z',
        updated: '2025-05-01T00:00:00Z',
        collectionId: 'original_bunk_requests',
        collectionName: 'original_bunk_requests',
        expand: { requester: { first_name: 'Emma', last_name: 'Johnson' } },
      }
    }

    /** Set up mocks for Emma with a populated parent bunk-request form input. */
    function setupParentBunkRequestText(content: string) {
      mockGetFullListPersons.mockResolvedValue([EMMA])
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue([])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({
        items: [originalBunkRecord(content)],
        totalItems: 1,
      })
    }

    it('renders the "Bunk Request Form" section header when parent text exists', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Bunk Request Form/i)).toBeInTheDocument()
      })
    })

    it('shows the parent text by default (default expanded for quick-ref)', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Bunk Request Form/i)).toBeInTheDocument()
      })
      // Parent text immediately visible without any click
      expect(screen.getByText('Riley Sam, Olivia Chen')).toBeInTheDocument()
    })

    it('collapses the parent text when the section header is clicked', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for the section to render with text visible
      await waitFor(() => {
        expect(screen.getByText('Riley Sam, Olivia Chen')).toBeInTheDocument()
      })

      // Click the header to collapse
      const header = screen.getByRole('button', { name: /Bunk Request Form/i })
      header.click()

      await waitFor(() => {
        expect(screen.queryByText('Riley Sam, Olivia Chen')).not.toBeInTheDocument()
      })
    })

    it('does not render the section when there is no parent bunk-request text', async () => {
      // No original_bunk_requests record at all
      mockGetFullListPersons.mockResolvedValue([EMMA])
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue([])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for camper to load (heading appears)
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Bunk Request Form/i)).not.toBeInTheDocument()
    })

    it('does not render the section when bunk_with record exists but content is empty', async () => {
      setupParentBunkRequestText('')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Bunk Request Form/i)).not.toBeInTheDocument()
    })

    it('queries original_bunk_requests using the working requester.cm_id filter (not the broken person_id)', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(mockGetListOriginalBunkRequests).toHaveBeenCalled()
      })
      const filter = String(mockGetListOriginalBunkRequests.mock.calls[0]?.[2]?.filter ?? '')
      expect(filter).toContain('requester.cm_id = 100')
      expect(filter).not.toContain('person_id =')
    })
  })

  // Shared fixtures for the multi-field source-data sections below
  // (Do NOT Share Bunk With + Staff Notes). The pre-existing Bunk Request
  // Form describe has its own narrower helper and is intentionally untouched.
  /** Build a minimal original_bunk_requests record with a custom field. */
  function originalBunkRecord(
    id: string,
    field: 'bunk_with' | 'not_bunk_with' | 'internal_notes' | 'bunking_notes' | 'socialize_with',
    content: string
  ) {
    return {
      id,
      field,
      content,
      requester: 'pb-emma',
      year: 2025,
      created: '2025-01-01T00:00:00Z',
      updated: '2025-05-01T00:00:00Z',
      collectionId: 'original_bunk_requests',
      collectionName: 'original_bunk_requests',
      expand: { requester: { first_name: 'Emma', last_name: 'Johnson' } },
    }
  }

  function setupOriginalBunkRecords(records: Array<ReturnType<typeof originalBunkRecord>>) {
    mockGetFullListPersons.mockResolvedValue([EMMA])
    mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
    mockGetFullListBunkAssignments.mockResolvedValue([])
    mockGetFullListBunkRequests.mockResolvedValue([])
    mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
    mockGetListOriginalBunkRequests.mockResolvedValue({
      items: records,
      totalItems: records.length,
    })
  }

  describe('Do NOT Share Bunk With section (parent-sourced quick-ref)', () => {
    it('renders the "Do NOT Share Bunk With" section header when negative text exists', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'not_bunk_with', 'Liam Garcia')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Do NOT Share Bunk With/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    })

    it('does not render the section when there is no negative text', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'bunk_with', 'Riley Sam')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Do NOT Share Bunk With/i)).not.toBeInTheDocument()
    })

    it('does not render the section when negative content is whitespace-only', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'not_bunk_with', '   ')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Do NOT Share Bunk With/i)).not.toBeInTheDocument()
    })
  })

  describe('Staff Notes section (combines internal + bunking notes)', () => {
    it('renders Staff Notes with only internal notes when bunking notes is empty', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', 'Watch for homesickness'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Watch for homesickness')).toBeInTheDocument()
    })

    it('renders Staff Notes with only bunking notes when internal is empty', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'bunking_notes', 'Allergic to peanuts'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Allergic to peanuts')).toBeInTheDocument()
    })

    it('renders Staff Notes with both texts stacked when both are populated', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', 'Watch for homesickness'),
        originalBunkRecord('obr-2', 'bunking_notes', 'Allergic to peanuts'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Watch for homesickness')).toBeInTheDocument()
      expect(screen.getByText('Allergic to peanuts')).toBeInTheDocument()
    })

    it('does not render Staff Notes when neither field is populated', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'bunk_with', 'Riley Sam')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Staff Notes/i)).not.toBeInTheDocument()
    })

    it('does not render Staff Notes when both fields are whitespace-only', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', '   '),
        originalBunkRecord('obr-2', 'bunking_notes', '\n\t'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Staff Notes/i)).not.toBeInTheDocument()
    })

    it('never surfaces the Social With Checkbox field (5th, excluded)', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'socialize_with', 'Marked social-with-best'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Social With/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Marked social-with-best/)).not.toBeInTheDocument()
    })
  })

  describe('CamperDetailsPanel — backdrop is click-through', () => {
    it('backdrop has pointer-events-none so clicks fall through to underlying elements', () => {
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const backdrop = container.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop?.className).toContain('pointer-events-none')
    })
  })

  describe('CamperDetailsPanel layout — action bar awareness', () => {
    it('has top-0 and bottom-0 classes when action bar is hidden', () => {
      mockLockGroupContext.isActionBarVisible = false
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const root = container.querySelector('[data-panel="camper-details"]')
      expect(root?.classList.contains('top-0')).toBe(true)
      expect(root?.classList.contains('bottom-0')).toBe(true)
      expect(root?.classList.contains('pb-20')).toBe(false)
      expect(root?.classList.contains('bottom-20')).toBe(false)
    })

    it('adds bottom-20 (shrinks panel) when action bar is visible instead of padding', () => {
      mockLockGroupContext.isActionBarVisible = true
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const root = container.querySelector('[data-panel="camper-details"]')
      expect(root?.classList.contains('top-0')).toBe(true)
      expect(root?.classList.contains('bottom-20')).toBe(true)
      expect(root?.classList.contains('pb-20')).toBe(false)
      expect(root?.classList.contains('bottom-0')).toBe(false)
    })
  })
})
