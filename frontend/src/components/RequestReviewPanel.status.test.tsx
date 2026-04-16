import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import RequestReviewPanel from './RequestReviewPanel'

const requests = [
  {
    id: 'r-resolved',
    requester_id: 42,
    requestee_id: 100,
    request_type: 'bunk_with',
    year: 2026,
    session_id: 1,
    status: 'resolved',
    is_reciprocal: false,
    merged_into: '',
    priority: 1,
    confidence_score: 1.0,
    disposition_reason: 'exact_match',
  },
  {
    id: 'r-declined',
    requester_id: 42,
    requestee_id: 101,
    request_type: 'bunk_with',
    year: 2026,
    session_id: 1,
    status: 'declined',
    is_reciprocal: false,
    merged_into: '',
    priority: 1,
    confidence_score: 0.0,
    disposition_reason: 'session_mismatch',
  },
  {
    id: 'r-pending-triage',
    requester_id: 43,
    requestee_id: 102,
    request_type: 'bunk_with',
    year: 2026,
    session_id: 1,
    status: 'pending',
    is_reciprocal: false,
    merged_into: '',
    priority: 1,
    confidence_score: 0.5,
    disposition_reason: 'target_waitlisted',
  },
  {
    id: 'r-pending-plain',
    requester_id: 44,
    requestee_id: 103,
    request_type: 'bunk_with',
    year: 2026,
    session_id: 1,
    status: 'pending',
    is_reciprocal: false,
    merged_into: '',
    priority: 1,
    confidence_score: 0.9,
    disposition_reason: '',
  },
]
const persons = [42, 43, 44, 100, 101, 102, 103].map((cm_id) => ({
  cm_id,
  first_name: `P${cm_id}`,
  last_name: 'Test',
  year: 2026,
}))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => ({
      getFullList: async () => (name === 'bunk_requests' ? requests : persons),
      getOne: async () => ({}),
      update: async () => ({}),
    }),
  },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Default filter is statuses: ['pending']; override via localStorage so all rows show.
  localStorage.setItem(
    'kindred-requests-filters-1',
    JSON.stringify({ filters: { requestTypes: [], statuses: [], searchQuery: '' } })
  )
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/requests']}>
        <Routes>
          <Route path="/requests" element={<RequestReviewPanel sessionId={1} year={2026} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RequestReviewPanel Status cell reason line', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resolved rows show only the status chip, no reason line', async () => {
    renderPanel()
    // Both the desktop row and mobile card render the badge — 2 matches.
    await waitFor(() => expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0))
    const matchedReasonLines = screen
      .queryAllByTestId('status-reason-line')
      .filter((el) => /matched/i.test(el.textContent ?? ''))
    expect(matchedReasonLines.length).toBe(0)
  })

  it('declined rows show the reason line under the chip', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getAllByText('Declined').length).toBeGreaterThan(0))
    // "Different sessions" reason appears in both desktop + mobile — at least 1.
    expect(screen.getAllByText(/different sessions/i).length).toBeGreaterThan(0)
  })

  it('pending rows with a triage reason show it; plain pending rows do not', async () => {
    renderPanel()
    // 2 pending rows × (desktop + mobile) = 4 Pending chips in DOM.
    await waitFor(() => expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2))
    const reasonLines = screen.queryAllByTestId('status-reason-line')
    expect(
      reasonLines.filter((el) => /waitlisted/i.test(el.textContent ?? '')).length
    ).toBeGreaterThan(0)
    expect(reasonLines.filter((el) => /needs review/i.test(el.textContent ?? '')).length).toBe(0)
  })

  it('no row renders a standalone Disposition column cell', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getAllByText('Declined').length).toBeGreaterThan(0))
    // The old header text must be gone.
    expect(screen.queryByText(/^disposition$/i)).toBeNull()
    // The new Type header must be present.
    expect(screen.getAllByText(/^type$/i).length).toBeGreaterThan(0)
  })
})
