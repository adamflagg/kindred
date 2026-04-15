import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import RequestReviewPanel from './RequestReviewPanel'

// Mock pb so we control what each collection returns.
const requestsInList = [
  // A pending request matching the default filter.
  {
    id: 'req-visible',
    requester_id: 42,
    requestee_id: 100,
    request_type: 'bunk_with',
    year: 2026,
    session_id: 1,
    status: 'pending',
    is_reciprocal: false,
    merged_into: '',
    priority: 1,
    confidence_score: 0.5,
    disposition_reason: '',
  },
]
const pinnedHiddenRequest = {
  id: 'req-pinned',
  requester_id: 42,
  requestee_id: 101,
  request_type: 'bunk_with',
  year: 2026,
  session_id: 1,
  status: 'resolved',
  is_reciprocal: false,
  merged_into: '',
  priority: 1,
  confidence_score: 1.0,
  disposition_reason: 'exact_match',
}
const persons = [
  { cm_id: 42, first_name: 'Emma', last_name: 'Johnson', year: 2026 },
  { cm_id: 100, first_name: 'Liam', last_name: 'Garcia', year: 2026 },
  { cm_id: 101, first_name: 'Olivia', last_name: 'Chen', year: 2026 },
]

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => ({
      getFullList: async () => (name === 'bunk_requests' ? requestsInList : persons),
      getOne: async (id: string) => {
        if (id === 'req-pinned') return pinnedHiddenRequest
        throw new Error('not found')
      },
      update: async () => ({}),
    }),
  },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

function renderPanel(initialUrl = '/requests') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/requests" element={<RequestReviewPanel sessionId={1} year={2026} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RequestReviewPanel pinned row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear localStorage so filter/sort state from other tests doesn't leak in.
    localStorage.clear()
  })

  it('shows the pinned row with a Pinned badge even when filters would hide it', async () => {
    renderPanel('/requests?pin=req-pinned')
    // Pinned row is rendered despite default filter statuses=['pending'] and the pinned one is resolved.
    await screen.findAllByTestId('pinned-badge')
    // Olivia Chen is the requestee of the pinned (normally-filtered-out) row.
    await screen.findAllByText(/Olivia Chen/)
  })

  it('does not show the pinned badge for non-pinned rows', async () => {
    renderPanel('/requests?pin=req-pinned')
    await waitFor(() => expect(screen.getAllByText(/Liam Garcia/).length).toBeGreaterThan(0))
    // Desktop and mobile variants both render the badge, but only once per rendered breakpoint.
    // We accept at least one and ensure it's only on the pinned row by checking no extra
    // Pinned badge belongs to req-visible (which contains Liam Garcia).
    const badges = screen.getAllByTestId('pinned-badge')
    expect(badges.length).toBeGreaterThanOrEqual(1)
    // Every pinned badge must live inside a row tagged data-request-row-id="req-pinned".
    for (const badge of badges) {
      const row = badge.closest('[data-request-row-id]') as HTMLElement | null
      expect(row?.getAttribute('data-request-row-id')).toBe('req-pinned')
    }
  })
})
