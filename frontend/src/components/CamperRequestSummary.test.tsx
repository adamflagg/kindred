import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '../test/testUtils'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { render as rtlRender } from '@testing-library/react'
import type { BunkRequestsResponse } from '../types/pocketbase-types'

// Mock pocketbase
const mockGetFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
    })),
  },
}))

// Mock useAuth — the default is "user authed, auth not loading"; individual
// tests can override via mockUseAuth.mockReturnValue(...) before render.
type MockAuth = { user: unknown; isLoading: boolean }
const mockUseAuth = vi.fn<() => MockAuth>(() => ({
  user: { id: 'test-user', email: 'test@example.com' },
  isLoading: false,
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// Mock AllCamperRequestsModal so it renders a dialog when open
vi.mock('./AllCamperRequestsModal', () => ({
  AllCamperRequestsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="All requests">
        <button onClick={onClose}>Close modal</button>
      </div>
    ) : null,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="All requests">
        <button onClick={onClose}>Close modal</button>
      </div>
    ) : null,
}))

const { CamperRequestSummary } = await import('./CamperRequestSummary')

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({
    user: { id: 'test-user', email: 'test@example.com' },
    isLoading: false,
  })
})

const mockRequests: BunkRequestsResponse[] = [
  {
    id: 'req1',
    requester_id: 100,
    requestee_id: 201,
    request_type: 'bunk_with',
    status: 'resolved',
    priority: 1,
    requested_person_name: 'Olivia Chen',
    year: 2025,
    session_id: 1001,
    is_reciprocal: false,
    confidence_score: 0.95,
    created: '2025-01-01',
  } as unknown as BunkRequestsResponse,
  {
    id: 'req2',
    requester_id: 100,
    requestee_id: 202,
    request_type: 'not_bunk_with',
    status: 'pending',
    priority: 2,
    requested_person_name: 'Liam Garcia',
    year: 2025,
    session_id: 1001,
    is_reciprocal: false,
    confidence_score: 0.88,
    created: '2025-01-01',
  } as unknown as BunkRequestsResponse,
  {
    id: 'req3',
    requester_id: 100,
    requestee_id: 203,
    request_type: 'bunk_with',
    status: 'declined',
    priority: 3,
    requested_person_name: 'Noah Smith',
    year: 2025,
    session_id: 1001,
    is_reciprocal: false,
    confidence_score: 0.9,
    created: '2025-01-01',
  } as unknown as BunkRequestsResponse,
]

const mockPersons = [
  { id: 'p1', cm_id: 201, first_name: 'Olivia', last_name: 'Chen', year: 2025 },
  { id: 'p2', cm_id: 202, first_name: 'Liam', last_name: 'Garcia', year: 2025 },
  { id: 'p3', cm_id: 203, first_name: 'Noah', last_name: 'Smith', year: 2025 },
]

function mockFetch(
  requests: typeof mockRequests = mockRequests,
  persons: typeof mockPersons = mockPersons
) {
  mockGetFullList.mockImplementation((opts: { filter?: string }) => {
    const filter = opts?.filter ?? ''
    if (filter.includes('requester_id')) {
      return Promise.resolve(requests)
    }
    if (filter.includes('cm_id')) {
      return Promise.resolve(persons)
    }
    return Promise.resolve([])
  })
}

