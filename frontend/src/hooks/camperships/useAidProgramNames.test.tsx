/** useAidProgramNames: program words from the approved rules (owner title case 10-03). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { RULES_2027 } from '../../components/camperships/money/ledgerFixtures'
import { programLabel } from '../../components/camperships/requests/programLabel'
import { useAidProgramNames } from './useAidProgramNames'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let answer: Response

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  answer = new Response(JSON.stringify(RULES_2027), { status: 200 })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(answer))
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidProgramNames', () => {
  // Owner 2026-10-10: the shared family words the server lays over the rules' labels, never the rules' own.
  it('names each program family in the shared words the approved read sends', async () => {
    const { result } = renderHook(() => useAidProgramNames(), { wrapper })
    await waitFor(() => expect(programLabel(result.current, 'summer')).toBe('At Camp'))
    expect(programLabel(result.current, 'quest')).toBe('Quests')
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/financial-aid/rules/2027/approved')
  })

  it('is empty while there are no rules, so programLabel spells the key out', async () => {
    answer = new Response(JSON.stringify({ detail: 'No rules yet' }), { status: 404 })
    const { result } = renderHook(() => useAidProgramNames(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(programLabel(result.current, 'family_camp')).toBe('Family camp')
  })
})
