/**
 * Pure utility functions for populate-from-previous-year feature.
 *
 * Handles session matching across years, date shifting, and
 * building a preview of what config records will be created.
 */

import { resolveSessionAlias } from '../../utils/sessionAliases'

// ── Types ────────────────────────────────────────────────────────────

export interface SessionData {
  cm_id: number
  name: string
  session_type: string
  year: number
}

export interface ConfigRecordLike {
  id: string
  category: string
  subcategory: string
  config_key: string
  value: unknown
}

export interface SessionMatch {
  currentSession: SessionData
  previousSession: SessionData | null
  matchType: 'cm_id' | 'alias' | 'unmatched'
}

export interface PreviewRegDateItem {
  key: string
  label: string
  previousValue: string
  newValue: string
  existingValue: string | null
}

export interface PreviewSessionItem {
  sessionName: string
  matchType: 'cm_id' | 'alias' | 'unmatched'
  previousSessionName: string | null
  previousValue: unknown
  newConfigKey: string
  existingValue: unknown | null
  existingRecordId: string | null
}

export interface PreviewThreshold {
  previousValue: number
  newValue: number
  existingValue: number | null
}

export interface PreviewSummary {
  toCreate: number
  alreadySet: number
  unmatchedSessions: number
  unmatchedSessionNames: string[]
}

export interface PopulatePreview {
  registrationDates: PreviewRegDateItem[]
  gradeItems: PreviewSessionItem[]
  budgetItems: PreviewSessionItem[]
  threshold?: PreviewThreshold | undefined
  summary: PreviewSummary
}

// ── Value emptiness check ────────────────────────────────────────────

/**
 * Returns true if a config value is effectively empty:
 * null, undefined, empty string, or an object where all properties are null/undefined.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).every(
      (v) => v === null || v === undefined
    )
  }
  return false
}

// ── Registration date field labels ───────────────────────────────────

const REG_DATE_LABELS: Record<string, string> = {
  priority_reg_date: 'Priority Registration',
  early_reg_date: 'Early Registration',
  open_reg_date: 'Open Registration',
}

// ── matchSessions ────────────────────────────────────────────────────

/**
 * Three-pass session matching algorithm:
 * 1. Match by cm_id (CampMinder reuses IDs across years)
 * 2. Match unmatched sessions by canonical name + session_type via alias resolution
 * 3. Remaining current sessions are marked 'unmatched'
 */
export function matchSessions(
  currentSessions: SessionData[],
  previousSessions: SessionData[]
): SessionMatch[] {
  const results: SessionMatch[] = []
  const matchedPrevIds = new Set<number>()

  // Pass 1: cm_id match
  for (const cur of currentSessions) {
    const prev = previousSessions.find((p) => p.cm_id === cur.cm_id && !matchedPrevIds.has(p.cm_id))
    if (prev) {
      results.push({ currentSession: cur, previousSession: prev, matchType: 'cm_id' })
      matchedPrevIds.add(prev.cm_id)
    }
  }

  // Pass 2: canonical name + type match for unmatched current sessions
  const unmatchedCurrent = currentSessions.filter(
    (cur) => !results.some((r) => r.currentSession.cm_id === cur.cm_id)
  )

  for (const cur of unmatchedCurrent) {
    const curCanonical = resolveSessionAlias(cur.name)
    const prev = previousSessions.find((p) => {
      if (matchedPrevIds.has(p.cm_id)) return false
      const prevCanonical = resolveSessionAlias(p.name)
      return prevCanonical === curCanonical && p.session_type === cur.session_type
    })

    if (prev) {
      results.push({ currentSession: cur, previousSession: prev, matchType: 'alias' })
      matchedPrevIds.add(prev.cm_id)
    } else {
      results.push({ currentSession: cur, previousSession: null, matchType: 'unmatched' })
    }
  }

  return results
}

// ── shiftDateByOneYear ───────────────────────────────────────────────

/**
 * Shift an ISO date string forward by one year.
 * Handles leap year edge case (Feb 29 → Feb 28).
 */
