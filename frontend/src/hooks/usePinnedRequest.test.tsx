import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { usePinnedRequest } from './usePinnedRequest'
import type { ReactNode } from 'react'

function wrap(initialEntries: string[] = ['/']) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  )
}

describe('usePinnedRequest', () => {
  it('returns null when ?pin= is absent', () => {
    const { result } = renderHook(() => usePinnedRequest(), { wrapper: wrap(['/requests']) })
    expect(result.current.pinnedId).toBeNull()
  })

  it('reads the pin id from the URL', () => {
    const { result } = renderHook(() => usePinnedRequest(), {
      wrapper: wrap(['/requests?pin=abc123']),
    })
    expect(result.current.pinnedId).toBe('abc123')
  })

  it('setPinnedId("xyz") sets ?pin=xyz without pushing history', () => {
    let latestSearch = ''
    function Probe() {
      const loc = useLocation()
      latestSearch = loc.search
      return null
    }
    const { result } = renderHook(
      () => {
        Probe()
        return usePinnedRequest()
      },
      { wrapper: wrap(['/requests']) }
    )
    act(() => result.current.setPinnedId('xyz'))
    expect(latestSearch).toBe('?pin=xyz')
  })

  it('setPinnedId(null) removes the pin param', () => {
    const { result } = renderHook(() => usePinnedRequest(), {
      wrapper: wrap(['/requests?pin=abc123']),
    })
    act(() => result.current.setPinnedId(null))
    expect(result.current.pinnedId).toBeNull()
  })

  it('preserves other query params when setting/clearing pin', () => {
    let latestSearch = ''
    function Probe() {
      const loc = useLocation()
      latestSearch = loc.search
      return null
    }
    const { result } = renderHook(
      () => {
        Probe()
        return usePinnedRequest()
      },
      { wrapper: wrap(['/requests?year=2026&tab=requests']) }
    )
    act(() => result.current.setPinnedId('abc'))
    expect(new URLSearchParams(latestSearch).get('pin')).toBe('abc')
    expect(new URLSearchParams(latestSearch).get('year')).toBe('2026')
    expect(new URLSearchParams(latestSearch).get('tab')).toBe('requests')
  })
})
