/**
 * useStaffRetentionData - Joins bunkStaff data with retention metrics
 * to produce a staff-centric view of cabin retention rates.
 *
 * Inverts the bunkStaff map (session|bunk -> staff[]) to get
 * staffPerson -> [{session, bunk}], joins with retention data,
 * and computes per-staff overall weighted retention.
 *
 * Exports a pure function buildStaffRetentionData for testability.
 */
import { useMemo } from 'react'
import { useRetentionMetrics } from './useMetrics'
import { useBunkStaff } from './useBunkStaff'
import type { BunkStaffInfo } from './useBunkStaff'
import type { RetentionBySessionBunk } from '../types/metrics'

export interface StaffSessionData {
  bunkName: string
  baseCount: number
  returnedCount: number
  retentionRate: number
}

export interface StaffRetentionRow {
  personId: string
  name: string
  status?: string
  sessionData: Map<string, StaffSessionData> // sessionName -> data
  overallRetention: number // weighted avg by base_count
  totalBaseCount: number
  totalReturnedCount: number
}

interface BuildResult {
  staffRows: StaffRetentionRow[]
  sessions: string[]
}

/**
 * Pure function that builds staff retention data from bunkStaff map and retention metrics.
 * Exported for direct testing.
 */
export function buildStaffRetentionData(
  bunkStaff: Map<string, BunkStaffInfo[]>,
  retention: RetentionBySessionBunk[]
): BuildResult {
  if (bunkStaff.size === 0 || retention.length === 0) {
    return { staffRows: [], sessions: [] }
  }

  // Build retention lookup: "session|bunk" -> RetentionBySessionBunk
  const retentionLookup = new Map<string, RetentionBySessionBunk>()
  for (const item of retention) {
    retentionLookup.set(`${item.session}|${item.bunk}`, item)
  }

  // Invert: staffPerson -> [{sessionName, bunkName, retentionData}]
  const staffEntries = new Map<
    string,
    {
      name: string
      status?: string
      entries: Array<{ sessionName: string; retention: RetentionBySessionBunk }>
    }
  >()

  for (const [key, staffList] of bunkStaff) {
    const [sessionName, bunkName] = key.split('|')
    if (!sessionName || !bunkName) continue

    // Look up retention data for this session|bunk key
    const retentionItem = retentionLookup.get(key)
    if (!retentionItem) continue

    for (const staff of staffList) {
      let entry = staffEntries.get(staff.personId)
      if (!entry) {
        entry = { name: staff.name, ...(staff.status ? { status: staff.status } : {}), entries: [] }
        staffEntries.set(staff.personId, entry)
      }
      entry.entries.push({ sessionName, retention: retentionItem })
    }
  }

  // Build rows with weighted averages
  const sessionsSet = new Set<string>()
  const staffRows: StaffRetentionRow[] = []

  for (const [personId, { name, status, entries }] of staffEntries) {
    const sessionData = new Map<string, StaffSessionData>()
    let totalBase = 0
    let totalReturned = 0

    for (const { sessionName, retention: r } of entries) {
      sessionData.set(sessionName, {
        bunkName: r.bunk,
        baseCount: r.base_count,
        returnedCount: r.returned_count,
        retentionRate: r.retention_rate,
      })
      totalBase += r.base_count
      totalReturned += r.returned_count
      sessionsSet.add(sessionName)
    }

    staffRows.push({
      personId,
      name,
      ...(status ? { status } : {}),
      sessionData,
      overallRetention: totalBase > 0 ? totalReturned / totalBase : 0,
      totalBaseCount: totalBase,
      totalReturnedCount: totalReturned,
    })
  }

  const sessions = [...sessionsSet].sort()

  return { staffRows, sessions }
}

/**
 * Hook that fetches bunkStaff and retention data, then builds staff retention rows.
 */
export function useStaffRetentionData(priorYear: number, currentYear: number) {
  const {
    data: retentionData,
    isLoading: retLoading,
    error: retError,
  } = useRetentionMetrics(priorYear, currentYear)
  const {
    data: bunkStaffData,
    isLoading: staffLoading,
    error: staffError,
  } = useBunkStaff(priorYear)

  const result = useMemo(() => {
    if (!(bunkStaffData instanceof Map) || !retentionData?.by_session_bunk) {
      return { staffRows: [], sessions: [] }
    }
    return buildStaffRetentionData(bunkStaffData, retentionData.by_session_bunk)
  }, [bunkStaffData, retentionData])

  return {
    ...result,
    bunkStaff: bunkStaffData ?? new Map(),
    isLoading: retLoading || staffLoading,
    error: retError || staffError,
  }
}
