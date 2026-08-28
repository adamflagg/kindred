/**
 * The weekend the APP SHELL is currently pointed at, and whether it is an
 * adult weekend.
 *
 * `AppLayout` is the route element for `/weekend`, and `:sessionRef` is
 * declared on the child route, so `useParams` in the shell returns nothing —
 * React Router only supplies params matched up to the route that owns the
 * component. The reference therefore has to come off the pathname, which is
 * also what makes this survive a reload and a deep link.
 *
 * Why the shell needs this at all: kindred#2478 §5.1 hides the `Housing
 * synced` line and the `Refresh Housing` button on adult weekends.
 * `SessionResolver.GetFamilyCampSessionCMIDs` filters `session_type =
 * 'family'` exactly, so adult sessions are not in the bounded cohort — the
 * refresh chain would skip both expensive jobs and spend 13½ minutes
 * refreshing nothing. And `lodging_assignments` is a transform that runs daily
 * for everyone, rewriting adult rows from custom values up to seven days old,
 * so "Housing synced 11h ago" on an adult weekend is true about the JOB and
 * false about the DATA.
 *
 * This costs no extra request: `WeekendRosterPage` already reads
 * `useWeekendSessions` for the same year, and React Query dedupes the two
 * against one cache entry.
 */

import { useLocation } from 'react-router'

import { resolveWeekendRef } from '../components/weekend/weekendNames'
import type { WeekendSession } from '../types/lodging'
import { useAuth } from '../contexts/AuthContext'
import { useCurrentYear } from './useCurrentYear'
import { useWeekendSessions } from './useWeekendRoster'

/**
 * The `/weekend` children that are NOT a weekend reference.
 *
 * `sessions` is the lander; `user` and `users` are the shared-route redirects
 * registered under this layout. Mirrors the route table in `App.tsx` — a new
 * static child added there must be added here, or the shell will try to
 * resolve its name as a weekend slug.
 */
const NON_WEEKEND_SEGMENTS = new Set(['sessions', 'user', 'users'])

/**
 * The `:sessionRef` segment of a weekend URL, or undefined when the path does
 * not address one weekend.
 *
 * Segment boundary, not a bare prefix: `/weekends/...` is not `/weekend/...`.
 */
export function weekendRefFromPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter((segment) => segment.length > 0)
  if (segments[0] !== 'weekend') return undefined
  const ref = segments[1]
  if (ref === undefined || NON_WEEKEND_SEGMENTS.has(ref)) return undefined
  return ref
}

export interface WeekendShellSession {
  /** The addressed weekend, or undefined on the lander or before the list loads. */
  session: WeekendSession | undefined
  /**
   * True ONLY for a resolved weekend whose `session_type` is `adult`.
   *
   * Deliberately false while unresolved — on the lander, and in the window
   * before the session list arrives. Hiding is a claim about a specific
   * weekend; with no weekend in hand there is nothing to hide about, and
   * flickering the line out and back in on every load would be worse than the
   * one condition this exists to express.
   */
  isAdultWeekend: boolean
}

export function useWeekendShellSession(): WeekendShellSession {
  const location = useLocation()
  const { currentYear } = useCurrentYear()
  const { isLoading: authLoading } = useAuth()
  const ref = weekendRefFromPath(location.pathname)

  // `useWeekendSessions` already gates its own query on `year > 0` (the
  // CurrentYearContext cold-load guard). Passing 0 off a weekend route reuses
  // that gate rather than adding a second `enabled` flag to a shared hook.
  //
  // AUTH IS PART OF THE SAME GATE, and it matters more here than at this hook's
  // sibling call sites. `useWeekendSessions` gates only on `year > 0`, so it
  // will call `fetchWithAuth` during authentication bootstrap — and unlike
  // `WeekendRosterPage`, which mounts behind a resolved session, this hook runs
  // in the APP SHELL on every render of every weekend route, which is exactly
  // the bootstrap window. `frontend/CLAUDE.md`: "Always check `isLoading`
  // before making authenticated API calls."
  const sessionsQuery = useWeekendSessions(ref === undefined || authLoading ? 0 : currentYear)
  const session = resolveWeekendRef(sessionsQuery.data?.sessions ?? [], ref) as
    WeekendSession | undefined

  return { session, isAdultWeekend: session?.session_type === 'adult' }
}
