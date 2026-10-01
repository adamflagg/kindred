import { renderHook } from '@testing-library/react'
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
})
