import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn(() =>
  Promise.resolve([
    {
      cm_id: 1000101,
      name: 'Session 2',
      session_type: 'main',
      start_date: '2027-06-20',
      end_date: '2027-07-18',
      parent_id: 0,
    },
    {
      cm_id: 1000199,
      name: 'Session 3',
      session_type: 'main',
      start_date: '2027-07-20',
      end_date: '2027-08-15',
      parent_id: 0,
    },
    {
      cm_id: 1000150,
      name: 'Family Camp 10',
      session_type: 'family',
      start_date: '2027-05-01',
      end_date: '2027-05-03',
      parent_id: 0,
    },
    {
      cm_id: 1000151,
      name: 'Family Camp 2',
      session_type: 'family',
      start_date: '2027-08-20',
      end_date: '2027-08-22',
      parent_id: 0,
    },
    {
      cm_id: 1000120,
      name: 'Quest: Rivers',
      session_type: 'quest',
      start_date: '2027-06-01',
      end_date: '2027-06-05',
      parent_id: 0,
    },
    {
      cm_id: 1000121,
      name: 'AG Session 2',
      session_type: 'ag',
      start_date: '2027-06-20',
      end_date: '2027-07-18',
      parent_id: 1000101,
    },
    {
      cm_id: 1000122,
      name: 'Session 2a',
      session_type: 'embedded',
      start_date: '2027-06-20',
      end_date: '2027-07-04',
      parent_id: 0,
    },
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
      fields: 'cm_id,name,session_type,start_date,end_date,parent_id',
      sort: 'start_date,cm_id',
    })
  })

  it('iterates in the Camperships session order (owner Q8): summer by date with the AG under its parent, then Quest, then Family Camp by number', async () => {
    const { result } = renderHook(() => useAidSessionNames(2029), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())
    expect([...(result.current?.values() ?? [])]).toEqual([
      'Session 2',
      'AG Session 2',
      'Session 2a',
      'Session 3',
      'Quest: Rivers',
      'Family Camp 2',
      'Family Camp 10',
    ])
  })

  it('breaks start-date ties by cm_id so the picker order is stable', async () => {
    getFullList.mockClear()
    renderHook(() => useAidSessionNames(2028), { wrapper })
    await waitFor(() => expect(getFullList).toHaveBeenCalled())
    expect(getFullList).toHaveBeenCalledWith(expect.objectContaining({ sort: 'start_date,cm_id' }))
  })

  it('asks nothing until there is a season', () => {
    getFullList.mockClear()
    const { result } = renderHook(() => useAidSessionNames(0), { wrapper })
    expect(result.current).toBeUndefined()
    expect(getFullList).not.toHaveBeenCalled()
  })
})
