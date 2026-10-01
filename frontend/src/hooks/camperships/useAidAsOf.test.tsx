import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAidAsOf } from './useAidAsOf'

function at(search: string) {
  return renderHook(() => useAidAsOf(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/aid/requests${search}`]}>{children}</MemoryRouter>
    ),
  }).result.current
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('useAidAsOf', () => {
  it('is live with no as_of', () => {
    expect(at('')).toEqual({ kind: 'live' })
  })

  it('reads as_of and as_of_axis from the URL', () => {
    expect(at('?as_of=2026-04-01&as_of_axis=recorded')).toEqual({
      kind: 'past',
      date: '2026-04-01',
      axis: 'recorded',
    })
  })

  it('defaults the axis to CampMinder', () => {
    expect(at('?as_of=2026-04-01')).toEqual({
      kind: 'past',
      date: '2026-04-01',
      axis: 'campminder',
    })
  })

  it('is invalid for a date after camp today', () => {
    expect(at('?as_of=2099-01-01')).toEqual({ kind: 'invalid', raw: '2099-01-01' })
  })

  it('is live when as_of is camp today', () => {
    expect(at('?as_of=2026-10-01')).toEqual({ kind: 'live' })
  })

  it('reads camp time, not UTC, in the evening', () => {
    vi.setSystemTime(new Date('2026-10-02T05:30:00Z'))
    expect(at('?as_of=2026-10-01')).toEqual({ kind: 'live' })
    expect(at('?as_of=2026-10-02')).toEqual({ kind: 'invalid', raw: '2026-10-02' })
  })

  it('re-reads camp today when the clock crosses camp midnight with the page mounted', () => {
    vi.setSystemTime(new Date('2026-10-02T06:59:00Z')) // 23:59 on Oct 1, camp time
    const { result, rerender } = renderHook(() => useAidAsOf(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={['/aid/requests?as_of=2026-10-01']}>{children}</MemoryRouter>
      ),
    })
    expect(result.current).toEqual({ kind: 'live' })

    act(() => {
      vi.setSystemTime(new Date('2026-10-02T07:01:00Z')) // 00:01 on Oct 2
    })
    rerender()
    expect(result.current).toEqual({ kind: 'past', date: '2026-10-01', axis: 'campminder' })
  })
})
