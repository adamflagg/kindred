/**
 * useViewSeason — the empty state's "view 2026" link.
 *
 * Owner pick still open (question 2), built as recommended: a URL view override. It puts
 * ?year=<prior> in the URL and nothing else. The saved season (localStorage
 * `bunking-current-year`) stays as it was, so Summer, Family Camp and Camperships don't move and a
 * fresh tab opens on the primary season again. It must keep every other analytics param.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { CurrentYearProvider, serializeSavedYear } from '../contexts/CurrentYearContext'
import { useCurrentYear } from './useCurrentYear'

vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: { _configured_year: 2027 } }),
}))

import { useViewSeason } from './useViewSeason'

const STORAGE_KEY = 'bunking-current-year'

function wrapperAt(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[path]}>
        <CurrentYearProvider>{children}</CurrentYearProvider>
      </MemoryRouter>
    )
  }
}

function useProbe() {
  const view = useViewSeason()
  const { currentYear } = useCurrentYear()
  const location = useLocation()
  return { view, currentYear, search: new URLSearchParams(location.search) }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, serializeSavedYear(2027, 2027))
})

describe('useViewSeason', () => {
  it('switches the viewed season through ?year=', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/analytics/registration/overview'),
    })
    expect(result.current.currentYear).toBe(2027)
    act(() => result.current.view(2026))
    expect(result.current.search.get('year')).toBe('2026')
    expect(result.current.currentYear).toBe(2026)
  })

  it('leaves the saved season alone, so other programs and new tabs stay on 2027', () => {
    const before = localStorage.getItem(STORAGE_KEY)
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/analytics/registration/overview'),
    })
    act(() => result.current.view(2026))
    expect(result.current.currentYear).toBe(2026)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('keeps the session, view, compare, teen and pipeline params', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt(
        '/analytics/retention/overview?session=1001&view=quests&compare=2025&teen=scit&teen_pipeline=1&duration=2-week'
      ),
    })
    act(() => result.current.view(2026))
    const s = result.current.search
    expect(s.get('year')).toBe('2026')
    expect(s.get('session')).toBe('1001')
    expect(s.get('view')).toBe('quests')
    expect(s.get('compare')).toBe('2025')
    expect(s.get('teen')).toBe('scit')
    expect(s.get('teen_pipeline')).toBe('1')
    expect(s.get('duration')).toBe('2-week')
  })
})
