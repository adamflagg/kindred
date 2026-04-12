import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/testUtils'

// Mock pocketbase
const mockGetFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
    })),
  },
}))

// Mock useAuth
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    isLoading: false,
  }),
}))

const { CamperRequestSummary } = await import('./CamperRequestSummary')

beforeEach(() => {
  vi.clearAllMocks()
})

const mockRequests = [
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
  },
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
  },
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
  },
]

const mockPersons = [
  { id: 'p1', cm_id: 201, first_name: 'Olivia', last_name: 'Chen', year: 2025 },
  { id: 'p2', cm_id: 202, first_name: 'Liam', last_name: 'Garcia', year: 2025 },
  { id: 'p3', cm_id: 203, first_name: 'Noah', last_name: 'Smith', year: 2025 },
]

function mockFetch(requests: typeof mockRequests = mockRequests) {
  mockGetFullList.mockImplementation((opts: { filter?: string }) => {
    const filter = opts?.filter ?? ''
    if (filter.includes('requester_id')) {
      return Promise.resolve(requests)
    }
    if (filter.includes('cm_id')) {
      return Promise.resolve(mockPersons)
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

  it('shows "Not bunk with" label in red for not_bunk_with requests', async () => {
    mockFetch()
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    const notBunk = screen.getByText('Not bunk with')
    expect(notBunk.className).toMatch(/text-red-600/)
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

  it('filters out age_preference requests', async () => {
    mockFetch([
      ...mockRequests,
      {
        id: 'req4',
        requester_id: 100,
        requestee_id: 0,
        request_type: 'age_preference',
        status: 'pending',
        priority: 0,
        requested_person_name: '',
        year: 2025,
        session_id: 1001,
        is_reciprocal: false,
        confidence_score: 1,
        created: '2025-01-01',
      } as unknown as (typeof mockRequests)[number],
    ])
    render(<CamperRequestSummary requesterCmId={100} year={2025} currentRequestId="req1" />)
    await waitFor(() => {
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Prefers bunking with/)).not.toBeInTheDocument()
  })
})
