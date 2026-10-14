/**
 * Which of Analytics' controls a page shows, and why one is disabled.
 *
 * PR 4 pick 4B (owner, 2026-10-14): each section shows its own control on every one of its pages.
 * Where the control does nothing, it is disabled with the reason written inside it rather than
 * vanishing, so staff can see it exists and why it is off. That covers the two that used to show
 * and silently do nothing: Compare on Day 1, and Expanded analysis on Trends › Cancellations.
 *
 * On an empty season (board 9 A) the page body is the empty state, so every control that would
 * otherwise work reads "no {year} enrollments yet". The session picker stays live: filtering an
 * empty season is harmless, and it is where staff go first once sign-ups arrive.
 */

import {
  REGISTRATION_SUB_NAV,
  RETENTION_SUB_NAV,
  TRENDS_SUB_NAV,
} from '../../pages/metrics/metricsNav'

export type ControlState =
  | { shown: false; reason: null }
  /** reason null = working; a string = disabled, and the string is written inside the control. */
  | { shown: true; reason: string | null }

export interface MetricsControls {
  compare: ControlState
  expanded: ControlState
  teen: ControlState
  /** False on Bunk and Staff Analysis, which read every cabin unfiltered. */
  pickerUsed: boolean
}

interface Inputs {
  scopeHasTeens: boolean
  /** The viewed season when it has no countable rows, else null. */
  emptyYear: number | null
}

const HIDDEN: ControlState = { shown: false, reason: null }

const COMPARE_OFF = [
  '/analytics/registration/forecast',
  '/analytics/registration/availability',
  '/analytics/registration/day1',
]
const EXPANDED_OFF = ['/analytics/trends/velocity', '/analytics/trends/cancellations']
const UNFILTERED = ['/analytics/retention/bunks', '/analytics/retention/staff']

/** The sub-nav label of the page at `pathname`, for "not on {page}". */
function pageLabel(pathname: string): string {
  const item = [...REGISTRATION_SUB_NAV, ...RETENTION_SUB_NAV, ...TRENDS_SUB_NAV].find(
    (i) => i.path === pathname
  )
  return item?.label ?? 'this page'
}

export function metricsControls(
  pathname: string,
  { scopeHasTeens, emptyYear }: Inputs
): MetricsControls {
  const label = pageLabel(pathname)
  const unfiltered = UNFILTERED.includes(pathname)
  const emptyReason = emptyYear !== null ? `no ${emptyYear} enrollments yet` : null

  const control = (inSection: boolean, offReason: string | null): ControlState => {
    if (!inSection) return HIDDEN
    return { shown: true, reason: offReason ?? emptyReason }
  }

  return {
    compare: control(
      pathname.startsWith('/analytics/registration'),
      COMPARE_OFF.includes(pathname) ? `not on ${label}` : null
    ),
    expanded: control(
      pathname.startsWith('/analytics/trends'),
      EXPANDED_OFF.includes(pathname) ? `not on ${label}` : null
    ),
    teen: control(
      pathname.startsWith('/analytics/retention'),
      unfiltered ? `not on ${label}` : scopeHasTeens ? null : 'needs Teens or All Summer'
    ),
    pickerUsed: !unfiltered,
  }
}
