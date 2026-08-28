import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { WeekendSession } from '../types/lodging'

const sessionsSpy = vi.fn()
vi.mock('./useWeekendRoster', () => ({
  useWeekendSessions: (year: number) => sessionsSpy(year) as { data: unknown },
}))

vi.mock('./useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

const { useWeekendShellSession, weekendRefFromPath } = await import('./useWeekendShellSession')

function weekend(cmId: number, name: string, sessionType: string): WeekendSession {
  return {
    session_id: `s${cmId}`,
    session_cm_id: cmId,
    name,
    session_type: sessionType,
  } as WeekendSession
}

const SESSIONS = [weekend(101, 'Family Camp 4', 'family'), weekend(202, 'Winter Weekend', 'adult')]

function wrapper(path: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  )
}

function renderAt(path: string) {
  sessionsSpy.mockReturnValue({ data: { sessions: SESSIONS } })
  return renderHook(() => useWeekendShellSession(), { wrapper: wrapper(path) })
}

describe('weekendRefFromPath', () => {
  it('reads the weekend reference out of a roster URL', () => {
    expect(weekendRefFromPath('/weekend/fc4')).toBe('fc4')
    expect(weekendRefFromPath('/weekend/fc4/groups')).toBe('fc4')
    expect(weekendRefFromPath('/weekend/101/board')).toBe('101')
  })

  it('returns undefined for the lander and the shared child routes', () => {
    expect(weekendRefFromPath('/weekend')).toBeUndefined()
    expect(weekendRefFromPath('/weekend/')).toBeUndefined()
    expect(weekendRefFromPath('/weekend/sessions')).toBeUndefined()
    expect(weekendRefFromPath('/weekend/user')).toBeUndefined()
    expect(weekendRefFromPath('/weekend/users')).toBeUndefined()
  })

  it('returns undefined off the weekend program entirely', () => {
    expect(weekendRefFromPath('/summer/sessions')).toBeUndefined()
    expect(weekendRefFromPath('/campers')).toBeUndefined()
    // Segment boundary, not a bare prefix — /weekends is not /weekend.
    expect(weekendRefFromPath('/weekends/fc4')).toBeUndefined()
  })
})

describe('useWeekendShellSession', () => {
  it('resolves a family weekend by slug and reports it as not adult', () => {
    const { result } = renderAt('/weekend/fc4/board')
    expect(result.current.session?.session_cm_id).toBe(101)
    expect(result.current.isAdultWeekend).toBe(false)
  })

  it('resolves an adult weekend by CampMinder id and flags it', () => {
    const { result } = renderAt('/weekend/202')
    expect(result.current.session?.session_cm_id).toBe(202)
    expect(result.current.isAdultWeekend).toBe(true)
  })

  it('reports no adult weekend on the lander, where none is selected', () => {
    const { result } = renderAt('/weekend/sessions')
    expect(result.current.session).toBeUndefined()
    expect(result.current.isAdultWeekend).toBe(false)
  })

  it('does not fetch the weekend list off a weekend route', () => {
    // `useWeekendSessions` gates its own query on `year > 0`, so passing 0 is
    // how this hook declines the fetch without a second enabled flag.
    renderAt('/summer/sessions')
    expect(sessionsSpy).toHaveBeenCalledWith(0)
    expect(sessionsSpy).not.toHaveBeenCalledWith(2026)
  })

  it('fetches the weekend list when a weekend is addressed', () => {
    renderAt('/weekend/fc4')
    expect(sessionsSpy).toHaveBeenCalledWith(2026)
  })

  it('claims nothing while the session list is still loading', () => {
    sessionsSpy.mockReturnValue({ data: undefined })
    const { result } = renderHook(() => useWeekendShellSession(), {
      wrapper: wrapper('/weekend/202'),
    })
    expect(result.current.session).toBeUndefined()
    expect(result.current.isAdultWeekend).toBe(false)
  })
})
