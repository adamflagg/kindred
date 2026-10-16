/**
 * The line under each Analytics title that says what the page counts (PR 4, pick 1A: it replaces
 * the old subtitle). "2026 · At Camp — Quests and Teens not counted · counted in campers · Summer
 * only: …".
 *
 * Units are board 8's ruling: the plan's wording plus the lead's per-page proposals. A page with
 * no unit clause has none on purpose (a per-session grid, or bands that double-count campers).
 */

import type { MetricsViewMode } from '../../utils/sessionTypePredicates'
import type { DurationCategory } from '../../utils/sessionUtils'

export const SUMMER_ONLY =
  "Summer only: Family Camp, B*Mitzvah and winter programs aren't in Analytics"

export const DURATION_LABELS: Record<DurationCategory, string> = {
  '1-week': '1 Week',
  '2-week': '2 Week',
  '3-week': '3 Week',
  '4-week+': '4 Week+',
}

export const TEEN_TYPE_LABELS: Record<'scit' | 'tli', string> = {
  scit: 'SCIT',
  tli: 'TLI',
}

export const VIEW_MODE_LABELS: Record<MetricsViewMode, string> = {
  all: 'All Summer',
  quests: 'Quests',
  teens: 'Teens',
  sessions: 'At Camp',
}

const VIEW_MODE_LEFT: Record<MetricsViewMode, string | null> = {
  all: null,
  quests: 'At Camp and Teens not counted',
  teens: 'At Camp and Quests not counted',
  sessions: 'Quests and Teens not counted',
}

export interface ScopeWords {
  /** What the picker reads: "At Camp", "Session 2", "2 Week". */
  label: string
  /** What that scope leaves out, or null when it leaves nothing out. */
  left: string | null
}

interface ScopeInputs {
  viewMode: MetricsViewMode
  selectedSession: { name: string } | undefined
  selectedDuration: DurationCategory | null
  selectedTeenType: 'scit' | 'tli' | null
}

/** The session filter's pick in words. The picker's button reads the same label. */
export function scopeWords(s: ScopeInputs): ScopeWords {
  if (s.selectedSession)
    return { label: s.selectedSession.name, left: 'other sessions not counted' }
  if (s.selectedTeenType)
    return { label: TEEN_TYPE_LABELS[s.selectedTeenType], left: 'other sessions not counted' }
  if (s.selectedDuration)
    return { label: DURATION_LABELS[s.selectedDuration], left: 'other session lengths not counted' }
  return { label: VIEW_MODE_LABELS[s.viewMode], left: VIEW_MODE_LEFT[s.viewMode] }
}

const CAMPERS = 'counted in campers'
const CAMPER_SESSIONS = 'counted in camper-sessions'
const LAST_YEARS = "counted in last year's campers"

/** Board 8, column "proposed" (the plan's wording where it has one). */
const UNITS: Record<string, string | null> = {
  // Today mixes campers and camper-sessions, so each card names its own unit (#3207 PR 8)
  '/analytics/today': null,
  '/analytics/registration/overview': CAMPERS,
  '/analytics/registration/geo': CAMPERS,
  '/analytics/registration/waitlist': CAMPERS,
  '/analytics/registration/availability': null,
  '/analytics/registration/forecast': null,
  '/analytics/registration/cancellations': CAMPERS,
  '/analytics/registration/day1': CAMPER_SESSIONS,
  '/analytics/retention': LAST_YEARS,
  '/analytics/retention/flow': null,
  '/analytics/retention/bunks': LAST_YEARS,
  '/analytics/retention/staff': LAST_YEARS,
  '/analytics/trends': CAMPERS,
  '/analytics/trends/velocity': CAMPER_SESSIONS,
  '/analytics/trends/cancellations': 'counted in cancelled camper-sessions',
}

const UNFILTERED = ['/analytics/retention/bunks', '/analytics/retention/staff']

function seasons(pathname: string, year: number): string {
  if (pathname.startsWith('/analytics/retention')) return `${year - 1} → ${year}`
  if (pathname === '/analytics/trends') return `${year - 4}–${year}`
  if (pathname === '/analytics/registration/day1') return `${year - 2}–${year}`
  return String(year)
}

export interface ScopeLine {
  head: string
  left: string | null
  unit: string | null
}

export function scopeLine(pathname: string, year: number, scope: ScopeWords): ScopeLine {
  const unit = UNITS[pathname] ?? null
  if (UNFILTERED.includes(pathname)) {
    return {
      head: `${seasons(pathname, year)} · every ${year - 1} cabin`,
      left: "the session filter doesn't apply here",
      unit,
    }
  }
  return { head: `${seasons(pathname, year)} · ${scope.label}`, left: scope.left, unit }
}
