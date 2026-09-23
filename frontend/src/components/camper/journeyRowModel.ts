/**
 * The row model `JourneyRows` renders — one shape for every camper-journey
 * surface (the camper record, the Women's/Men's Weekend sidebar, and the
 * summer board's camper modal), so the rules for WHAT a row shows live in one
 * place and each surface only decides WHERE its rows come from.
 */
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay'
import { getStatusIndicator } from '../../utils/enrollmentFilter'
import { isFamilySessionType } from '../../utils/sessionTypePredicates'
import { weekendSubtitle } from '../weekend/weekendNames'
import type { HistoricalRecord } from '../../hooks/camper/types'

export interface JourneyRowStatus {
  letter: string
  colorClass: string
  /** The raw attendee status, shown on hover. */
  title: string | undefined
}

export interface JourneyRow {
  key: string
  year: number
  /** False for the second and later rows of the same year (multi-session). */
  showYear: boolean
  isCurrentYear: boolean
  /** The session's display name. */
  session: string
  /**
   * Which family weekend it was — Keshet, JFAM, the holiday. Rendered UNDER
   * the session name (owner ruling 2026-09-22, G2), never beside it.
   */
  subtitle: string | undefined
  /** Housing label; `undefined` renders an empty cabin cell. */
  cabin: string | undefined
  /** The as-typed string, when it disagrees with `cabin` (tooltip only). */
  cabinRecorded: string | undefined
  /** Non-enrolled status letter. A row with a status shows no cabin. */
  status: JourneyRowStatus | undefined
  /** The "Now" badge — the first current-year row, when it is enrolled. */
  showNow: boolean
}

/** The status letter for an attendee status, or `undefined` when enrolled. */
export function journeyRowStatus(attendeeStatus: string | undefined): JourneyRowStatus | undefined {
  const indicator = getStatusIndicator(attendeeStatus)
  return indicator
    ? { letter: indicator.letter, colorClass: indicator.colorClass, title: attendeeStatus }
    : undefined
}

/**
 * Rows for the shared journey feed (`useCamperJourney` / `fetchCamperJourney`).
 * `startsYearRun` is the year of the row rendered just above these, if any, so
 * a caller that prepends its own rows keeps the year de-duplication honest.
 */
export function journeyRowsFromHistory(
  history: HistoricalRecord[],
  currentYear: number,
  startsYearRun?: number
): JourneyRow[] {
  return history.map((record, idx) => {
    const isCurrentYear = record.year === currentYear
    // Hide the year label when it repeats the row above (multi-session).
    const prevYear = idx > 0 ? history[idx - 1]?.year : startsYearRun
    const showYear = prevYear !== record.year
    const status = journeyRowStatus(record.attendeeStatus)
    const subtitle = isFamilySessionType(record.sessionType)
      ? weekendSubtitle(record.sessionName)
      : ''
    return {
      key: `${record.year}-${record.sessionName}-${idx}`,
      year: record.year,
      showYear,
      isCurrentYear,
      session: getSessionDisplayNameFromString(record.sessionName, record.sessionType),
      subtitle: subtitle.length > 0 ? subtitle : undefined,
      // Housing only for enrolled rows that actually have a label. No-label
      // prior years (teen / 2022 gap / unresolved housing) get an empty cell.
      cabin: status ? undefined : record.bunkName,
      cabinRecorded: status ? undefined : record.bunkNameRecorded,
      status,
      showNow: isCurrentYear && showYear && !status,
    }
  })
}

export type JourneyDisplayState = 'rows' | 'loading' | 'error' | 'empty'

/**
 * Q8 (owner, 2026-09-22 late): decides which of the four states a journey
 * surface shows, from ROWS FIRST — rows already here render immediately, even
 * mid-load or after a failed refresh; the spinner is only for the true
 * "nothing yet" case. Shared by `CampJourneyTimeline` (the camper record and
 * the Women's/Men's Weekend sidebar) and the summer board modal's Camp
 * Journey section, so the ordering can't drift between them (owner ruling
 * 2026-09-22: "every sidebar handles the journey the same way").
 */
export function journeyDisplayState(
  rowCount: number,
  isLoading: boolean,
  error: Error | null
): JourneyDisplayState {
  if (rowCount > 0) return 'rows'
  if (isLoading) return 'loading'
  if (error) return 'error'
  return 'empty'
}
