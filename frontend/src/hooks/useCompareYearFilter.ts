/**
 * The filter options to send for the compare year.
 *
 * A picked session's cm_id belongs to the primary year; CampMinder reuses
 * names, not ids, across years (and renames some). Map the picked session onto
 * the compare year's list; with no match keep the original id (reads zeros,
 * as before) rather than silently widening the scope.
 */
import { useMemo } from 'react'
import { useMetricsSessions } from './useMetricsSessions'
import { matchSessionInYear } from '../utils/resolveSessionForYear'

export function useCompareYearFilter<T extends { sessionCmId?: number | undefined }>(
  primaryYear: number,
  compareYear: number | null,
  options: T | undefined
): T | undefined {
  const { data: primarySessions = [] } = useMetricsSessions(primaryYear)
  const { data: compareSessions = [] } = useMetricsSessions(compareYear ?? 0)
  const pickedId = options?.sessionCmId

  return useMemo(() => {
    if (!options || pickedId === undefined || !compareYear) return options
    const name = primarySessions.find((s) => s.cm_id === pickedId)?.name ?? null
    const mapped = matchSessionInYear(compareSessions, pickedId, name)
    return mapped === null || mapped === pickedId ? options : { ...options, sessionCmId: mapped }
  }, [options, pickedId, compareYear, primarySessions, compareSessions])
}