describe('CamperRequestSummary', () => {
  it('renders a list of other requests for the requester', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req2" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Liam Garcia/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Noah Smith/)).toBeInTheDocument()
  })

  it('highlights the current request with a ring', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    const currentRow = screen.getByTestId('request-row-req1')
    // The inner div produced by BunkRequestRow is a direct child
    const inner = currentRow.firstElementChild as HTMLElement
    expect(inner.className).toMatch(/ring-primary\/40/)
    expect(inner.className).toMatch(/bg-primary\/5/)
  })

  it('does not highlight non-current requests', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    const otherRow = screen.getByTestId('request-row-req2')
    const inner = otherRow.firstElementChild as HTMLElement
    expect(inner.className).not.toMatch(/ring-primary\/40/)
  })

  it('shows "Not with" label in red for not_bunk_with requests', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    const notBunk = screen.getByText('Not with')
    expect(notBunk.className).toMatch(/text-red-700/)
  })

  it('shows a loading indicator while requests load', () => {
    mockGetFullList.mockReturnValue(new Promise(() => {})) // never resolves
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    expect(screen.getByText(/Loading requests/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no other requests', async () => {
    mockFetch([])
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText(/No other requests/)).toBeInTheDocument()
    })
  })

  it('shows a loading state (not "No other requests") while auth is still resolving', () => {
    // Query is gated by !isAuthLoading, so when auth hasn't resolved the
    // requests query never runs and `requests=[]`. Without including
    // isAuthLoading in the rendered loading state, the component would
    // incorrectly fall through to the empty-state branch.
    mockUseAuth.mockReturnValue({ user: null, isLoading: true })
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    expect(screen.getByText(/Loading requests/)).toBeInTheDocument()
    expect(screen.queryByText(/No other requests/)).not.toBeInTheDocument()
  })

  it('renders age_preference requests with "Prefers bunking with" text', async () => {
    mockFetch([
      ...mockRequests,
      {
        id: 'req4',
        requester_id: 100,
        requestee_id: 0,
        request_type: 'age_preference',
        age_preference_target: 'older',
        status: 'pending',
        priority: 0,
        requested_person_name: '',
        year: 2025,
        session_id: 1001,
        is_reciprocal: false,
        confidence_score: 1,
        created: '2025-01-01',
      } as unknown as BunkRequestsResponse,
    ])
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    expect(screen.getByText(/Prefers bunking with/)).toBeInTheDocument()
  })

  it('shows an error state when request fetch fails', async () => {
    mockGetFullList.mockRejectedValue(new Error('Network error'))
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText(/Failed to load requests/)).toBeInTheDocument()
    })
  })

  it('renders the "Requests from this camper" heading', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    expect(await screen.findByText(/^Requests from this camper$/i)).toBeInTheDocument()
  })

  it('shows a "Current request" badge only on the current row', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await screen.findByText('Olivia Chen')
    const badges = screen.getAllByText(/current request/i)
    expect(badges).toHaveLength(1)
  })

  it('passes disposition_reason through to BunkRequestRow so declined rows show the reason', async () => {
    const declinedRequest = {
      id: 'req-declined',
      requester_id: 100,
      requestee_id: 301,
      request_type: 'bunk_with',
      status: 'declined',
      priority: 1,
      requested_person_name: 'Erez Example',
      disposition_reason: 'session_mismatch',
      year: 2025,
      session_id: 1001,
      is_reciprocal: false,
      confidence_score: 0.95,
      created: '2025-01-01',
    } as unknown as BunkRequestsResponse
    mockFetch(
      [declinedRequest],
      [{ id: 'p-cy', cm_id: 301, first_name: 'Erez', last_name: 'Example', year: 2025 }]
    )
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req-declined" />)
    // The disposition reason ("Different sessions") should render, read
    // directly from request.disposition_reason inside BunkRequestRow.
    await waitFor(() => {
      expect(screen.getByText(/Different sessions/)).toBeInTheDocument()
    })
    // Target name is rendered as a clickable link (not an unresolved span).
    const link = screen.getByRole('link', { name: /Erez Example/ })
    expect(link.getAttribute('href')).toBe('/camper/301')
  })

  it('shows a "Manage this camper\'s requests" button that opens the modal', async () => {
    mockFetch()
    render(
      <CamperRequestSummary
        requesterCmId={100}
        year={2025}
        currentRequestId="req1"
        requesterName="Emma Johnson"
      />
    )
    const btn = await screen.findByRole('button', { name: /manage this camper's requests/i })
    fireEvent.click(btn)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('keeps the modal mounted when a refetch puts the persons query into loading', async () => {
    // Repro for feedback follow-up on item #7: when the user updates a
    // request's target from inside the modal, the requestee_id changes,
    // queryKeys.camperRequestSummaryPersons gets a NEW key (no cached data),
    // isLoadingPersons flips to true, and the loading branch unmounts the
    // modal mid-flow. The modal must survive the transient loading state.
    mockFetch()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    rtlRender(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <CamperRequestSummary
            requesterCmId={100}
            year={2025}
            currentRequestId="req1"
            requesterName="Emma Johnson"
          />
        </BrowserRouter>
      </QueryClientProvider>
    )

    await screen.findByText('Olivia Chen')
    fireEvent.click(screen.getByRole('button', { name: /manage this camper's requests/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    // Simulate the user updating a request target: requests refetch with a
    // brand-new requestee_id (999) the persons cache has never seen, so the
    // persons query goes into a fresh isLoading=true state.
    const updatedRequests = mockRequests.map((r) =>
      r.id === 'req2' ? ({ ...r, requestee_id: 999 } as unknown as BunkRequestsResponse) : r
    )
    mockGetFullList.mockImplementation((opts: { filter?: string }) => {
      const filter = opts?.filter ?? ''
      if (filter.includes('requester_id')) return Promise.resolve(updatedRequests)
      // Persons fetch hangs to keep isLoadingPersons=true.
      if (filter.includes('cm_id')) return new Promise(() => {})
      return Promise.resolve([])
    })

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['camper-request-summary', 100, 2025] })
    })

    // Wait for the loading branch to take effect (proves the bug condition is exercised).
    await waitFor(() => {
      expect(screen.getByText(/Loading requests/)).toBeInTheDocument()
    })

    // Modal must still be in the DOM despite isLoadingPersons going true.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
