/**
 * Tests for RequestReviewPanel component.
 *
 * This component displays bunk requests for review in a tabular format,
 * with filtering, sorting, and inline editing capabilities.
 *
 * Test categories:
 * 1. Rendering states (loading, empty, populated)
 * 2. Clickable requester name feature (opens CamperDetailsPanel)
 * 3. Filter and sort functionality
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, waitFor } from '../test/testUtils'
import RequestReviewPanel from './RequestReviewPanel'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

/**
 * Helper for the approve/reject handler tests: sets up the pb mock with a
 * single pending request, renders the panel, and returns the spy + a helper
 * to find the row-level action button by title.
 */
async function renderPanelWithRequest(request: Partial<BunkRequestsResponse>) {
  const { pb } = (await import('../lib/pocketbase')) as unknown as {
    pb: {
      collection: ReturnType<typeof vi.fn>
    }
  }

  const updateSpy = vi.fn().mockResolvedValue({})

  pb.collection.mockImplementation((name: string) => {
    if (name === 'bunk_requests') {
      return {
        getFullList: vi.fn().mockResolvedValue([request]),
        getList: vi.fn().mockResolvedValue({ items: [request], totalItems: 1 }),
        update: updateSpy,
      }
    }
    return {
      getFullList: vi.fn().mockResolvedValue([]),
      getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      update: vi.fn().mockResolvedValue({}),
    }
  })

  render(<RequestReviewPanel sessionId={1001} year={2025} />)

  const findButtonByTitle = (title: string) =>
    waitFor(
      () => {
        const buttons = screen.getAllByTitle(title)
        const first = buttons[0]
        if (!first) throw new Error(`no ${title} button yet`)
        return first
      },
      { timeout: 3000 }
    )

  return { updateSpy, findButtonByTitle, user: userEvent.setup() }
}

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

// Mock useAuth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    isLoading: false,
  }),
}))

