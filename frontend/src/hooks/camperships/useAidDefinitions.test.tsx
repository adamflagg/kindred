/**
 * useAidDefinitions: a surface's definition notes (§4.8). `useApiWithAuth` is deliberately NOT
 * mocked: the header assertion reads what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidDefinitions } from './useAidDefinitions'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = ['financial_aid.summary']
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))

const PAYLOAD = {
  surface: 'requests',
  notes: [
    {
      key: 'decided',
      n: 1,
      term: 'Decided',
      text: 'Decided: the award computed or decided for the round.',
    },
    {
      key: 'posted',
      n: 2,
      term: 'Posted',
      text: "Posted: the round's Posted tick and the amount it locked.",
    },
  ],
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.summary']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidDefinitions (§4.8; D20)', () => {
  it("reads a surface's notes through fetchWithAuth, for summary holders too", async () => {
    renderHook(() => useAidDefinitions('requests'), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/definitions?surface=requests')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads for a view holder too', async () => {
    granted = ['financial_aid.view']
    renderHook(() => useAidDefinitions('requests'), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('reads nothing for a user the back end would refuse (neither view nor summary)', async () => {
    granted = ['financial_aid.casework']
    renderHook(() => useAidDefinitions('requests'), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("numbers each figure's note by its key", async () => {
    const { result } = renderHook(() => useAidDefinitions('requests'), { wrapper })
    await waitFor(() => expect(result.current.notes).toHaveLength(2))
    // The read sends each note's term so the notes set it bold (design language §12).
    expect(result.current.notes[0]).toEqual({
      n: 1,
      term: 'Decided',
      text: 'Decided: the award computed or decided for the round.',
    })
    expect(result.current.entries[1]).toEqual({
      key: 'posted',
      term: 'Posted',
      text: "Posted: the round's Posted tick and the amount it locked.",
    })
    expect(result.current.numberOf('posted')).toBe(2)
    expect(result.current.numberOf('unknown')).toBeNull()
  })

  it('surfaces a failed read as an error', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'nope' }), { status: 404 }))
    )
    const { result } = renderHook(() => useAidDefinitions('nope'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
  })
})
