import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BunkRequestProvider } from './BunkRequestProvider'

// --- hoisted mutable state ---
const mockAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isLoading: true as boolean,
}))

// --- module mocks ---
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../hooks/useScenario', () => ({ useScenario: () => ({ currentScenario: null }) }))

const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'))
vi.mock('../hooks/useApiWithAuth', () => ({ useApiWithAuth: () => ({ fetchWithAuth: fetchSpy }) }))

const getFullListSpy = vi.fn().mockResolvedValue([])
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({ getFullList: getFullListSpy }),
  },
}))

// --- helpers ---
function renderProvider(sessionCmId: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BunkRequestProvider sessionCmId={sessionCmId}>
        <div data-testid="child" />
      </BunkRequestProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fetchSpy.mockClear()
  getFullListSpy.mockClear()
})

describe('BunkRequestProvider query gating', () => {
  it('does not fire either query while auth is loading', async () => {
    mockAuth.user = null
    mockAuth.isLoading = true

    renderProvider(5)

    // Allow any queued microtasks to flush
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getFullListSpy).not.toHaveBeenCalled()
  })

  it('does not fire either query when sessionCmId === 0', async () => {
    mockAuth.user = { id: '1' }
    mockAuth.isLoading = false

    renderProvider(0)

    await new Promise((r) => setTimeout(r, 0))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getFullListSpy).not.toHaveBeenCalled()
  })

  it('fires both queries when auth is resolved and sessionCmId > 0', async () => {
    mockAuth.user = { id: '1' }
    mockAuth.isLoading = false

    renderProvider(5)

    // Wait for queries to fire (they're async)
    await new Promise((r) => setTimeout(r, 50))

    // satisfaction query via fetchWithAuth
    const satisfactionCalled = fetchSpy.mock.calls.some((args) =>
      String(args[0]).includes('/api/satisfaction')
    )
    expect(satisfactionCalled).toBe(true)

    // bunk_requests query via pb.collection().getFullList
    expect(getFullListSpy).toHaveBeenCalled()
  })
})
