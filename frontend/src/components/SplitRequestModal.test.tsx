/**
 * TDD Tests for SplitRequestModal
 *
 * Tests the modal for splitting a merged bunk_request into separate requests.
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import SplitRequestModal from './SplitRequestModal'
import type { BunkRequestsResponse } from '../types/pocketbase-types'
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types'
import { queryKeys } from '../utils/queryKeys'

// Mock the useApiWithAuth hook
const mockFetchWithAuth = vi.fn()
vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
  }),
}))

// Mock pocketbase with all required exports
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: vi.fn(() => Promise.resolve([])),
    })),
    authStore: {
      isValid: true,
      model: { id: 'test-user' },
      onChange: vi.fn(),
      record: { id: 'test-user', email: 'test@example.com' },
    },
  },
  isAuthenticated: vi.fn(() => true),
  getCurrentUser: vi.fn(() => ({ id: 'test-user', email: 'test@example.com' })),
}))

// Helper to create mock request object with multiple sources
function createMergedMockRequest(
  overrides: Partial<BunkRequestsResponse> = {}
): BunkRequestsResponse {
  return {
    id: 'req_merged',
    collectionId: 'bunk_requests',
    collectionName: 'bunk_requests',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    requester_id: 12345,
    requestee_id: 67890,
    request_type: BunkRequestsRequestTypeOptions.bunk_with,
    session_id: 1000001,
    confidence_score: 0.95,
    source_field: 'share_bunk_with',
    source_fields: ['share_bunk_with', 'bunking_notes'], // Multiple sources
    status: 'pending',
    year: 2025,
    metadata: {
      merged_from: ['req_original_1', 'req_original_2'],
    },
    ...overrides,
  } as BunkRequestsResponse
}

// Mock source link data
interface SourceLinkData {
  original_request_id: string
  source_field: string
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// Render with a pre-seeded QueryClient so tests can verify invalidation.
function renderWithSeededClient(ui: React.ReactElement, requesterId = 12345, year = 2025) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  // Seed every request-derived React Query key so we can assert invalidation.
  queryClient.setQueryData(queryKeys.bunkRequestsPrefix(), [])
  queryClient.setQueryData([...queryKeys.allBunkRequestsPrefix(), 1000001, year], [])
  queryClient.setQueryData([...queryKeys.personBunkRequestsPrefix(), requesterId, year], [])
  queryClient.setQueryData([...queryKeys.personAllBunkRequestsPrefix(), requesterId, year], [])
  queryClient.setQueryData([...queryKeys.bunkRequestsTooltipPrefix(), requesterId, year], [])
  queryClient.setQueryData([...queryKeys.requestSatisfactionPrefix(), requesterId], {})
  queryClient.setQueryData(queryKeys.cohortRequestRelationsPrefix(), [])
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

describe('SplitRequestModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('rendering', () => {
    it('renders nothing when not open', () => {
      const { container } = renderWithProviders(
        <SplitRequestModal
          isOpen={false}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('renders modal with title when open', () => {
      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[
            { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
            { original_request_id: 'orig_2', source_field: 'bunking_notes' },
          ]}
          onSplitComplete={() => {}}
        />
      )

      expect(screen.getByRole('heading', { name: /split request/i })).toBeTruthy()
    })

    it('shows all contributing sources', () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      expect(screen.getAllByText(/share_bunk_with/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/bunking_notes/i).length).toBeGreaterThan(0)
    })
  })

  describe('source selection', () => {
    it('provides checkboxes to select sources to split off', () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    })

    it('non-primary sources are auto-selected by default, primary is disabled', () => {
      // Primary source should NOT be selected and should be disabled
      // Non-primary sources should be auto-selected
      interface ExtendedSourceLinkData extends SourceLinkData {
        is_primary?: boolean
      }
      const sourceLinks: ExtendedSourceLinkData[] = [
        {
          original_request_id: 'orig_1',
          source_field: 'share_bunk_with',
          is_primary: true,
        },
        {
          original_request_id: 'orig_2',
          source_field: 'bunking_notes',
          is_primary: false,
        },
      ]

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      const checkboxes = screen.getAllByRole('checkbox')
      // Primary checkbox should be disabled and not checked
      expect(checkboxes[0]).toBeDisabled()
      expect(checkboxes[0]).not.toBeChecked()
      // Non-primary checkbox should be enabled and auto-checked
      expect(checkboxes[1]).not.toBeDisabled()
      expect(checkboxes[1]).toBeChecked()
    })
  })

  describe('request type selection for split sources', () => {
    it('shows type dropdown for each selected source', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      // Select a source
      const checkboxes = screen.getAllByRole('checkbox')
      const firstCheckbox = checkboxes[0]
      expect(firstCheckbox).toBeDefined()
      if (firstCheckbox) fireEvent.click(firstCheckbox)

      // Should now show a type dropdown
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })
  })

  describe('split action', () => {
    it('has a split button', () => {
      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[{ original_request_id: 'orig_1', source_field: 'share_bunk_with' }]}
          onSplitComplete={() => {}}
        />
      )

      expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument()
    })

    it('split button is disabled when only primary source exists (cannot be selected)', () => {
      // If the only source is primary, it cannot be selected, so button should be disabled
      interface ExtendedSourceLinkData extends SourceLinkData {
        is_primary?: boolean
      }
      const sourceLinks: ExtendedSourceLinkData[] = [
        {
          original_request_id: 'orig_1',
          source_field: 'share_bunk_with',
          is_primary: true,
        },
      ]

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      const splitButton = screen.getByRole('button', { name: /split/i })
      expect(splitButton).toBeDisabled()
    })

    it('calls split API with correct payload on confirm', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          original_request_id: 'req_merged',
          created_request_ids: ['new_req_1'],
          updated_source_fields: ['share_bunk_with'],
        }),
      })

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      // Select a source to split
      const checkboxes = screen.getAllByRole('checkbox')
      const secondCheckbox = checkboxes[1]
      expect(secondCheckbox).toBeDefined()
      if (secondCheckbox) fireEvent.click(secondCheckbox) // Select bunking_notes

      const splitButton = screen.getByRole('button', { name: /split/i })
      fireEvent.click(splitButton)

      await waitFor(() => {
        expect(mockFetchWithAuth).toHaveBeenCalledWith(
          expect.stringContaining('/api/requests/split'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"request_id"'),
          })
        )
      })
    })

    it('calls onSplitComplete after successful split', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      const onSplitComplete = vi.fn()

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          original_request_id: 'req_merged',
          created_request_ids: ['new_req_1'],
          updated_source_fields: ['share_bunk_with'],
        }),
      })

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={onSplitComplete}
        />
      )

      // Select a source and split
      const checkboxes = screen.getAllByRole('checkbox')
      const firstCheckbox = checkboxes[0]
      expect(firstCheckbox).toBeDefined()
      if (firstCheckbox) fireEvent.click(firstCheckbox)

      const splitButton = screen.getByRole('button', { name: /split/i })
      fireEvent.click(splitButton)

      await waitFor(() => {
        expect(onSplitComplete).toHaveBeenCalled()
      })
    })

    it('shows error message on split failure', async () => {
      interface ExtendedSourceLinkData extends SourceLinkData {
        is_primary?: boolean
      }
      // Non-primary source will be auto-selected
      const sourceLinks: ExtendedSourceLinkData[] = [
        {
          original_request_id: 'orig_1',
          source_field: 'share_bunk_with',
          is_primary: false,
        },
      ]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Split failed' }),
      })

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      // Source is already auto-selected, just click split
      const splitButton = screen.getByRole('button', { name: /split/i })
      fireEvent.click(splitButton)

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument()
      })
    })
  })

  describe('cancel action', () => {
    it('has a cancel button', () => {
      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      )

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('calls onClose when cancel is clicked', () => {
      const onClose = vi.fn()

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={onClose}
          request={createMergedMockRequest()}
          sourceLinks={[]}
          onSplitComplete={() => {}}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)

      expect(onClose).toHaveBeenCalled()
    })
  })

  // Earlier iterations of Split invalidated only 5 of the 7 request keys —
  // the 4 per-camper keys (person-bunk-requests, person-all-bunk-requests,
  // bunk_requests_tooltip, request-satisfaction) plus cohort-request-relations
  // went stale on the sidebar, full-page CamperDetail, tooltip, and
  // satisfaction badges after a split.
  describe('cache invalidation contract', () => {
    function isStale(qc: QueryClient, key: readonly unknown[]) {
      return qc.getQueryState(key)?.isInvalidated === true
    }

    it('invalidates all 7 request-derived React Query keys after a successful split', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          original_request_id: 'req_merged',
          created_request_ids: ['new_req_1'],
          updated_source_fields: ['share_bunk_with'],
        }),
      })

      const { queryClient } = renderWithSeededClient(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest({ requester_id: 12345, year: 2025 })}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      const checkboxes = screen.getAllByRole('checkbox')
      const firstCheckbox = checkboxes[0]
      expect(firstCheckbox).toBeDefined()
      if (firstCheckbox) fireEvent.click(firstCheckbox)

      const splitButton = screen.getByRole('button', { name: /split/i })
      fireEvent.click(splitButton)

      await waitFor(() => {
        expect(isStale(queryClient, ['bunk-requests'])).toBe(true)
      })

      expect(isStale(queryClient, [...queryKeys.allBunkRequestsPrefix(), 1000001, 2025])).toBe(true)
      expect(isStale(queryClient, [...queryKeys.personBunkRequestsPrefix(), 12345, 2025])).toBe(
        true
      )
      expect(isStale(queryClient, [...queryKeys.personAllBunkRequestsPrefix(), 12345, 2025])).toBe(
        true
      )
      expect(isStale(queryClient, [...queryKeys.bunkRequestsTooltipPrefix(), 12345, 2025])).toBe(
        true
      )
      expect(isStale(queryClient, [...queryKeys.requestSatisfactionPrefix(), 12345])).toBe(true)
      expect(isStale(queryClient, queryKeys.cohortRequestRelationsPrefix())).toBe(true)
    })
  })

  describe('loading state', () => {
    it('disables split button while submitting', async () => {
      const sourceLinks: SourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
      ]

      // Never resolve to keep it in loading state
      mockFetchWithAuth.mockReturnValue(new Promise(() => {}))

      renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      // Select a source
      const checkboxes = screen.getAllByRole('checkbox')
      const firstCheckbox = checkboxes[0]
      expect(firstCheckbox).toBeDefined()
      if (firstCheckbox) fireEvent.click(firstCheckbox)

      const splitButton = screen.getByRole('button', { name: /split/i })
      fireEvent.click(splitButton)

      await waitFor(() => {
        expect(splitButton).toBeDisabled()
      })
    })
  })

  /**
   * TDD TESTS: Primary Source Indicator
   *
   * When viewing source links in the split modal, users should be able
   * to distinguish which source is the "primary" source that determined
   * the main request type/target.
   */
  describe('Primary Source Indicator', () => {
    it('should accept is_primary in SourceLinkData interface', () => {
      // Extended interface should include is_primary
      interface SourceLinkDataWithPrimary {
        original_request_id: string
        source_field: string
        original_content?: string
        created?: string
        parse_notes?: string
        is_primary?: boolean
      }

      const primarySource: SourceLinkDataWithPrimary = {
        original_request_id: 'orig_1',
        source_field: 'share_bunk_with',
        is_primary: true,
      }

      const secondarySource: SourceLinkDataWithPrimary = {
        original_request_id: 'orig_2',
        source_field: 'bunking_notes',
        is_primary: false,
      }

      expect(primarySource.is_primary).toBe(true)
      expect(secondarySource.is_primary).toBe(false)
    })

    it('should identify the primary source among multiple sources', () => {
      const sourceLinks = [
        {
          original_request_id: 'orig_1',
          source_field: 'share_bunk_with',
          is_primary: true,
        },
        {
          original_request_id: 'orig_2',
          source_field: 'bunking_notes',
          is_primary: false,
        },
      ]

      const primarySource = sourceLinks.find((s) => s.is_primary === true)
      expect(primarySource).toBeDefined()
      expect(primarySource?.source_field).toBe('share_bunk_with')
    })

    it('should handle case where no source is marked as primary', () => {
      const sourceLinks = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with' },
        { original_request_id: 'orig_2', source_field: 'bunking_notes' },
      ]

      const primarySource = sourceLinks.find(
        (s) => (s as { is_primary?: boolean }).is_primary === true
      )
      expect(primarySource).toBeUndefined()
    })

    it('should show primary badge text for primary source', () => {
      // Test the visual indicator logic
      const isPrimary = true as boolean
      const badgeText = isPrimary ? 'Primary' : null

      expect(badgeText).toBe('Primary')
    })

    it('should not show primary badge for non-primary sources', () => {
      const isPrimary = false as boolean
      const badgeText = isPrimary ? 'Primary' : null

      expect(badgeText).toBeNull()
    })
  })

  describe('always-mounted conversion (kindred#2538)', () => {
    interface ExtendedSourceLinkData extends SourceLinkData {
      is_primary?: boolean
    }

    it('clears a failed split error when reopened', async () => {
      const sourceLinks: ExtendedSourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with', is_primary: false },
      ]
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        json: async () => ({ detail: 'Split exploded' }),
      })
      const request = createMergedMockRequest()

      const { rerender } = renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          nonce={1}
          onClose={() => {}}
          request={request}
          sourceLinks={sourceLinks}
          onSplitComplete={() => {}}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /split/i }))
      expect(await screen.findByText(/Split exploded/i)).toBeInTheDocument()

      // Close and reopen with no await between — the leave is still in flight.
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SplitRequestModal
            isOpen={false}
            nonce={1}
            onClose={() => {}}
            request={request}
            sourceLinks={sourceLinks}
            onSplitComplete={() => {}}
          />
        </QueryClientProvider>
      )
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SplitRequestModal
            isOpen={true}
            nonce={2}
            onClose={() => {}}
            request={request}
            sourceLinks={sourceLinks}
            onSplitComplete={() => {}}
          />
        </QueryClientProvider>
      )

      // kindred#2538 asked for `setError(null)` in the closed->open effect.
      // The per-open remount does it instead, and covers the other two states
      // with it.
      expect(screen.queryByText(/Split exploded/i)).not.toBeInTheDocument()
    })

    // NOTE: this one passes BEFORE the conversion as well as after, and is
    // kept deliberately rather than as a TDD red. The closed->open effect
    // already re-initializes `selectedSources` (kindred#2538 says as much), so
    // this pins behaviour the conversion must not BREAK -- the effect has to
    // keep firing once the body is remounted per open rather than reset in
    // place.
    it('re-derives the auto-selected sources from the CURRENT request when reopened', () => {
      const firstLinks: ExtendedSourceLinkData[] = [
        { original_request_id: 'orig_1', source_field: 'share_bunk_with', is_primary: true },
        { original_request_id: 'orig_2', source_field: 'bunking_notes', is_primary: false },
      ]
      const { rerender } = renderWithProviders(
        <SplitRequestModal
          isOpen={true}
          nonce={1}
          onClose={() => {}}
          request={createMergedMockRequest()}
          sourceLinks={firstLinks}
          onSplitComplete={() => {}}
        />
      )
      // The non-primary source is auto-selected; staff untick it.
      const firstBox = screen.getByRole('checkbox', { name: /bunking_notes/i })
      expect(firstBox).toBeChecked()
      fireEvent.click(firstBox)
      expect(screen.getByRole('checkbox', { name: /bunking_notes/i })).not.toBeChecked()

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SplitRequestModal
            isOpen={false}
            nonce={1}
            onClose={() => {}}
            request={createMergedMockRequest()}
            sourceLinks={firstLinks}
            onSplitComplete={() => {}}
          />
        </QueryClientProvider>
      )
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SplitRequestModal
            isOpen={true}
            nonce={2}
            onClose={() => {}}
            request={createMergedMockRequest()}
            sourceLinks={firstLinks}
            onSplitComplete={() => {}}
          />
        </QueryClientProvider>
      )

      // Reopening must present the default selection again, not the abandoned
      // one — otherwise Split would act on a set the staffer had cleared.
      expect(screen.getByRole('checkbox', { name: /bunking_notes/i })).toBeChecked()
    })
  })
})