export function shiftDateByOneYear(dateStr: string): string {
  if (!dateStr) return ''

  const date = new Date(dateStr + 'T00:00:00')
  const newYear = date.getFullYear() + 1
  const month = date.getMonth()
  const day = date.getDate()

  // Create new date — JS handles overflow (e.g., Feb 29 in non-leap year → Mar 1)
  const shifted = new Date(newYear, month, day)

  // If the month changed, we overflowed (leap year edge case) — use last day of original month
  if (shifted.getMonth() !== month) {
    const lastDay = new Date(newYear, month + 1, 0)
    return formatDate(lastDay)
  }

  return formatDate(shifted)
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── buildPreview ─────────────────────────────────────────────────────

/**
 * Build a full preview of what will be populated.
 * Compares previous-year config against current-year config,
 * using session matches to map session-specific keys.
 */
export function buildPreview(
  matches: SessionMatch[],
  prevRegDates: ConfigRecordLike[],
  prevGradeConfig: ConfigRecordLike[],
  prevBudgetConfig: ConfigRecordLike[],
  curRegDates: ConfigRecordLike[],
  curGradeConfig: ConfigRecordLike[],
  curBudgetConfig: ConfigRecordLike[],
  _currentYear: number
): PopulatePreview {
  // Registration dates
  const registrationDates: PreviewRegDateItem[] = []
  for (const prev of prevRegDates) {
    const prevValue = prev.value as string
    if (!prevValue) continue // skip empty dates

    const newValue = shiftDateByOneYear(prevValue)
    const existing = curRegDates.find((c) => c.config_key === prev.config_key)

    registrationDates.push({
      key: prev.config_key,
      label: REG_DATE_LABELS[prev.config_key] ?? prev.config_key,
      previousValue: prevValue,
      newValue,
      existingValue: existing ? (existing.value as string) : null,
    })
  }

  // Grade config (per-session, matched)
  const gradeItems: PreviewSessionItem[] = []
  let threshold: PreviewThreshold | undefined

  for (const prev of prevGradeConfig) {
    // Handle threshold separately
    if (prev.config_key === 'limited_threshold') {
      const existingThreshold = curGradeConfig.find((c) => c.config_key === 'limited_threshold')
      threshold = {
        previousValue: prev.value as number,
        newValue: prev.value as number,
        existingValue: existingThreshold ? (existingThreshold.value as number) : null,
      }
      continue
    }

    // Find the match where the previous session's cm_id matches this config key
    const prevCmId = prev.config_key // grade config key = String(cm_id)
    const match = matches.find(
      (m) => m.previousSession && String(m.previousSession.cm_id) === prevCmId
    )

    if (!match?.previousSession) continue

    // Skip previous config with all-null values — nothing meaningful to copy
    if (isEmptyValue(prev.value)) continue

    const newKey = String(match.currentSession.cm_id)
    const existing = curGradeConfig.find((c) => c.config_key === newKey)

    const isEmpty = existing && isEmptyValue(existing.value)

    gradeItems.push({
      sessionName: match.currentSession.name,
      matchType: match.matchType,
      previousSessionName: match.matchType === 'alias' ? match.previousSession.name : null,
      previousValue: prev.value,
      newConfigKey: newKey,
      existingValue: existing && !isEmpty ? existing.value : null,
      existingRecordId: isEmpty ? existing.id : null,
    })
  }

  // Budget config (per-session, matched)
  const budgetItems: PreviewSessionItem[] = []
  for (const prev of prevBudgetConfig) {
    // budget config key = `session_${cm_id}`
    const prevCmIdStr = prev.config_key.replace('session_', '')
    const match = matches.find(
      (m) => m.previousSession && String(m.previousSession.cm_id) === prevCmIdStr
    )

    if (!match?.previousSession) continue

    // Skip previous config with all-null values
    if (isEmptyValue(prev.value)) continue

    const newKey = `session_${match.currentSession.cm_id}`
    const existing = curBudgetConfig.find((c) => c.config_key === newKey)

    const isEmpty = existing && isEmptyValue(existing.value)

    budgetItems.push({
      sessionName: match.currentSession.name,
      matchType: match.matchType,
      previousSessionName: match.matchType === 'alias' ? match.previousSession.name : null,
      previousValue: prev.value,
      newConfigKey: newKey,
      existingValue: existing && !isEmpty ? existing.value : null,
      existingRecordId: isEmpty ? existing.id : null,
    })
  }

  // Teen budget config (per session_type, keyed `type_<name>` — no cm_id remap).
  for (const prev of prevBudgetConfig) {
    if (!prev.config_key.startsWith('type_')) continue
    if (isEmptyValue(prev.value)) continue

    const newKey = prev.config_key // same key; target year lives in subcategory
    const existing = curBudgetConfig.find((c) => c.config_key === newKey)
    const isEmpty = existing && isEmptyValue(existing.value)

    budgetItems.push({
      sessionName: prev.config_key.replace('type_', '').toUpperCase(),
      matchType: 'cm_id',
      previousSessionName: null,
      previousValue: prev.value,
      newConfigKey: newKey,
      existingValue: existing && !isEmpty ? existing.value : null,
      existingRecordId: isEmpty ? existing.id : null,
    })
  }

  // Summary
  const allItems = [
    ...registrationDates.map((d) => ({ existing: d.existingValue })),
    ...gradeItems.map((g) => ({ existing: g.existingValue })),
    ...budgetItems.map((b) => ({ existing: b.existingValue })),
    ...(threshold ? [{ existing: threshold.existingValue }] : []),
  ]

  const toCreate = allItems.filter((i) => i.existing === null).length
  const alreadySet = allItems.filter((i) => i.existing !== null).length
  const unmatchedMatches = matches.filter((m) => m.matchType === 'unmatched')
  const unmatchedSessions = unmatchedMatches.length
  const unmatchedSessionNames = unmatchedMatches.map((m) => m.currentSession.name)

  return {
    registrationDates,
    gradeItems,
    budgetItems,
    threshold,
    summary: { toCreate, alreadySet, unmatchedSessions, unmatchedSessionNames },
  }
}
