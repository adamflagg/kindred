import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn(() =>
  Promise.resolve([
    { cm_id: 1000101, name: 'Session 2' },
    { cm_id: 1000199, name: 'Session 3' },
  ])
)
vi.mock('../../lib/pocketbase', () => ({
  pb: { collection: (name: string) => (name === 'camp_sessions' ? { getFullList } : null) },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))

import { useAidSessionNames } from './useAidSessionNames'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useAidSessionNames (Decision 28; M6)', () => {
  it("names the season's sessions from camp_sessions", async () => {
    const { result } = renderHook(() => useAidSessionNames(2027), { wrapper })
    await waitFor(() => expect(result.current?.get(1000199)).toBe('Session 3'))
    expect(getFullList).toHaveBeenCalledWith({
      filter: 'year = 2027',
      fields: 'cm_id,name',
      sort: 'start_date',
    })
  })

  it('asks nothing until there is a season', () => {
    getFullList.mockClear()
    const { result } = renderHook(() => useAidSessionNames(0), { wrapper })
    expect(result.current).toBeUndefined()
    expect(getFullList).not.toHaveBeenCalled()
  })
})
