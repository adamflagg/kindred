/**
 * TDD Tests for MergeRequestsModal
 *
 * Tests the modal for merging multiple bunk_requests into one.
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import MergeRequestsModal from './MergeRequestsModal'
import { pb } from '../lib/pocketbase'
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
const personsGetFullList = vi.fn(() => Promise.resolve([]))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: (...args: unknown[]) => personsGetFullList(...(args as [])),
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

// Helper to create mock request objects
function createMockRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'req_1',
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
    status: 'pending',
    year: 2025,
    metadata: {},
    ...overrides,
  } as BunkRequestsResponse
}

function renderWithQueryClient(ui: React.ReactElement) {
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

describe('MergeRequestsModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('rendering', () => {
    it('renders nothing when not open', () => {
      const { container } = renderWithQueryClient(
        <MergeRequestsModal
          isOpen={false}
          onClose={() => {}}
          requests={[]}
          onMergeComplete={() => {}}
        />
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('renders modal with title when open', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      // Title appears in the modal header
      expect(screen.getByRole('heading', { name: /merge requests/i })).toBeTruthy()
    })

    it('shows both requests in side-by-side comparison', () => {
      const requests = [
        createMockRequest({ id: 'req_1', source_field: 'share_bunk_with' }),
        createMockRequest({ id: 'req_2', source_field: 'bunking_notes' }),
      ]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      // Use getAllByText since source fields may appear in multiple places
      expect(screen.getAllByText(/share_bunk_with/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/bunking_notes/i).length).toBeGreaterThan(0)
    })
  })

  describe('target selection', () => {
    it('provides radio buttons to select which target to keep', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const radios = screen.getAllByRole('radio')
      expect(radios.length).toBeGreaterThanOrEqual(2)
    })

    it('first request is selected by default', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const radios = screen.getAllByRole('radio')
      expect(radios[0]).toBeChecked()
    })
  })

  describe('request type selection', () => {
    it('shows request type dropdown', () => {
      const requests = [
        createMockRequest({
          id: 'req_1',
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
        createMockRequest({
          id: 'req_2',
          request_type: BunkRequestsRequestTypeOptions.not_bunk_with,
        }),
      ]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      // Should have a way to select final type
      expect(screen.getByLabelText(/final.*type/i)).toBeInTheDocument()
    })
  })

  describe('merge preview', () => {
    it('shows preview of combined source_fields', () => {
      const requests = [
        createMockRequest({ id: 'req_1', source_field: 'share_bunk_with' }),
        createMockRequest({ id: 'req_2', source_field: 'bunking_notes' }),
      ]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      // Should show merged source fields preview
      expect(screen.getByText(/source.*fields/i)).toBeInTheDocument()
    })
  })

  describe('merge action', () => {
    it('has a merge button', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      expect(screen.getByRole('button', { name: /merge/i })).toBeInTheDocument()
    })

    it('calls merge API with correct payload on confirm', async () => {
      const requests = [
        createMockRequest({
          id: 'req_1',
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
        createMockRequest({
          id: 'req_2',
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merged_request_id: 'req_1',
          deleted_request_ids: ['req_2'],
          source_fields: ['share_bunk_with', 'bunking_notes'],
          confidence_score: 0.95,
        }),
      })

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const mergeButton = screen.getByRole('button', { name: /merge/i })
      fireEvent.click(mergeButton)

      await waitFor(() => {
        expect(mockFetchWithAuth).toHaveBeenCalledWith(
          expect.stringContaining('/api/requests/merge'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"request_ids"'),
          })
        )
      })
    })

    it('calls onMergeComplete after successful merge', async () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      const onMergeComplete = vi.fn()

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merged_request_id: 'req_1',
          deleted_request_ids: ['req_2'],
          source_fields: [],
          confidence_score: 0.95,
        }),
      })

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={onMergeComplete}
        />
      )

      const mergeButton = screen.getByRole('button', { name: /merge/i })
      fireEvent.click(mergeButton)

      await waitFor(() => {
        expect(onMergeComplete).toHaveBeenCalled()
      })
    })

    it('shows error message on merge failure', async () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Merge failed' }),
      })

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const mergeButton = screen.getByRole('button', { name: /merge/i })
      fireEvent.click(mergeButton)

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument()
      })
    })
  })

  describe('cancel action', () => {
    it('has a cancel button', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('calls onClose when cancel is clicked', () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      const onClose = vi.fn()

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={onClose}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)

      expect(onClose).toHaveBeenCalled()
    })
  })

  // Earlier iterations of Merge invalidated only 5 of the 7 request keys —
  // the 4 per-camper keys (person-bunk-requests, person-all-bunk-requests,
  // bunk_requests_tooltip, request-satisfaction) plus cohort-request-relations
  // went stale on the sidebar, full-page CamperDetail, tooltip, and
  // satisfaction badges after a merge.
  describe('cache invalidation contract', () => {
    function isStale(qc: QueryClient, key: readonly unknown[]) {
      return qc.getQueryState(key)?.isInvalidated === true
    }

    it('invalidates all 7 request-derived React Query keys after a successful merge', async () => {
      const requests = [
        createMockRequest({ id: 'req_1', requester_id: 12345, year: 2025 }),
        createMockRequest({ id: 'req_2', requester_id: 12345, year: 2025 }),
      ]

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merged_request_id: 'req_1',
          deleted_request_ids: ['req_2'],
          source_fields: [],
          confidence_score: 0.95,
        }),
      })

      const { queryClient } = renderWithSeededClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const mergeButton = screen.getByRole('button', { name: /merge/i })
      fireEvent.click(mergeButton)

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
    it('disables merge button while submitting', async () => {
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      // Never resolve to keep it in loading state
      mockFetchWithAuth.mockReturnValue(new Promise(() => {}))

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      const mergeButton = screen.getByRole('button', { name: /merge/i })
      fireEvent.click(mergeButton)

      await waitFor(() => {
        expect(mergeButton).toBeDisabled()
      })
    })
  })

  describe('always-mounted conversion (kindred#2538)', () => {
    beforeEach(() => {
      // Re-arm the collection mock. The file-level `vi.resetAllMocks()` blanks
      // `pb.collection` so it returns undefined, which makes the persons query
      // throw before it ever reaches the spy -- and a "was not called"
      // assertion would then pass whether or not the query is gated. Found by
      // mutation-checking: ungating the query left these tests green.
      personsGetFullList.mockClear()
      personsGetFullList.mockResolvedValue([])
      vi.mocked(pb.collection).mockReturnValue({
        getFullList: personsGetFullList,
      } as unknown as ReturnType<typeof pb.collection>)
    })

    it('re-seeds the kept target from the CURRENT requests when reopened on a different pair', () => {
      const first = [
        createMockRequest({ id: 'req_1' }),
        createMockRequest({ id: 'req_2', requestee_id: 22222 }),
      ]
      const { rerender } = renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          nonce={1}
          onClose={() => {}}
          requests={first}
          onMergeComplete={() => {}}
        />
      )
      // The first request of the pair is the default kept target.
      expect(screen.getByDisplayValue('req_1')).toBeChecked()

      // Staff picks the OTHER one, then closes.
      fireEvent.click(screen.getByDisplayValue('req_2'))
      expect(screen.getByDisplayValue('req_2')).toBeChecked()

      const second = [
        createMockRequest({ id: 'req_9' }),
        createMockRequest({ id: 'req_10', requestee_id: 33333 }),
      ]
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MergeRequestsModal
            isOpen={false}
            nonce={1}
            onClose={() => {}}
            requests={first}
            onMergeComplete={() => {}}
          />
        </QueryClientProvider>
      )
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MergeRequestsModal
            isOpen={true}
            nonce={2}
            onClose={() => {}}
            requests={second}
            onMergeComplete={() => {}}
          />
        </QueryClientProvider>
      )

      // Always-mounted, `useState(requests[0]?.id)` runs ONCE at mount and
      // never re-derives -- so without a per-open remount this still holds
      // `req_2`, and Merge would POST a keep_target_from belonging to a pair
      // that is no longer on screen. This is the issue's correctness bug, not
      // a cosmetic one.
      expect(screen.getByDisplayValue('req_9')).toBeChecked()
    })

    it('clears a failed merge error when reopened', async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ detail: 'Merge exploded' }),
      })
      const requests = [createMockRequest({ id: 'req_1' }), createMockRequest({ id: 'req_2' })]

      const { rerender } = renderWithQueryClient(
        <MergeRequestsModal
          isOpen={true}
          nonce={1}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /merge/i }))
      expect(await screen.findByText(/Merge exploded/i)).toBeInTheDocument()

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MergeRequestsModal
            isOpen={false}
            nonce={1}
            onClose={() => {}}
            requests={requests}
            onMergeComplete={() => {}}
          />
        </QueryClientProvider>
      )
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MergeRequestsModal
            isOpen={true}
            nonce={2}
            onClose={() => {}}
            requests={requests}
            onMergeComplete={() => {}}
          />
        </QueryClientProvider>
      )

      // The banner is set on failure and nothing clears it, so always-mounted
      // it greets the next open.
      expect(screen.queryByText(/Merge exploded/i)).not.toBeInTheDocument()
    })

    it("does not look up the merge targets' persons while it is closed", async () => {
      const requests = [
        createMockRequest({ id: 'req_1', requestee_id: 67890 }),
        createMockRequest({ id: 'req_2', requestee_id: 22222 }),
      ]

      renderWithQueryClient(
        <MergeRequestsModal
          isOpen={false}
          nonce={0}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )

      // `mergeEligibility.requests` goes non-empty on SELECTION alone, so a
      // closed dialog that fetched would look persons up every time staff tick
      // a second merge-eligible row, with a fresh queryKey per selection.
      //
      // TWO mechanisms keep this true and either alone is sufficient, so
      // mutating one leaves this green: (1) `<Modal isOpen={false}>` renders
      // no children, so the form body — and its useQuery — is not mounted at
      // all while closed; (2) the query's own `enabled: isOpen && …`, which is
      // what covers the exit-fade window, when the body IS mounted with
      // isOpen already false. Verified by mutation: removing both together is
      // what reds this.
      await Promise.resolve()
      expect(personsGetFullList).not.toHaveBeenCalled()
    })

    it('looks the persons up once it is opened', async () => {
      const requests = [
        createMockRequest({ id: 'req_1', requestee_id: 67890 }),
        createMockRequest({ id: 'req_2', requestee_id: 22222 }),
      ]

      const { rerender } = renderWithQueryClient(
        <MergeRequestsModal
          isOpen={false}
          nonce={0}
          onClose={() => {}}
          requests={requests}
          onMergeComplete={() => {}}
        />
      )
      expect(personsGetFullList).not.toHaveBeenCalled()

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MergeRequestsModal
            isOpen={true}
            nonce={1}
            onClose={() => {}}
            requests={requests}
            onMergeComplete={() => {}}
          />
        </QueryClientProvider>
      )

      await waitFor(() => expect(personsGetFullList).toHaveBeenCalled())
    })
  })
})