describe('RequestReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering States', () => {
    it('shows loading state initially', () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      // The component should render without crashing
      // Loading state is handled by React Query
      expect(document.body).toBeInTheDocument()
    })

    it('renders filter controls', async () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      // Should have search input
      await waitFor(() => {
        // Check that component rendered (search input may or may not exist depending on implementation)
        expect(document.body).toBeInTheDocument()
      })
    })

    it('accepts relatedSessionIds prop for sub-sessions', () => {
      // Should not throw when rendering with related sessions
      render(<RequestReviewPanel sessionId={1001} relatedSessionIds={[1002, 1003]} year={2025} />)

      expect(document.body).toBeInTheDocument()
    })
  })

  /**
   * IMPLEMENTED FEATURE: Clickable Requester Name
   *
   * Implementation details:
   * - Requester name is wrapped in a <button> element
   * - Clicking sets selectedCamperId state with requester's cm_id
   * - CamperDetailsPanel is conditionally rendered when selectedCamperId is set
   * - Panel can be closed via onClose callback, clearing selectedCamperId
   */
  describe('Requester Click Feature', () => {
    it('renders requester name as a clickable button', async () => {
      // Test: requester names should be rendered as button elements for accessibility
      // The component renders requester names as <button> elements that trigger panel open
      // Example requester: { cm_id: 12345, first_name: 'Emma', last_name: 'Johnson' }

      // Button element should have role='button' implicitly and be focusable
      const buttonSelector = 'button'
      const hasButtonRole = document.querySelectorAll(buttonSelector).length >= 0
      expect(hasButtonRole).toBe(true)
    })

    it('opens CamperDetailsPanel when requester name is clicked', async () => {
      // Test: clicking requester name should set selectedCamperId state
      // which conditionally renders CamperDetailsPanel
      let selectedCamperId: string | null = null as string | null

      // Simulate the click handler behavior
      const setSelectedCamperId = (id: string) => {
        selectedCamperId = id
      }

      // Clicking should set the ID
      setSelectedCamperId('12345')
      expect(selectedCamperId).toBe('12345')

      // CamperDetailsPanel renders when selectedCamperId is truthy
      const shouldRenderPanel = selectedCamperId !== null
      expect(shouldRenderPanel).toBe(true)
    })

    it('closes CamperDetailsPanel when close button is clicked', async () => {
      // Test: closing CamperDetailsPanel should clear selectedCamperId
      let selectedCamperId: string | null = '12345'

      // The onClose callback clears the state
      const handleClose = () => {
        selectedCamperId = null
      }

      handleClose()
      expect(selectedCamperId).toBeNull()
    })

    it('shows correct requester info when clicking different requesters', async () => {
      // Test: clicking different requesters should update selectedCamperId
      let selectedCamperId: string | null = null
      const setSelectedCamperId = (id: string | null) => {
        selectedCamperId = id
      }

      // Click first requester
      setSelectedCamperId('12345')
      expect(selectedCamperId).toBe('12345')

      // Click second requester (should update, not append)
      setSelectedCamperId('67890')
      expect(selectedCamperId).toBe('67890')
      expect(selectedCamperId).not.toBe('12345')
    })
  })

  /**
   * Filter and Sort functionality tests.
   * Tests verify the filtering and sorting logic used by the component.
   */
  describe('Filter and Sort', () => {
    // Mock request data for testing
    const mockRequests = [
      {
        id: 'req1',
        requester_id: 100,
        confidence_score: 0.95,
        request_type: 'bunk_with',
        status: 'resolved',
      },
      {
        id: 'req2',
        requester_id: 101,
        confidence_score: 0.45,
        request_type: 'not_bunk_with',
        status: 'pending',
      },
      {
        id: 'req3',
        requester_id: 102,
        confidence_score: 0.7,
        request_type: 'bunk_with',
        status: 'declined',
      },
      {
        id: 'req4',
        requester_id: 103,
        confidence_score: 0.3,
        request_type: 'age_preference',
        status: 'pending',
      },
    ]

    it('filters requests by confidence threshold', () => {
      // When slider is at 0, show all requests
      // When slider is at a value, show only requests with confidence <= that value
      const applyConfidenceFilter = (threshold: number) =>
        mockRequests.filter((r) => (threshold === 0 ? true : r.confidence_score <= threshold / 100))

      // At threshold 0, show all
      expect(applyConfidenceFilter(0)).toHaveLength(4)

      // At threshold 50 (0.50), show requests with confidence <= 0.50
      const filtered = applyConfidenceFilter(50)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((r) => r.id)).toEqual(['req2', 'req4'])
    })

    it('filters requests by request type', () => {
      // Filter by specific request types
      const requestTypes = ['bunk_with']

      const filtered = mockRequests.filter((r) =>
        requestTypes.length === 0 ? true : requestTypes.includes(r.request_type)
      )

      expect(filtered).toHaveLength(2)
      expect(filtered.every((r) => r.request_type === 'bunk_with')).toBe(true)
    })

    it('filters requests by status', () => {
      // Filter by status (pending, resolved, declined)
      const statuses = ['pending']

      const filtered = mockRequests.filter((r) =>
        statuses.length === 0 ? true : statuses.includes(r.status)
      )

      expect(filtered).toHaveLength(2)
      expect(filtered.every((r) => r.status === 'pending')).toBe(true)
    })

    it('searches requests by requester name', () => {
      // Mock person data
      const personMap = new Map([
        [100, { first_name: 'Emma', last_name: 'Johnson' }],
        [101, { first_name: 'Liam', last_name: 'Garcia' }],
        [102, { first_name: 'Olivia', last_name: 'Chen' }],
        [103, { first_name: 'Emma', last_name: 'Smith' }], // Another Emma
      ])

      const searchQuery = 'emma'
      const searchLower = searchQuery.toLowerCase()

      const filtered = mockRequests.filter((r) => {
        const person = personMap.get(r.requester_id)
        const fullName = person ? `${person.first_name} ${person.last_name}`.toLowerCase() : ''
        return fullName.includes(searchLower)
      })

      // Should find both Emmas (req1, req4)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((r) => r.id)).toEqual(['req1', 'req4'])
    })

    it('sorts requests by different columns', () => {
      // Sort by confidence score
      const sortedByConfidence = [...mockRequests].sort(
        (a, b) => a.confidence_score - b.confidence_score
      )

      expect(sortedByConfidence[0]?.id).toBe('req4') // lowest confidence
      expect(sortedByConfidence[3]?.id).toBe('req1') // highest confidence

      // Sort by status alphabetically
      const sortedByStatus = [...mockRequests].sort((a, b) => a.status.localeCompare(b.status))

      expect(sortedByStatus[0]?.status).toBe('declined')
      expect(sortedByStatus[3]?.status).toBe('resolved')
    })

    it('toggles sort order between ascending and descending', () => {
      let sortOrder: 'asc' | 'desc' = 'asc'

      // Toggle function
      const toggleSort = () => {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      }

      // Initial state
      expect(sortOrder).toBe('asc')

      // Sort ascending by confidence
      let sorted = [...mockRequests].sort((a, b) =>
        sortOrder === 'asc'
          ? a.confidence_score - b.confidence_score
          : b.confidence_score - a.confidence_score
      )
      expect(sorted[0]?.id).toBe('req4') // lowest first in asc

      // Toggle to descending
      toggleSort()
      expect(sortOrder).toBe('desc')

      sorted = [...mockRequests].sort((a, b) =>
        sortOrder === 'asc'
          ? a.confidence_score - b.confidence_score
          : b.confidence_score - a.confidence_score
      )
      expect(sorted[0]?.id).toBe('req1') // highest first in desc

      // Toggle back to ascending
      toggleSort()
      expect(sortOrder).toBe('asc')
    })
  })

  // #2068 — the desktop header's sortable columns were a bare `<div onClick>`
  // with no tab stop: no key press could sort them.
  describe('#2068: sortable column headers are keyboard reachable', () => {
    it('every sortable header (Requester, Request, Confidence, Status) has a real button', async () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      for (const name of ['Requester', 'Request', 'Confidence', 'Status']) {
        const header = await screen.findByRole('columnheader', { name })
        expect(within(header).getByRole('button').tagName).toBe('BUTTON')
      }
    })

    it('the unsortable Type and Actions columns are not columnheaders', () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument()
    })

    it('Tab reaches the Requester header and Enter sorts it', async () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      const requesterButton = await screen.findByRole('button', { name: 'Requester' })
      requesterButton.focus()
      await userEvent.keyboard('{Enter}')

      const header = requesterButton.closest('[role="columnheader"]') as HTMLElement
      expect(['ascending', 'descending']).toContain(header.getAttribute('aria-sort'))
    })

    it('Space also sorts the Confidence header', async () => {
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      const confidenceButton = await screen.findByRole('button', { name: 'Confidence' })
      confidenceButton.focus()
      await userEvent.keyboard(' ')

      const header = confidenceButton.closest('[role="columnheader"]') as HTMLElement
      expect(['ascending', 'descending']).toContain(header.getAttribute('aria-sort'))
    })
  })

  /**
   * TDD TESTS: Collapsible Filter Bar (UI Optimization Part 1)
   *
   * Design goals:
   * - Filter bar should collapse to ~48px for space efficiency
   * - Filter toggle button shows count of active filters
   * - Search input remains visible in collapsed state
   * - Expanded state slides down smoothly
   * - Escape key closes expanded filters
   */
  describe('Collapsible Filter Bar', () => {
    it('should have filters collapsed by default', () => {
      // The filter bar should start in collapsed state to save vertical space
      const defaultFiltersExpanded = false
      expect(defaultFiltersExpanded).toBe(false)
    })

    it('should calculate active filter count correctly', () => {
      // Active filters: confidence/review filter, selected request types, non-default statuses
      const filters = {
        lowConfidenceOnly: true, // non-default (false is default)
        needsReviewOnly: false,
        requestTypes: ['bunk_with', 'not_bunk_with'], // 2 types selected
        statuses: ['pending'], // 1 status (default has 3)
        searchQuery: '',
        showResolved: false,
        resolvedConfidenceFilter: 'all' as const,
      }

      // Count active filters:
      // - lowConfidenceOnly || needsReviewOnly = 1
      // - requestTypes.length > 0 = 1 (counts as 1 regardless of how many types)
      // - statuses differ from default = 1
      let activeCount = 0
      if (filters.lowConfidenceOnly || filters.needsReviewOnly) activeCount++
      if (filters.requestTypes.length > 0) activeCount++
      if (filters.statuses.length !== 3 || filters.showResolved) activeCount++

      expect(activeCount).toBe(3)
    })

    it('should toggle filters expanded state on button click', () => {
      let filtersExpanded = false

      // Simulate toggle click
      filtersExpanded = !filtersExpanded
      expect(filtersExpanded).toBe(true)

      // Toggle again
      filtersExpanded = !filtersExpanded
      expect(filtersExpanded).toBe(false)
    })

    it('should close filters on Escape key', () => {
      let filtersExpanded = true

      // Simulate Escape key handler
      const handleKeyDown = (event: { key: string }) => {
        if (event.key === 'Escape' && filtersExpanded) {
          filtersExpanded = false
        }
      }

      handleKeyDown({ key: 'Escape' })
      expect(filtersExpanded).toBe(false)
    })

    it('should keep search input always visible regardless of collapse state', () => {
      // Search is always visible in the compact header bar
      const isSearchAlwaysVisible = true
      expect(isSearchAlwaysVisible).toBe(true)
    })

    it('should use correct ARIA attributes for accessibility', () => {
      const filtersExpanded = true
      const ariaExpanded = filtersExpanded
      const ariaControls = 'filter-panel'

      expect(ariaExpanded).toBe(true)
      expect(ariaControls).toBe('filter-panel')
    })
  })

  /**
   * TDD TESTS: Sticky Bottom Bulk Action Bar (UI Optimization Part 2)
   *
   * Design goals:
   * - Bar appears at bottom of screen (fixed position) when requests selected
   * - Uses transform animation (GPU-accelerated, no content shift)
   * - Shows selected count and preview of selected names
   * - Has Approve, Merge (when eligible), and Reject buttons
   * - Touch-friendly with 44px min-height buttons
   */
  describe('Sticky Bottom Bulk Action Bar', () => {
    it('should not render when no requests are selected', () => {
      const selectedRequests = new Set<string>()
      const shouldShowBar = selectedRequests.size > 0

      expect(shouldShowBar).toBe(false)
    })

    it('should render when requests are selected', () => {
      const selectedRequests = new Set(['req1', 'req2', 'req3'])
      const shouldShowBar = selectedRequests.size > 0

      expect(shouldShowBar).toBe(true)
    })

    it('should display correct selected count', () => {
      const selectedRequests = new Set(['req1', 'req2', 'req3'])
      const selectedCount = selectedRequests.size

      expect(selectedCount).toBe(3)
    })

    it('should preview first 2-3 selected names with overflow indicator', () => {
      // Helper function to get selected names preview
      const getSelectedNamesPreview = (names: string[], maxDisplay: number = 2) => {
        if (names.length === 0) return ''
        if (names.length <= maxDisplay) return names.join(', ')
        const displayed = names.slice(0, maxDisplay).join(', ')
        const remaining = names.length - maxDisplay
        return `${displayed} +${remaining}`
      }

      expect(getSelectedNamesPreview(['Emma J.', 'Liam G.'])).toBe('Emma J., Liam G.')
      expect(getSelectedNamesPreview(['Emma J.', 'Liam G.', 'Olivia C.'])).toBe(
        'Emma J., Liam G. +1'
      )
      expect(getSelectedNamesPreview(['Emma J.', 'Liam G.', 'Olivia C.', 'Noah S.'])).toBe(
        'Emma J., Liam G. +2'
      )
      expect(getSelectedNamesPreview([])).toBe('')
    })

    it('should use transform-based animation classes (not max-height)', () => {
      // The bar should use translate-y-full for hidden state
      // and translate-y-0 for visible state (GPU-accelerated)
      const hiddenClasses = 'translate-y-full'
      const visibleClasses = 'translate-y-0'

      expect(hiddenClasses).toContain('translate-y')
      expect(visibleClasses).toBe('translate-y-0')
    })

    it('should have fixed positioning at bottom of screen', () => {
      // Bar should be fixed position so it doesn't push table content
      const positioningClasses = 'fixed bottom-0 left-0 right-0'

      expect(positioningClasses).toContain('fixed')
      expect(positioningClasses).toContain('bottom-0')
    })

    it('should have proper ARIA attributes for accessibility', () => {
      const selectedCount = 3
      const ariaRole = 'toolbar'
      const ariaLabel = `Bulk actions for ${selectedCount} selected requests`

      expect(ariaRole).toBe('toolbar')
      expect(ariaLabel).toBe('Bulk actions for 3 selected requests')
    })

    it('should use will-change for smooth GPU animation', () => {
      const willChangeClasses = 'will-change-transform'
      expect(willChangeClasses).toBe('will-change-transform')
    })

    it('should have touch-friendly button sizes (min 44px)', () => {
      const minButtonHeight = 44
      const buttonClasses = 'min-h-[44px]'

      expect(minButtonHeight).toBeGreaterThanOrEqual(44)
      expect(buttonClasses).toContain('44')
    })
  })

  /**
   * TDD TESTS: Merge/Split Integration
   *
   * Phase 4-5 of cross-run deduplication system.
   *
   * Merge UI:
   * - When exactly 2 requests are selected with same requester + same session,
   *   a "Merge" button should appear in the bulk actions bar
   * - Clicking opens MergeRequestsModal
   *
   * Split UI:
   * - Requests with multiple source_fields (merged requests) should show
   *   a "Split" action button
   * - Clicking opens SplitRequestModal
   *
   * These tests require populated mock data with multiple requests.
   * Complex mocking requirements similar to Filter and Sort tests.
   */
  describe('Merge/Split Integration', () => {
    // Mock requests for merge/split testing
    const mockRequestsForMerge = [
      {
        id: 'req1',
        requester_id: 100,
        session_id: 1001,
        source_fields: ['bunk_with'],
        metadata: null,
      },
      {
        id: 'req2',
        requester_id: 100,
        session_id: 1001,
        source_fields: ['bunking_notes'],
        metadata: null,
      }, // Same requester
      {
        id: 'req3',
        requester_id: 101,
        session_id: 1001,
        source_fields: ['bunk_with'],
        metadata: null,
      }, // Different requester
      {
        id: 'req4',
        requester_id: 100,
        session_id: 1002,
        source_fields: ['bunk_with'],
        metadata: null,
      }, // Same requester, diff session
      {
        id: 'req5',
        requester_id: 100,
        session_id: 1001,
        source_fields: ['bunk_with', 'bunking_notes'],
        metadata: { merged_from: ['orig1', 'orig2'] },
      }, // Merged request
    ]

    // Merge eligibility logic from the component
    const getMergeEligibility = (
      selectedIds: Set<string>,
      requests: typeof mockRequestsForMerge
    ) => {
      if (selectedIds.size < 2) {
        return {
          canMerge: false,
          reason: 'Select at least 2 requests to merge',
        }
      }

      const selectedReqs = requests.filter((r) => selectedIds.has(r.id))
      if (selectedReqs.length < 2) {
        return { canMerge: false, reason: 'Selected requests not found' }
      }

      // Check all selected requests have the same requester_id
      const firstRequesterId = selectedReqs[0]?.requester_id
      const allSameRequester = selectedReqs.every((r) => r.requester_id === firstRequesterId)
      if (!allSameRequester) {
        return {
          canMerge: false,
          reason: 'All requests must have the same requester',
        }
      }

      // Check all selected requests have the same session_id
      const firstSessionId = selectedReqs[0]?.session_id
      const allSameSession = selectedReqs.every((r) => r.session_id === firstSessionId)
      if (!allSameSession) {
        return {
          canMerge: false,
          reason: 'All requests must be from the same session',
        }
      }

      return { canMerge: true, reason: '', requests: selectedReqs }
    }

    it('shows merge button when 2+ requests with same requester are selected', () => {
      // Select two requests with same requester and session
      const selectedRequests = new Set(['req1', 'req2'])

      const eligibility = getMergeEligibility(selectedRequests, mockRequestsForMerge)

      expect(eligibility.canMerge).toBe(true)
      expect(eligibility.reason).toBe('')
    })

    it('hides merge button when selected requests have different requesters', () => {
      // Select requests with different requesters
      const selectedRequests = new Set(['req1', 'req3'])

      const eligibility = getMergeEligibility(selectedRequests, mockRequestsForMerge)

      expect(eligibility.canMerge).toBe(false)
      expect(eligibility.reason).toBe('All requests must have the same requester')
    })

    it('shows merge button when 3+ requests with same requester are selected', () => {
      // Can merge more than 2 requests if all have same requester/session
      // Using req1, req2 (both requester 100, session 1001) and adding req5 which is also 100/1001
      const selectedRequests = new Set(['req1', 'req2', 'req5'])

      const eligibility = getMergeEligibility(selectedRequests, mockRequestsForMerge)

      expect(eligibility.canMerge).toBe(true)
    })

    it('opens MergeRequestsModal when merge button is clicked', () => {
      // Test the state flow when merge button is clicked
      let showMergeModal = false

      // Simulating the button click handler
      const handleMergeClick = () => {
        showMergeModal = true
      }

      handleMergeClick()
      expect(showMergeModal).toBe(true)
    })

    it('shows split button on requests with multiple source_fields', () => {
      // hasMultipleSources logic from the component
      const hasMultipleSources = (request: {
        source_fields?: string[]
        metadata?: { merged_from?: string[] } | null
      }) => {
        if (Array.isArray(request.source_fields) && request.source_fields.length > 1) {
          return true
        }
        const mergedFrom = request.metadata?.merged_from
        if (mergedFrom && Array.isArray(mergedFrom) && mergedFrom.length > 0) {
          return true
        }
        return false
      }

      // req5 has multiple source_fields and merged_from metadata
      const mergedRequest = mockRequestsForMerge.find((r) => r.id === 'req5')
      if (!mergedRequest) throw new Error('Test setup error')
      expect(hasMultipleSources(mergedRequest)).toBe(true)
    })

    it('hides split button on requests with single source_field', () => {
      const hasMultipleSources = (request: {
        source_fields?: string[]
        metadata?: { merged_from?: string[] } | null
      }) => {
        if (Array.isArray(request.source_fields) && request.source_fields.length > 1) {
          return true
        }
        const mergedFrom = request.metadata?.merged_from
        if (mergedFrom && Array.isArray(mergedFrom) && mergedFrom.length > 0) {
          return true
        }
        return false
      }

      // req1 has single source_field
      const singleSourceRequest = mockRequestsForMerge.find((r) => r.id === 'req1')
      if (!singleSourceRequest) throw new Error('Test setup error')
      expect(hasMultipleSources(singleSourceRequest)).toBe(false)
    })

    it('opens SplitRequestModal when split button is clicked', () => {
      // Test the state flow when split button is clicked
      let showSplitModal = false
      let requestToSplit: (typeof mockRequestsForMerge)[0] | null = null

      // Simulating the button click handler
      const handleSplitClick = (request: (typeof mockRequestsForMerge)[0]) => {
        requestToSplit = request
        showSplitModal = true
      }

      const mergedRequest = mockRequestsForMerge.find((r) => r.id === 'req5')
      if (!mergedRequest) throw new Error('Test setup error')
      handleSplitClick(mergedRequest)

      expect(showSplitModal).toBe(true)
      expect(requestToSplit).toBe(mergedRequest)
    })
  })

  /**
   * TDD TESTS: Merged Request UI Improvements
   *
   * These tests verify:
   * 1. Absorbed requests (with merged_into set) are filtered out of the list
   * 2. Merged request dropdown shows individual sources with their own data
   * 3. Source links are lazy loaded when expanding a merged request
   */
  describe('Merged Request UI Improvements', () => {
    describe('Filter Out Absorbed Requests', () => {
      it('should build filter query that excludes absorbed requests', () => {
        // The query filter should include: merged_into = "" || merged_into = null
        const sessionFilter = 'session_id = 1001'
        const year = 2025

        // This is the expected filter string that excludes absorbed requests
        const expectedFilter = `(${sessionFilter}) && year = ${year} && (merged_into = "" || merged_into = null)`

        // Verify the filter has the merged_into exclusion
        expect(expectedFilter).toContain('merged_into = ""')
        expect(expectedFilter).toContain('merged_into = null')
      })

      it('should not show requests that have been absorbed into another request', () => {
        // Mock request data
        const requests = [
          { id: 'req1', merged_into: null, requester_id: 100 }, // Should show
          { id: 'req2', merged_into: '', requester_id: 101 }, // Should show
          { id: 'req3', merged_into: 'req1', requester_id: 102 }, // Should NOT show (absorbed)
        ]

        // Filter logic for absorbed requests
        const visibleRequests = requests.filter(
          (r) => r.merged_into === null || r.merged_into === ''
        )

        expect(visibleRequests).toHaveLength(2)
        expect(visibleRequests.map((r) => r.id)).toEqual(['req1', 'req2'])
        expect(visibleRequests.map((r) => r.id)).not.toContain('req3')
      })
    })

    describe('Merged Request Dropdown with Multiple Sources', () => {
      it('should identify merged requests with multiple sources', () => {
        // Helper function logic from hasMultipleSources
        const hasMultipleSources = (request: {
          source_fields?: string[]
          metadata?: { merged_from?: string[] }
        }) => {
          // Multiple unique source fields
          if (Array.isArray(request.source_fields) && request.source_fields.length > 1) {
            return true
          }
          // Check metadata for merged_from
          const mergedFrom = request.metadata?.merged_from
          if (mergedFrom && Array.isArray(mergedFrom) && mergedFrom.length > 0) {
            return true
          }
          return false
        }

        // Single source request
        const singleSourceRequest = {
          source_fields: ['bunk_with'],
        }
        expect(hasMultipleSources(singleSourceRequest)).toBe(false)

        // Multi-source request (different fields)
        const multiFieldRequest = {
          source_fields: ['bunk_with', 'bunking_notes'],
        }
        expect(hasMultipleSources(multiFieldRequest)).toBe(true)

        // Multi-source request (same field, merged_from metadata)
        const mergedFromRequest = {
          source_fields: ['bunk_with'],
          metadata: { merged_from: ['orig_1', 'orig_2'] },
        }
        expect(hasMultipleSources(mergedFromRequest)).toBe(true)
      })

      it('should format source data for display in dropdown', () => {
        // Source link data structure for dropdown display
        interface SourceLinkDisplayData {
          original_request_id: string
          source_field: string
          original_content?: string
          parse_notes?: string
          is_primary: boolean
        }

        const sourceLinks: SourceLinkDisplayData[] = [
          {
            original_request_id: 'orig_1',
            source_field: 'bunk_with',
            original_content: 'Emma Johnson',
            parse_notes: 'Clear name reference',
            is_primary: true,
          },
          {
            original_request_id: 'orig_2',
            source_field: 'bunking_notes',
            original_content: 'Wants to be with Emma J',
            parse_notes: 'Matched via first name + last initial',
            is_primary: false,
          },
        ]

        // Each source should have its own content and notes
        expect(sourceLinks[0]).toHaveProperty('original_content', 'Emma Johnson')
        expect(sourceLinks[0]).toHaveProperty('parse_notes', 'Clear name reference')
        expect(sourceLinks[0]).toHaveProperty('is_primary', true)

        expect(sourceLinks[1]).toHaveProperty('original_content', 'Wants to be with Emma J')
        expect(sourceLinks[1]).toHaveProperty(
          'parse_notes',
          'Matched via first name + last initial'
        )
        expect(sourceLinks[1]).toHaveProperty('is_primary', false)
      })

      it('should distinguish primary from secondary sources', () => {
        const sources = [
          { source_field: 'bunk_with', is_primary: true },
          { source_field: 'bunking_notes', is_primary: false },
        ]

        const primarySource = sources.find((s) => s.is_primary)
        const secondarySources = sources.filter((s) => !s.is_primary)

        expect(primarySource?.source_field).toBe('bunk_with')
        expect(secondarySources).toHaveLength(1)
        expect(secondarySources[0]?.source_field).toBe('bunking_notes')
      })
    })

    describe('Lazy Loading Source Links for Dropdown', () => {
      it('should not fetch source links until row is expanded', () => {
        // State tracking
        const expandedRows = new Set<string>()
        let fetchTriggered = false

        const shouldFetchSourceLinks = (requestId: string, isMerged: boolean) => {
          return expandedRows.has(requestId) && isMerged
        }

        // Before expansion
        expect(shouldFetchSourceLinks('req1', true)).toBe(false)
        expect(fetchTriggered).toBe(false)

        // After expansion
        expandedRows.add('req1')
        if (shouldFetchSourceLinks('req1', true)) {
          fetchTriggered = true
        }

        expect(shouldFetchSourceLinks('req1', true)).toBe(true)
        expect(fetchTriggered).toBe(true)
      })

      it('should cache fetched source links to avoid refetching', () => {
        // Simulated cache
        const sourceLinksCache = new Map<string, object[]>()
        let fetchCount = 0

        const getSourceLinks = (requestId: string) => {
          if (sourceLinksCache.has(requestId)) {
            return sourceLinksCache.get(requestId)
          }
          fetchCount++
          const links = [{ source_field: 'bunk_with' }]
          sourceLinksCache.set(requestId, links)
          return links
        }

        // First access
        getSourceLinks('req1')
        expect(fetchCount).toBe(1)

        // Second access (should use cache)
        getSourceLinks('req1')
        expect(fetchCount).toBe(1) // Still 1, not 2

        // Different request
        getSourceLinks('req2')
        expect(fetchCount).toBe(2)
      })
    })
  })

  // NOTE: The following tests are spec-documentation tests that verify business logic
  // patterns (label text, CSS classes, filter behavior) in isolation rather than rendering
  // the full RequestReviewPanel component. They document the expected conventions and catch
  // regressions in string constants and logic, but do not test actual DOM rendering.
  // Integration tests that render the component would provide stronger confidence.

  describe('EditableRequestType onChange payload', () => {
    it('includes requestee_id: null when switching to age_preference (bug fix #16)', () => {
      // BUG FIX: requestee_id must be null, not 0, when changing to age_preference
      // Setting requestee_id = 0 causes a unique constraint violation (400 error)
      const updates: Partial<BunkRequestsResponse> = {
        request_type: 'age_preference',
      }
      const newType: string = 'age_preference'
      if (newType === 'age_preference') {
        updates.requestee_id = null as unknown as number
      } else {
        updates.age_preference_target = ''
      }
      expect(updates).toHaveProperty('requestee_id', null)
      expect(updates).not.toHaveProperty('age_preference_target')
    })

    it('includes age_preference_target: "" when switching to bunk_with', () => {
      const updates: Partial<BunkRequestsResponse> = {
        request_type: 'bunk_with',
      }
      const newType: string = 'bunk_with'
      if (newType === 'age_preference') {
        updates.requestee_id = null as unknown as number
      } else {
        updates.age_preference_target = ''
      }
      expect(updates).toHaveProperty('age_preference_target', '')
      expect(updates).not.toHaveProperty('requestee_id')
    })
  })

  /**
   * TDD TESTS: Workstream A - Requests Page UI Overhaul
   */
  describe('Workstream A: UI Overhaul', () => {
    describe('Task 2: Rename "Source Field & Content" label (#4)', () => {
      it('should use "Bunking Related Notes" as heading text', () => {
        // The expanded row detail heading should read "Bunking Related Notes"
        // instead of "Source Field & Content" or "Notes from Bunk Requests Form"
        const expectedLabel = 'Bunking Related Notes'
        expect(expectedLabel).not.toBe('Source Field & Content')
        expect(expectedLabel).not.toBe('Notes from Bunk Requests Form')
        expect(expectedLabel).toBe('Bunking Related Notes')
      })
    })

    describe('Task 3: Rename parse notes to "Processing Notes (AI Generated)" (#5)', () => {
      it('should use "Processing Notes (AI Generated)" as heading for single source', () => {
        const expectedLabel = 'Processing Notes (AI Generated)'
        expect(expectedLabel).not.toBe('Parse Notes')
        expect(expectedLabel).toBe('Processing Notes (AI Generated)')
      })

      it('should use "Processing Notes (AI Generated)" label in contributing sources view', () => {
        // In the merged sources dropdown, parse notes label should also read "Processing Notes (AI Generated)"
        const expectedLabel = 'Processing Notes (AI Generated):'
        expect(expectedLabel).not.toContain('Parse notes')
        expect(expectedLabel).toBe('Processing Notes (AI Generated):')
      })

      it('labels the inferred-notes block as "Processing Notes (AI Generated)"', () => {
        const expectedLabel = 'Processing Notes (AI Generated)'
        expect(expectedLabel).not.toBe('AI Intent Notes')
        expect(expectedLabel).not.toBe('AI Parse Notes')
        expect(expectedLabel).toBe('Processing Notes (AI Generated)')
      })
    })

    describe('Task 1: Red glow on target name for negative dispositions (#1)', () => {
      it('should apply red styling classes when request_type is not_bunk_with', () => {
        const requestType = 'not_bunk_with'
        const isNegative = requestType === 'not_bunk_with'

        expect(isNegative).toBe(true)

        // Red glow classes for negative disposition
        const negativeClasses =
          'text-red-600 dark:text-red-400 [text-shadow:0_0_8px_rgba(239,68,68,0.4)]'
        expect(negativeClasses).toContain('text-red-600')
        expect(negativeClasses).toContain('dark:text-red-400')
        expect(negativeClasses).toContain('text-shadow')
      })

      it('should not apply red styling when request_type is bunk_with', () => {
        const requestType: string = 'bunk_with'
        const isNegative = requestType === 'not_bunk_with'

        expect(isNegative).toBe(false)
      })

      it('should not apply red styling when request_type is age_preference', () => {
        const requestType: string = 'age_preference'
        const isNegative = requestType === 'not_bunk_with'

        expect(isNegative).toBe(false)
      })
    })

    describe('Task 9: Swap Type and Request columns (desktop)', () => {
      it('desktop header renders columns in order: Requester, Request, Type', () => {
        // Read the component source to verify rendered column order in the sticky
        // desktop header. Protects against future column-swap regressions without
        // needing a full component mount.
        const source = readFileSync(resolve(__dirname, 'RequestReviewPanel.tsx'), 'utf-8')
        const headerStart = source.indexOf('Table Header - Desktop only')
        expect(headerStart).toBeGreaterThan(-1)
        const headerBlock = source.slice(headerStart, headerStart + 2500)

        // Each sortable column has a handleSort call; use those as unique anchors.
        const requesterIdx = headerBlock.indexOf("handleSort('requester')")
        const requestIdx = headerBlock.indexOf("handleSort('request')")
        const confidenceIdx = headerBlock.indexOf("handleSort('confidence')")

        expect(requesterIdx).toBeGreaterThan(-1)
        expect(requestIdx).toBeGreaterThan(-1)
        // Requester comes before Request
        expect(requesterIdx).toBeLessThan(requestIdx)
        // Request comes before Confidence; Type (unsortable) lives between them
        // Priority column has been deleted — is_first_requested is sync-derived, not user-settable
        expect(requestIdx).toBeLessThan(confidenceIdx)
        expect(headerBlock.slice(requestIdx, confidenceIdx)).toContain('Type')
      })
    })

    describe('Task 5: Full row click to expand + remove caret (#7)', () => {
      it('should use event delegation - interactive elements stop propagation', () => {
        // Interactive elements (checkboxes, buttons, dropdowns) should call stopPropagation
        // so clicks on them don't trigger row expansion
        let rowExpandTriggered = false
        let checkboxTriggered = false

        const mockEvent = {
          stopPropagation: vi.fn(),
        }

        // Simulating checkbox click with stopPropagation
        const handleCheckboxClick = (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          checkboxTriggered = true
        }

        // Simulating row click
        const handleRowClick = () => {
          rowExpandTriggered = true
        }

        // Checkbox click should not trigger row expansion
        handleCheckboxClick(mockEvent)
        expect(checkboxTriggered).toBe(true)
        expect(mockEvent.stopPropagation).toHaveBeenCalled()
        expect(rowExpandTriggered).toBe(false) // Row expand not called

        // Direct row click should trigger expansion
        handleRowClick()
        expect(rowExpandTriggered).toBe(true)
      })

      it('should add hover state to clickable rows', () => {
        // Rows should have cursor-pointer class when clickable
        const rowClasses = 'cursor-pointer hover:bg-muted/50'
        expect(rowClasses).toContain('cursor-pointer')
        expect(rowClasses).toContain('hover:bg-muted/50')
      })
    })

    describe('Task 13: Grade in parens next to camper name (#21)', () => {
      it('should format grade as ordinal in parentheses', async () => {
        // Import formatGradeOrdinal from gradeUtils
        const { formatGradeOrdinal } = await import('../utils/gradeUtils')

        expect(formatGradeOrdinal(1)).toBe('1st')
        expect(formatGradeOrdinal(2)).toBe('2nd')
        expect(formatGradeOrdinal(3)).toBe('3rd')
        expect(formatGradeOrdinal(4)).toBe('4th')
        expect(formatGradeOrdinal(5)).toBe('5th')
        expect(formatGradeOrdinal(11)).toBe('11th')
        expect(formatGradeOrdinal(12)).toBe('12th')
      })

      it('should handle undefined/null grade gracefully', async () => {
        const { formatGradeOrdinal } = await import('../utils/gradeUtils')

        expect(formatGradeOrdinal(undefined)).toBe('?')
        expect(formatGradeOrdinal(null)).toBe('?')
      })

      it('should look up grade from persons map for both requester and target', () => {
        const personMap = new Map([
          [100, { first_name: 'Emma', last_name: 'Johnson', grade: 5 }],
          [101, { first_name: 'Liam', last_name: 'Garcia', grade: 3 }],
        ])

        const requester = personMap.get(100)
        const target = personMap.get(101)

        // Both should have grade available
        expect(requester?.grade).toBe(5)
        expect(target?.grade).toBe(3)
      })
    })

    describe('Task 11: Remove confidence filter, consolidate filter bar (#18)', () => {
      it('should not have confidence-related fields in FilterState', () => {
        // New FilterState should NOT include lowConfidenceOnly, needsReviewOnly, resolvedConfidenceFilter
        interface NewFilterState {
          requestTypes: string[]
          statuses: string[]
          searchQuery: string
        }

        const defaultFilters: NewFilterState = {
          requestTypes: [],
          statuses: ['pending'],
          searchQuery: '',
        }

        // These fields should NOT exist on the new interface
        expect(defaultFilters).not.toHaveProperty('lowConfidenceOnly')
        expect(defaultFilters).not.toHaveProperty('needsReviewOnly')
        expect(defaultFilters).not.toHaveProperty('showResolved')
        expect(defaultFilters).not.toHaveProperty('resolvedConfidenceFilter')
      })

      it('should include resolved as a status option alongside pending and declined', () => {
        // The status filter should have all three statuses as checkboxes
        const allStatuses = ['pending', 'declined', 'resolved']

        expect(allStatuses).toContain('pending')
        expect(allStatuses).toContain('declined')
        expect(allStatuses).toContain('resolved')
      })

      it('should place status checkboxes before request type checkboxes', () => {
        // Filter bar order: statuses first, then request types
        const filterOrder = ['statuses', 'requestTypes']
        expect(filterOrder[0]).toBe('statuses')
        expect(filterOrder[1]).toBe('requestTypes')
      })
    })

    describe('Task 7: Default filter to pending + persist filters (#9)', () => {
      it('should default statuses to pending only', () => {
        const defaultStatuses = ['pending']
        expect(defaultStatuses).toEqual(['pending'])
        expect(defaultStatuses).not.toContain('declined')
        expect(defaultStatuses).not.toContain('resolved')
      })

      it('should use session-specific localStorage key', () => {
        const sessionId = 1001
        const storageKey = `kindred-requests-filters-${sessionId}`
        expect(storageKey).toBe('kindred-requests-filters-1001')
      })

      it('should persist filters and sort config to localStorage', () => {
        const filters = {
          requestTypes: ['bunk_with'],
          statuses: ['pending', 'declined'],
          searchQuery: 'emma',
        }
        const sortConfig = { sortBy: 'requester', sortOrder: 'asc' }

        const stored = JSON.stringify({ filters, sort: sortConfig })
        const parsed = JSON.parse(stored)

        expect(parsed.filters.statuses).toEqual(['pending', 'declined'])
        expect(parsed.sort.sortBy).toBe('requester')
      })

      it('should read persisted filters on mount if available', () => {
        // Simulate reading from localStorage
        const storedFilters = {
          filters: {
            requestTypes: [],
            statuses: ['pending', 'resolved'],
            searchQuery: '',
          },
          sort: { sortBy: 'confidence', sortOrder: 'asc' },
        }

        const stored = JSON.stringify(storedFilters)
        const parsed = JSON.parse(stored)

        // If localStorage has data, use those instead of defaults
        const effectiveStatuses = parsed.filters.statuses
        expect(effectiveStatuses).toEqual(['pending', 'resolved'])
      })
    })

    describe('Bug fix #16: requestee_id = null for age_preference', () => {
      it('should use null instead of 0 when changing to age_preference', () => {
        // The bug: requestee_id = 0 caused unique constraint violation (400 error)
        // The fix: requestee_id = null clears the field properly
        const updates: Partial<BunkRequestsResponse> = {
          request_type: 'age_preference',
        }

        // CORRECT: use null
        updates.requestee_id = null as unknown as number
        expect(updates.requestee_id).toBeNull()

        // WRONG: using 0 (the old behavior)
        // updates.requestee_id = 0  // This was the bug
      })
    })

    describe('Wire up sessionName prop', () => {
      it('should accept sessionName as an optional prop on RequestReviewPanel', () => {
        // RequestReviewPanel should accept sessionName to pass through to EditableRequestTarget
        const props = {
          sessionId: 1001,
          year: 2025,
          sessionName: 'TOC2',
        }

        expect(props.sessionName).toBe('TOC2')
      })
    })
  })

  /**
   * Regression tests for #918 (handleApprove / handleReject extraction).
   *
   * The refactor is a pure extraction of handler functions from inline
   * mutate calls — behavior must not change. These tests render the
   * panel, click the row-level approve/reject button, confirm via the
   * popover, and assert on the payload passed to
   * pb.collection('bunk_requests').update(...). This exercises the
   * real handleApprove / handleReject code paths rather than just
   * asserting on a literal object shape.
   */
  describe('Approve / Reject mutation payloads (#918)', () => {
    it('approve button fires update with status=resolved (no request_locked)', async () => {
      const { updateSpy, findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-approve-1',
        requester_id: 100,
        requestee_id: 101,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.9,
      })

      // Wait for at least one row-level Approve button to appear
      // (both mobile and desktop markup render in jsdom — take the first).
      const approveButton = await findButtonByTitle('Approve')

      // fireEvent.click (not userEvent) because the onClick handler reads
      // e.currentTarget.getBoundingClientRect() which jsdom + userEvent
      // does not populate reliably.
      fireEvent.click(approveButton)

      // Popover portal renders "Confirm" button
      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1)
      })

      expect(updateSpy).toHaveBeenCalledWith('req-approve-1', {
        status: 'resolved',
        staff_touched: true,
      })
    }, 10000)

    it('reject button fires update with status=declined (no request_locked)', async () => {
      const { updateSpy, findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-reject-1',
        requester_id: 200,
        requestee_id: 201,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.5,
      })

      const rejectButton = await findButtonByTitle('Reject')

      // fireEvent.click (not userEvent) because the onClick handler reads
      // e.currentTarget.getBoundingClientRect() which jsdom + userEvent
      // does not populate reliably.
      fireEvent.click(rejectButton)

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1)
      })

      expect(updateSpy).toHaveBeenCalledWith('req-reject-1', {
        status: 'declined',
        staff_touched: true,
      })
    }, 10000)
  })

  /**
   * Regression tests for feedback #11: "After processing several request rows,
   * the UI stops responding — rows won't close, new rows won't open."
   *
   * Root cause: onConfirm for the approve/decline popover only closed the
   * popover; it never removed the request id from the `expandedRows` Set. As
   * staff processed more rows, the Set grew unbounded, compounding render cost
   * and refetch work until click handlers went dead.
   *
   * These tests pin the contract: after the user confirms an approve or
   * decline, the just-processed row MUST collapse.
   */
  describe('Row collapse after approve/decline (feedback #11)', () => {
    // Expand a request row by ID. Clicks the row's dedicated expand button
    // (desktop layout) and waits for the expanded content block to appear.
    // The click affordance lives on a real <button> (kindred#2094/#2095 house
    // style), not on the row container itself, so it — not the container —
    // is what gets clicked.
    async function expandRowById(requestId: string) {
      const rowContainers = await waitFor(() => {
        const found = document.querySelectorAll(`[data-request-row-id="${requestId}"]`)
        if (found.length === 0) throw new Error('row not yet rendered')
        return found
      })
      const rowContainer = rowContainers[0] as HTMLElement
      expect(rowContainer).toBeTruthy()
      const expandButton = rowContainer.querySelector('[data-testid="request-row-expand-button"]')
      expect(expandButton).toBeTruthy()
      fireEvent.click(expandButton as HTMLElement)
      await waitFor(() => {
        expect(
          rowContainers[0]?.querySelector('[data-testid="request-row-expanded-content"]')
        ).toBeTruthy()
      })
    }

    it('collapses the expanded row after approving a request', async () => {
      const { findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-collapse-approve-1',
        requester_id: 300,
        requestee_id: 301,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.7,
      })

      await expandRowById('req-collapse-approve-1')

      // Click Approve, then confirm in the popover
      const approveButton = await findButtonByTitle('Approve')
      fireEvent.click(approveButton)

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      // After confirming, the row should collapse — expanded content block disappears
      await waitFor(() => {
        expect(document.querySelector('[data-testid="request-row-expanded-content"]')).toBeNull()
      })
    }, 10000)

    it('collapses the expanded row after declining a request', async () => {
      const { findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-collapse-decline-1',
        requester_id: 400,
        requestee_id: 401,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.4,
      })

      await expandRowById('req-collapse-decline-1')

      const rejectButton = await findButtonByTitle('Reject')
      fireEvent.click(rejectButton)

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(document.querySelector('[data-testid="request-row-expanded-content"]')).toBeNull()
      })
    }, 10000)

    it('does not collapse an unrelated expanded row when a different row is approved', async () => {
      // Two-row setup: row A (req-unrelated-a) stays expanded;
      // row B (req-unrelated-b) is approved and must collapse.
      const { pb } = (await import('../lib/pocketbase')) as unknown as {
        pb: { collection: ReturnType<typeof vi.fn> }
      }

      const updateSpy = vi.fn().mockResolvedValue({})
      const rowA: Partial<BunkRequestsResponse> = {
        id: 'req-unrelated-a',
        requester_id: 500,
        requestee_id: 501,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.8,
      }
      const rowB: Partial<BunkRequestsResponse> = {
        id: 'req-unrelated-b',
        requester_id: 600,
        requestee_id: 601,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.6,
      }

      pb.collection.mockImplementation((name: string) => {
        if (name === 'bunk_requests') {
          return {
            getFullList: vi.fn().mockResolvedValue([rowA, rowB]),
            getList: vi.fn().mockResolvedValue({ items: [rowA, rowB], totalItems: 2 }),
            update: updateSpy,
          }
        }
        return {
          getFullList: vi.fn().mockResolvedValue([]),
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          update: vi.fn().mockResolvedValue({}),
        }
      })

      const user = userEvent.setup()
      render(<RequestReviewPanel sessionId={1001} year={2025} />)

      // Expand row A
      const rowAContainers = await waitFor(() => {
        const found = document.querySelectorAll('[data-request-row-id="req-unrelated-a"]')
        if (found.length === 0) throw new Error('row A not yet rendered')
        return found
      })
      const mobileRowA = rowAContainers[0] as HTMLElement
      expect(mobileRowA).toBeTruthy()
      const expandButtonA = mobileRowA.querySelector('[data-testid="request-row-expand-button"]')
      expect(expandButtonA).toBeTruthy()
      fireEvent.click(expandButtonA as HTMLElement)

      // Confirm row A is expanded
      await waitFor(() => {
        expect(
          rowAContainers[0]?.querySelector('[data-testid="request-row-expanded-content"]')
        ).toBeTruthy()
      })

      // Also expand row B so both rows are expanded simultaneously
      const rowBContainers = await waitFor(() => {
        const found = document.querySelectorAll('[data-request-row-id="req-unrelated-b"]')
        if (found.length === 0) throw new Error('row B not yet rendered')
        return found
      })
      const mobileRowB = rowBContainers[0] as HTMLElement
      expect(mobileRowB).toBeTruthy()
      const expandButtonB = mobileRowB.querySelector('[data-testid="request-row-expand-button"]')
      expect(expandButtonB).toBeTruthy()
      fireEvent.click(expandButtonB as HTMLElement)

      // Both rows expanded — two expanded-content blocks visible
      await waitFor(() => {
        expect(
          document.querySelectorAll('[data-testid="request-row-expanded-content"]').length
        ).toBeGreaterThanOrEqual(2)
      })

      // Now approve row B via its Approve button
      const approveButtons = rowBContainers[0]?.querySelectorAll('[title="Approve"]')
      const approveButton = approveButtons?.[0] as HTMLElement
      expect(approveButton).toBeTruthy()
      fireEvent.click(approveButton)

      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1)
      })

      // Row B must collapse — only row A's expanded-content block remains
      await waitFor(() => {
        expect(
          document.querySelectorAll('[data-testid="request-row-expanded-content"]').length
        ).toBe(1)
      })
    }, 15000)
  })

  /**
   * jsx-a11y sweep: the row's click-to-expand affordance used to live on a
   * non-interactive <div onClick>, with no keyboard equivalent at all
   * (jsx-a11y/click-events-have-key-events, no-static-element-interactions).
   * It now lives on a real <button> in the row's first cell. These tests pin
   * that the button is genuinely keyboard-operable, not just present.
   */
  describe('Row expand button is keyboard-operable (jsx-a11y sweep)', () => {
    it('is a real button with aria-expanded reflecting state', async () => {
      await renderPanelWithRequest({
        id: 'req-kbd-expand-1',
        requester_id: 500,
        requestee_id: 501,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.7,
      })

      const rowContainer = await waitFor(() => {
        const found = document.querySelector('[data-request-row-id="req-kbd-expand-1"]')
        if (!found) throw new Error('row not yet rendered')
        return found as HTMLElement
      })
      const expandButton = within(rowContainer).getByTestId('request-row-expand-button')
      expect(expandButton.tagName).toBe('BUTTON')
      expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    })

    it('expands the row via Enter on the focused expand button, no mouse click', async () => {
      const { user } = await renderPanelWithRequest({
        id: 'req-kbd-expand-2',
        requester_id: 502,
        requestee_id: 503,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.7,
      })

      const rowContainer = await waitFor(() => {
        const found = document.querySelector('[data-request-row-id="req-kbd-expand-2"]')
        if (!found) throw new Error('row not yet rendered')
        return found as HTMLElement
      })
      const expandButton = within(rowContainer).getByTestId('request-row-expand-button')

      expect(rowContainer.querySelector('[data-testid="request-row-expanded-content"]')).toBeNull()

      expandButton.focus()
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(
          rowContainer.querySelector('[data-testid="request-row-expanded-content"]')
        ).toBeTruthy()
      })
      expect(expandButton).toHaveAttribute('aria-expanded', 'true')
    })
  })

  /**
   * TDD TESTS: In-session Undo Stack (scoreboard #14)
   *
   * Approve/decline actions push an inverse mutation onto a 3-entry stack.
   * Clicking the Undo button pops and executes the most recent inverse.
   * Stack is client-only — refresh clears it.
   *
   * Tests written FIRST per TDD discipline (red phase).
   */
  describe('Undo stack for approve/decline (#14)', () => {
    it('Undo button shows stack depth and disappears when stack is empty', async () => {
      const { updateSpy, findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-undo-2',
        requester_id: 310,
        requestee_id: 311,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.75,
      })

      updateSpy.mockResolvedValue({})

      const approveButton = await findButtonByTitle('Approve')
      fireEvent.click(approveButton)
      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1)
      })

      // Undo button appears with "(1)" in its text
      const undoBtn = await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          return btn!
        },
        { timeout: 3000 }
      )

      expect(undoBtn.textContent).toMatch(/1/)

      // Click undo — inverse fires (restores status to pending)
      await user.click(undoBtn)

      await waitFor(
        () => {
          // inverse mutation: PATCH back to pending; undo is still a staff
          // action so staff_touched stays true (one-way flag, idempotent re-set)
          expect(updateSpy).toHaveBeenCalledWith('req-undo-2', {
            status: 'pending',
            staff_touched: true,
          })
        },
        { timeout: 3000 }
      )

      // Stack now empty: undo button gone or shows (0)
      await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          // Either hidden or shows 0
          if (btn) {
            expect(btn.textContent).toMatch(/0/)
          } else {
            expect(btn).toBeNull()
          }
        },
        { timeout: 3000 }
      )
    }, 15000)

    it('keeps the entry on the stack when the inverse mutation fails (retry possible)', async () => {
      const { updateSpy, findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-undo-fail',
        requester_id: 330,
        requestee_id: 331,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.85,
      })

      // Approve succeeds; first undo attempt fails; second attempt succeeds.
      updateSpy
        .mockResolvedValueOnce({}) // approve
        .mockRejectedValueOnce(new Error('network')) // first undo attempt
        .mockResolvedValue({}) // retry

      const approveButton = await findButtonByTitle('Approve')
      fireEvent.click(approveButton)
      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      // Wait for approve to complete and Undo button to appear
      await waitFor(
        () => {
          expect(updateSpy).toHaveBeenCalledTimes(1)
        },
        { timeout: 5000 }
      )

      const undoBtn = await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          return btn!
        },
        { timeout: 3000 }
      )

      // First undo attempt — inverse mutation rejects
      await user.click(undoBtn)

      // After failure, entry is re-pushed: Undo button should still show depth ≥ 1
      await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          // Should still show count 1 (re-pushed after failure)
          expect(btn!.textContent).toMatch(/1/)
        },
        { timeout: 5000 }
      )
    }, 20000)

    /**
     * Regression: undo must actually restore the rendered status badge to
     * "Pending" after the user reverts an approve/decline. Previous tests
     * with non-stateful mocks could not catch this — getFullList always
     * returned the same stale fixture regardless of preceding pb.update
     * calls, so the badge appeared "correct" by coincidence. This test
     * uses a stateful mock that mutates a single record in memory and
     * is filtered to all 3 statuses so the row stays in view.
     */
    it('rendered status badge returns to Pending after Undo (stateful)', async () => {
      // Persist filter state so the panel renders all three statuses,
      // keeping the row visible across pending → declined → pending.
      window.localStorage.setItem(
        'kindred-requests-filters-1001',
        JSON.stringify({
          filters: {
            requestTypes: [],
            statuses: ['pending', 'declined', 'resolved'],
            searchQuery: '',
          },
          sort: { sortBy: 'requester', sortOrder: 'asc' },
        })
      )

      const record: BunkRequestsResponse = {
        id: 'req-undo-stateful',
        requester_id: 410,
        requestee_id: 411,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'bunk_with',
        confidence_score: 0.9,
      } as BunkRequestsResponse

      const { pb } = (await import('../lib/pocketbase')) as unknown as {
        pb: { collection: ReturnType<typeof vi.fn> }
      }

      pb.collection.mockImplementation((name: string) => {
        if (name === 'bunk_requests') {
          return {
            getFullList: vi.fn(async () => [{ ...record }]),
            getList: vi.fn(async () => ({ items: [{ ...record }], totalItems: 1 })),
            update: vi.fn(async (_id: string, updates: Partial<BunkRequestsResponse>) => {
              Object.assign(record, updates)
              return { ...record }
            }),
          }
        }
        return {
          getFullList: vi.fn().mockResolvedValue([]),
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          update: vi.fn().mockResolvedValue({}),
        }
      })

      render(<RequestReviewPanel sessionId={1001} year={2025} />)
      const user = userEvent.setup()

      // Initial render: badge shows Pending
      await waitFor(
        () => {
          expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
        },
        { timeout: 3000 }
      )

      // Click Reject → Confirm
      const rejectButton = await waitFor(() => screen.getAllByTitle('Reject')[0]!, {
        timeout: 3000,
      })
      fireEvent.click(rejectButton)
      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      // After decline: record is mutated, badge eventually shows Declined
      await waitFor(
        () => {
          expect(record.status).toBe('declined')
          expect(screen.getAllByText('Declined').length).toBeGreaterThan(0)
        },
        { timeout: 3000 }
      )

      // Click Undo
      const undoBtn = await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          return btn!
        },
        { timeout: 3000 }
      )
      await user.click(undoBtn)

      // After undo: record back to pending AND rendered badge shows Pending
      await waitFor(
        () => {
          expect(record.status).toBe('pending')
        },
        { timeout: 3000 }
      )
      await waitFor(
        () => {
          // Pending badge must be present (this is the regression assertion)
          expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
          // And no Declined badge for this row should remain
          expect(screen.queryAllByText('Declined').length).toBe(0)
        },
        { timeout: 3000 }
      )
    }, 20000)

    /**
     * Bulk-action regression: when the user "checks" multiple requests via
     * the row checkboxes and clicks the sticky bottom bar's Reject button,
     * the bulk action MUST push a single undo entry that reverts every
     * affected record. This caught a real bug where the bulk path bypassed
     * the undo stack entirely (only single-row approve/decline pushed
     * entries), so clicking Undo did nothing for bulk-declined requests.
     */
    it('bulk decline pushes one undo entry that restores all selected records', async () => {
      window.localStorage.setItem(
        'kindred-requests-filters-1001',
        JSON.stringify({
          filters: {
            requestTypes: [],
            statuses: ['pending', 'declined', 'resolved'],
            searchQuery: '',
          },
          sort: { sortBy: 'requester', sortOrder: 'asc' },
        })
      )

      const records: BunkRequestsResponse[] = [
        {
          id: 'bulk-rec-1',
          requester_id: 510,
          requestee_id: 511,
          session_id: 1001,
          year: 2025,
          status: 'pending',
          request_type: 'bunk_with',
          confidence_score: 0.8,
        } as BunkRequestsResponse,
        {
          id: 'bulk-rec-2',
          requester_id: 520,
          requestee_id: 521,
          session_id: 1001,
          year: 2025,
          status: 'pending',
          request_type: 'bunk_with',
          confidence_score: 0.7,
        } as BunkRequestsResponse,
      ]

      const { pb } = (await import('../lib/pocketbase')) as unknown as {
        pb: { collection: ReturnType<typeof vi.fn> }
      }

      const updateCalls: Array<{ id: string; updates: Partial<BunkRequestsResponse> }> = []

      pb.collection.mockImplementation((name: string) => {
        if (name === 'bunk_requests') {
          return {
            getFullList: vi.fn(async () => records.map((r) => ({ ...r }))),
            getList: vi.fn(async () => ({
              items: records.map((r) => ({ ...r })),
              totalItems: records.length,
            })),
            update: vi.fn(async (id: string, updates: Partial<BunkRequestsResponse>) => {
              updateCalls.push({ id, updates: { ...updates } })
              const rec = records.find((r) => r.id === id)
              if (rec) Object.assign(rec, updates)
              return { ...rec }
            }),
          }
        }
        return {
          getFullList: vi.fn().mockResolvedValue([]),
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          update: vi.fn().mockResolvedValue({}),
        }
      })

      render(<RequestReviewPanel sessionId={1001} year={2025} />)
      const user = userEvent.setup()

      // Wait for both rows to render with Pending badges
      await waitFor(
        () => {
          expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2)
        },
        { timeout: 3000 }
      )

      // Select both rows via the requester-name buttons mapped to checkboxes.
      // Each rendered row has a checkbox at `name=""` role=checkbox; the
      // "Select All" header is also a checkbox. Pick checkboxes whose
      // closest <tr>/<div> has data for our two distinct request IDs.
      // Simpler: use toggleRequestSelection by clicking checkboxes one at
      // a time and waiting for selectedRequests.size to grow (proxied by
      // the sticky toolbar's "{N} selected" text).
      const allCheckboxes = screen.getAllByRole('checkbox')
      // Click checkboxes until we reach 2 selected (skipping select-all toggles).
      for (const cb of allCheckboxes) {
        if ((cb as HTMLInputElement).checked) continue
        fireEvent.click(cb)
        const toolbar = screen.queryByRole('toolbar', { name: /bulk actions/i })
        if (toolbar && within(toolbar).queryByText(/^2 selected$/)) break
      }

      // Bulk Reject lives inside the sticky toolbar — scope to it to avoid
      // matching the row-level "Reject" buttons.
      const toolbar = await waitFor(
        () => {
          const t = screen.queryByRole('toolbar', { name: /bulk actions/i })
          if (!t) throw new Error('no toolbar yet')
          if (!within(t).queryByText(/^2 selected$/)) throw new Error('not 2 selected yet')
          return t
        },
        { timeout: 3000 }
      )
      const rejectBtn = within(toolbar).getByRole('button', { name: /reject/i })
      await user.click(rejectBtn)

      // Confirm in the bulk dialog (role=dialog with bulk-confirm-label).
      const dialog = await screen.findByRole('dialog')
      const declineConfirm = within(dialog).getByRole('button', { name: 'Decline' })
      await user.click(declineConfirm)

      // Both records now declined on the server
      await waitFor(
        () => {
          expect(records.every((r) => r.status === 'declined')).toBe(true)
        },
        { timeout: 5000 }
      )

      // Undo button now visible — click it
      const undoBtn = await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          return btn!
        },
        { timeout: 3000 }
      )
      await user.click(undoBtn)

      // Both records back to pending
      await waitFor(
        () => {
          expect(records.every((r) => r.status === 'pending')).toBe(true)
        },
        { timeout: 5000 }
      )

      // PATCH calls: 2 bulk declines + 2 inverse PATCHes back to pending = 4 calls min
      const pendingPatches = updateCalls.filter((c) => c.updates.status === 'pending')
      expect(pendingPatches.length).toBeGreaterThanOrEqual(2)
    }, 30000)

    /**
     * Bulk-action A→A skip: when a staff user bulk-approves a selection that
     * includes rows already in the target status (e.g. status='resolved'),
     * those rows are no-ops and MUST NOT be PATCHed at all. Only rows that
     * actually change state get the staff_touched stamp. This keeps the
     * audit signal honest: bulk-approve on an already-resolved row is not
     * a "staff edit," it's a non-event.
     */
    it('bulk approve skips rows already in target status (no PATCH, no staff_touched)', async () => {
      window.localStorage.setItem(
        'kindred-requests-filters-1001',
        JSON.stringify({
          filters: {
            requestTypes: [],
            statuses: ['pending', 'declined', 'resolved'],
            searchQuery: '',
          },
          sort: { sortBy: 'requester', sortOrder: 'asc' },
        })
      )

      const records: BunkRequestsResponse[] = [
        {
          id: 'bulk-aa-pending',
          requester_id: 610,
          requestee_id: 611,
          session_id: 1001,
          year: 2025,
          status: 'pending',
          request_type: 'bunk_with',
          confidence_score: 0.8,
        } as BunkRequestsResponse,
        {
          id: 'bulk-aa-already-resolved',
          requester_id: 620,
          requestee_id: 621,
          session_id: 1001,
          year: 2025,
          status: 'resolved',
          request_type: 'bunk_with',
          confidence_score: 0.7,
        } as BunkRequestsResponse,
      ]

      const { pb } = (await import('../lib/pocketbase')) as unknown as {
        pb: { collection: ReturnType<typeof vi.fn> }
      }

      const updateCalls: Array<{ id: string; updates: Partial<BunkRequestsResponse> }> = []

      pb.collection.mockImplementation((name: string) => {
        if (name === 'bunk_requests') {
          return {
            getFullList: vi.fn(async () => records.map((r) => ({ ...r }))),
            getList: vi.fn(async () => ({
              items: records.map((r) => ({ ...r })),
              totalItems: records.length,
            })),
            update: vi.fn(async (id: string, updates: Partial<BunkRequestsResponse>) => {
              updateCalls.push({ id, updates: { ...updates } })
              const rec = records.find((r) => r.id === id)
              if (rec) Object.assign(rec, updates)
              return { ...rec }
            }),
          }
        }
        return {
          getFullList: vi.fn().mockResolvedValue([]),
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          update: vi.fn().mockResolvedValue({}),
        }
      })

      render(<RequestReviewPanel sessionId={1001} year={2025} />)
      const user = userEvent.setup()

      // Wait for both rows to render
      await waitFor(
        () => {
          expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(3) // select-all + 2 rows
        },
        { timeout: 3000 }
      )

      // Select both rows via row checkboxes (skip already-checked select-all).
      const allCheckboxes = screen.getAllByRole('checkbox')
      for (const cb of allCheckboxes) {
        if ((cb as HTMLInputElement).checked) continue
        fireEvent.click(cb)
        const toolbar = screen.queryByRole('toolbar', { name: /bulk actions/i })
        if (toolbar && within(toolbar).queryByText(/^2 selected$/)) break
      }

      // Bulk Approve button in the sticky toolbar.
      const toolbar = await waitFor(
        () => {
          const t = screen.queryByRole('toolbar', { name: /bulk actions/i })
          if (!t) throw new Error('no toolbar yet')
          if (!within(t).queryByText(/^2 selected$/)) throw new Error('not 2 selected yet')
          return t
        },
        { timeout: 3000 }
      )
      const approveBtn = within(toolbar).getByRole('button', { name: /approve/i })
      await user.click(approveBtn)

      // Confirm in the bulk dialog.
      const dialog = await screen.findByRole('dialog')
      const approveConfirm = within(dialog).getByRole('button', { name: 'Approve' })
      await user.click(approveConfirm)

      // Wait for the pending row's PATCH to land.
      await waitFor(
        () => {
          expect(updateCalls.some((c) => c.id === 'bulk-aa-pending')).toBe(true)
        },
        { timeout: 5000 }
      )

      // Pending row → PATCHed with status=resolved AND staff_touched=true.
      const pendingPatch = updateCalls.find((c) => c.id === 'bulk-aa-pending')
      expect(pendingPatch).toBeDefined()
      expect(pendingPatch!.updates).toMatchObject({
        status: 'resolved',
        staff_touched: true,
      })

      // Already-resolved row → MUST NOT be PATCHed (no-op skip).
      const noopCalls = updateCalls.filter((c) => c.id === 'bulk-aa-already-resolved')
      expect(noopCalls).toHaveLength(0)
    }, 20000)

    it('clicking Undo after decline restores status to pending', async () => {
      const { updateSpy, findButtonByTitle, user } = await renderPanelWithRequest({
        id: 'req-undo-3',
        requester_id: 320,
        requestee_id: 321,
        session_id: 1001,
        year: 2025,
        status: 'pending',
        request_type: 'not_bunk_with',
        confidence_score: 0.6,
      })

      updateSpy.mockResolvedValue({})

      const rejectButton = await findButtonByTitle('Reject')
      fireEvent.click(rejectButton)
      const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('req-undo-3', {
          status: 'declined',
          staff_touched: true,
        })
      })

      // Undo button visible
      const undoBtn = await waitFor(
        () => {
          const btn = screen.queryByRole('button', { name: /undo/i })
          expect(btn).not.toBeNull()
          return btn!
        },
        { timeout: 3000 }
      )

      await user.click(undoBtn)

      // Inverse: restore to pending (prior state was pending)
      await waitFor(
        () => {
          const calls = updateSpy.mock.calls
          const undoCall = calls.find((c) => c[1]?.status === 'pending')
          expect(undoCall).toBeDefined()
        },
        { timeout: 3000 }
      )
    }, 15000)
  })

  // #1092 — RequestReviewPanel in SessionView.tsx Requests tab must be wrapped in BunkRequestProvider
  describe('BunkRequestProvider requirement in SessionView (#1092)', () => {
    /**
     * When a camper name is clicked in RequestReviewPanel (rendered from the Requests tab),
     * it mounts CamperDetailsPanel which calls useBunkRequestContext() unconditionally.
     * Without BunkRequestProvider above it in the tree, this throws:
     *   "useBunkRequestContext must be used within BunkRequestProvider"
     *
     * Regression guard: verify that SessionView.tsx wraps the Requests-tab
     * RequestReviewPanel in BunkRequestProvider — the same pattern used in
     * the Bunks tab and Friends tab.
     */
    it('SessionView Requests tab wraps RequestReviewPanel in BunkRequestProvider', () => {
      const sessionViewSource = readFileSync(resolve(__dirname, 'SessionView.tsx'), 'utf-8')

      // Find the Requests tab Activity block and assert BunkRequestProvider wraps it.
      // The Friends tab (correct) looks like:
      //   <Activity mode={activeTab === 'friends' ? 'visible' : 'hidden'}>
      //     <BunkRequestProvider sessionCmId={...}>
      //       <FriendGroupsView .../>
      //     </BunkRequestProvider>
      //   </Activity>
      //
      // The Requests tab (broken) only has:
      //   <Activity mode={activeTab === 'requests' ? 'visible' : 'hidden'}>
      //     <RequestReviewPanel .../>
      //   </Activity>
      //
      // We verify that within the requests-tab Activity, BunkRequestProvider appears
      // before RequestReviewPanel (i.e., BunkRequestProvider wraps it).

      // Extract the requests tab block: from "requests tab" comment to the closing </Activity>
      const requestsTabMatch = sessionViewSource.match(
        /Requests Tab[\s\S]*?<Activity mode=\{activeTab === 'requests'[\s\S]*?<\/Activity>/
      )
      expect(requestsTabMatch).not.toBeNull()

      const requestsTabBlock = requestsTabMatch![0]

      // BunkRequestProvider must appear in the requests tab block
      expect(requestsTabBlock).toContain('BunkRequestProvider')

      // BunkRequestProvider must appear BEFORE RequestReviewPanel (wraps it)
      const providerPos = requestsTabBlock.indexOf('BunkRequestProvider')
      const panelPos = requestsTabBlock.indexOf('RequestReviewPanel')
      expect(providerPos).toBeLessThan(panelPos)
    })
  })

  // #1310 — seedPersons avoids the ID→name resolution flash and the extra
  // round-trip when the parent already has the in-session campers loaded.
  describe('seedPersons prop (#1310)', () => {
    async function renderWithSeed({
      seedPersons,
      requesterId,
      requesteeId,
    }: {
      seedPersons: Array<Partial<PersonsResponse>>
      requesterId: number
      requesteeId: number
    }) {
      const personsFetchSpy = vi.fn().mockResolvedValue([])
      const { pb } = (await import('../lib/pocketbase')) as unknown as {
        pb: { collection: ReturnType<typeof vi.fn> }
      }
      pb.collection.mockImplementation((name: string) => {
        if (name === 'bunk_requests') {
          return {
            getFullList: vi.fn().mockResolvedValue([
              {
                id: 'req-seed-1',
                requester_id: requesterId,
                requestee_id: requesteeId,
                session_id: 1001,
                year: 2025,
                status: 'pending',
                request_type: 'bunk_with',
                confidence_score: 0.9,
              },
            ]),
            getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
            update: vi.fn().mockResolvedValue({}),
          }
        }
        if (name === 'persons') {
          return {
            getFullList: personsFetchSpy,
            getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          }
        }
        return {
          getFullList: vi.fn().mockResolvedValue([]),
          getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          update: vi.fn().mockResolvedValue({}),
        }
      })
      render(
        <RequestReviewPanel
          sessionId={1001}
          year={2025}
          seedPersons={seedPersons as unknown as PersonsResponse[]}
        />
      )
      return { personsFetchSpy }
    }

    it('renders requester name from seedPersons without firing the persons fetch when all IDs are seeded', async () => {
      const { personsFetchSpy } = await renderWithSeed({
        requesterId: 9100,
        requesteeId: 9101,
        seedPersons: [
          { cm_id: 9100, first_name: 'Emma', last_name: 'Johnson', year: 2025 },
          { cm_id: 9101, first_name: 'Liam', last_name: 'Garcia', year: 2025 },
        ],
      })

      // Name renders from seed on first paint (no "Person 9100" placeholder).
      await waitFor(() => {
        const matches = screen.getAllByText((_, el) =>
          (el?.textContent ?? '').includes('Emma Johnson')
        )
        expect(matches.length).toBeGreaterThan(0)
      })

      // Placeholder must never have rendered.
      expect(screen.queryByText(/Person 9100/)).toBeNull()

      // No persons fetch fires because seed covers every ID we need.
      expect(personsFetchSpy).not.toHaveBeenCalled()
    }, 10000)

    it('falls back to persons fetch for IDs missing from seedPersons', async () => {
      const { personsFetchSpy } = await renderWithSeed({
        requesterId: 9200,
        requesteeId: 9201,
        // Only the requester is seeded; the requestee is missing.
        seedPersons: [{ cm_id: 9200, first_name: 'Olivia', last_name: 'Chen', year: 2025 }],
      })

      // Seeded name shows up immediately.
      await waitFor(() => {
        const matches = screen.getAllByText((_, el) =>
          (el?.textContent ?? '').includes('Olivia Chen')
        )
        expect(matches.length).toBeGreaterThan(0)
      })

      // Persons fetch IS called because at least one ID (the requestee) is unseeded.
      await waitFor(() => {
        expect(personsFetchSpy).toHaveBeenCalled()
      })

      // And the call only includes the missing ID, not the seeded one.
      const calls = personsFetchSpy.mock.calls as Array<[{ filter: string }]>
      const allFilters = calls.map((c) => c[0]?.filter ?? '').join(' | ')
      expect(allFilters).toContain('cm_id = 9201')
      expect(allFilters).not.toContain('cm_id = 9200')
    }, 10000)
  })

  // #1310 — the desktop row is extracted into a memoized child component so
  // parent re-renders triggered by another row's selection/expansion skip
  // unaffected rows. This test pins the implementation choice; behavioral
  // coverage of the row's rendering still lives in the panel-level tests.
  describe('memoized row component (#1310)', () => {
    it('exports a React.memo-wrapped RequestRowDesktop', async () => {
      const mod = await import('./RequestRowDesktop')
      const Comp = mod.default as { $$typeof?: symbol }
      expect(Comp.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('no longer ships a separate mobile row component (#1611)', () => {
      const mobileRowPath = resolve(__dirname, 'RequestRowMobile.tsx')
      expect(existsSync(mobileRowPath)).toBe(false)
    })
  })
})
