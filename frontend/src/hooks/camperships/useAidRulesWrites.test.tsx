/** The Rules tab's writes: through fetchWithAuth, each body as sent, and what each refreshes on settle. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  approvePrecondition,
  savePrecondition,
} from '../../components/camperships/season/rules/precondition'
import { rulesDraft } from '../../components/camperships/season/rules/rulesFixtures'
import { queryKeys } from '../../utils/queryKeys'
import {
  useAidApproveRules,
  useAidSaveRulesSection,
  useAidStartRulesFromLastYear,
  useFreshAidRulesDraft,
} from './useAidRulesWrites'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(rulesDraft()), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const sent = () => {
  const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
  return {
    url,
    method: options.method,
    body: JSON.parse(String(options.body)) as unknown,
    auth: new Headers(options.headers).get('Authorization'),
  }
}

const refreshed = (spy: MockInstance, ...key: string[]) =>
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['financial-aid', ...key] }))

describe('precondition (the only file that knows the field)', () => {
  it("savePrecondition is the section's own fingerprint", () => {
    expect(savePrecondition(rulesDraft(), 'awards')).toEqual({
      expected_fingerprint: 'fp-awards-v4',
    })
  })

  it('approvePrecondition is one fingerprint per ticked section', () => {
    expect(approvePrecondition(rulesDraft(), ['award_tables', 'awards'])).toEqual({
      fingerprints: { award_tables: 'fp-award_tables-v4', awards: 'fp-awards-v4' },
    })
  })

  it('throws rather than sending an empty fingerprint for a section the draft lacks', () => {
    const draft = rulesDraft()
    const without = { ...draft, sections: draft.sections.filter((s) => s.section !== 'awards') }
    expect(() => savePrecondition(without, 'awards')).toThrow()
  })
})

describe('useAidSaveRulesSection (D39; G6)', () => {
  it("PUTs the section's JSON with the version the editor opened and its fingerprint; refreshes rules, Today, History and scenarios, not the money", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSaveRulesSection(), { wrapper })
    const body = {
      base_version: 4,
      content: { minimum: '150' },
      ...savePrecondition(rulesDraft(), 'awards'),
    }
    await act(() => result.current.mutateAsync({ section: 'awards', body }))
    expect(sent()).toEqual({
      url: '/api/financial-aid/rules/2027/sections/awards',
      method: 'PUT',
      body: { base_version: 4, content: { minimum: '150' }, expected_fingerprint: 'fp-awards-v4' },
      auth: 'Bearer test-jwt',
    })
    refreshed(invalidate, 'rules')
    refreshed(invalidate, 'today')
    refreshed(invalidate, 'history')
    refreshed(invalidate, 'scenarios')
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['financial-aid', 'budget'] })
    )
  })

  it('waits for the refresh: the mutation settles only after the refetch', async () => {
    const releases: Array<() => void> = []
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve))
    )
    const { result } = renderHook(() => useAidSaveRulesSection(), { wrapper })
    let done = false
    const body = { base_version: 4, content: {}, ...savePrecondition(rulesDraft(), 'awards') }
    const pending = result.current
      .mutateAsync({ section: 'awards', body })
      .then(() => (done = true))
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(done).toBe(false)
    releases.forEach((release) => release())
    await pending
    expect(done).toBe(true)
  })

  it("refreshes the rules when the save is refused (409, someone else's save): the message names it", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            detail: {
              message: 'Someone else saved awards since you opened it; reload to see their change',
              sections: ['awards'],
            },
          }),
          { status: 409 }
        )
      )
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSaveRulesSection(), { wrapper })
    const body = { base_version: 4, content: {}, ...savePrecondition(rulesDraft(), 'awards') }
    await act(async () => {
      await expect(result.current.mutateAsync({ section: 'awards', body })).rejects.toMatchObject({
        status: 409,
        message: 'Someone else saved awards since you opened it; reload to see their change',
      })
    })
    refreshed(invalidate, 'rules')
  })

  it('carries a string 409 (the version is no longer the latest) as the message too', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Version 4 is no longer the latest' }), {
          status: 409,
        })
      )
    )
    const { result } = renderHook(() => useAidSaveRulesSection(), { wrapper })
    const body = { base_version: 4, content: {}, ...savePrecondition(rulesDraft(), 'awards') }
    await act(async () => {
      await expect(result.current.mutateAsync({ section: 'awards', body })).rejects.toMatchObject({
        status: 409,
        message: 'Version 4 is no longer the latest',
      })
    })
  })
})

describe('useAidApproveRules (D39)', () => {
  it('POSTs the sections, the note and the fingerprints to the version shown; refreshes every money read, History and scenarios', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidApproveRules(), { wrapper })
    const body = {
      sections: ['award_tables' as const],
      note: 'Finance, Jan 22 meeting',
      ...approvePrecondition(rulesDraft(), ['award_tables']),
    }
    await act(() => result.current.mutateAsync({ version: 4, body }))
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/rules/2027/versions/4/approve',
      method: 'POST',
      body: {
        sections: ['award_tables'],
        note: 'Finance, Jan 22 meeting',
        fingerprints: { award_tables: 'fp-award_tables-v4' },
      },
    })
    refreshed(invalidate, 'budget')
    refreshed(invalidate, 'remaining')
    refreshed(invalidate, 'household-page')
    refreshed(invalidate, 'history')
    refreshed(invalidate, 'scenarios')
  })
})

describe('useAidStartRulesFromLastYear (§7.5)', () => {
  it('POSTs the start for the season; refreshes the unpriced set', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidStartRulesFromLastYear(), { wrapper })
    await act(() => result.current.mutateAsync(undefined))
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/rules/2027/start-from-last-year',
      method: 'POST',
    })
    refreshed(invalidate, 'rules')
    refreshed(invalidate, 'today')
    refreshed(invalidate, 'history')
    refreshed(invalidate, 'scenarios')
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['financial-aid', 'budget'] })
    )
  })
})

describe('useFreshAidRulesDraft (Decisions 16-17; plan review C1, C2)', () => {
  it('reads the server even when the cache holds a draft, and leaves what it read in the cache', async () => {
    client.setQueryData(queryKeys.aidRulesDraft(2027), { ...rulesDraft(), version: 3 })
    const { result } = renderHook(() => useFreshAidRulesDraft(), { wrapper })
    let fresh: unknown
    await act(async () => {
      fresh = await result.current()
    })
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe('/api/financial-aid/rules/2027/draft')
    expect(fresh).toEqual(rulesDraft())
    expect(client.getQueryData(queryKeys.aidRulesDraft(2027))).toEqual(rulesDraft())
  })
})
