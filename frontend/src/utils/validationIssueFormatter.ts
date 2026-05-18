/**
 * Per-type detail formatter for bunk-level ValidationIssues.
 *
 * Used by PostValidationResultsModal (expand-on-click rows) and will be
 * reused by PDF export (BunkPlanReport) in a future PR.
 *
 * Each formatter receives the structured `details` dict emitted by
 * bunking_validator.py and returns a short, human-readable string with
 * the actual numeric context.
 *
 * Falls back to `issue.message` when `details` is absent or the type
 * is not recognised.
 */

import type { PostCheckIssue } from '../components/issueClassifier'

// ---------------------------------------------------------------------------
// Per-type formatters
// ---------------------------------------------------------------------------

function formatCapacityViolation(details: Record<string, unknown>): string | null {
  const assigned = details['assigned']
  const maxSize = details['max_size']
  if (typeof assigned !== 'number' || typeof maxSize !== 'number') return null
  const over = assigned - maxSize
  return `Capacity: ${assigned} of ${maxSize} campers (${over} over)`
}

function formatAgeSpreadWarning(details: Record<string, unknown>): string | null {
  const spreadMonths = details['age_spread_months']
  const maxAllowed = details['max_allowed']
  if (typeof spreadMonths !== 'number' || typeof maxAllowed !== 'number') return null
  const rounded = Math.round(spreadMonths)
  return `Age spread: ${rounded} months range (limit ${maxAllowed})`
}

function formatGradeSpreadWarning(details: Record<string, unknown>): string | null {
  const uniqueGrades = details['unique_grades']
  const maxAllowed = details['max_allowed']
  const grades = details['grades']
  if (typeof uniqueGrades !== 'number' || typeof maxAllowed !== 'number') return null
  const gradesStr = Array.isArray(grades) ? ` [${grades.join(', ')}]` : ''
  return `${uniqueGrades} different grades${gradesStr} (limit ${maxAllowed})`
}

function formatGradeRatioWarning(details: Record<string, unknown>): string | null {
  const grade = details['grade']
  const count = details['count']
  const total = details['total']
  const percentage = details['percentage']
  const maxAllowed = details['max_allowed']
  if (
    typeof grade !== 'number' ||
    typeof count !== 'number' ||
    typeof total !== 'number' ||
    typeof percentage !== 'number'
  )
    return null
  const pctStr = Math.round(percentage)
  const limitStr = typeof maxAllowed === 'number' ? ` (limit ${maxAllowed}%)` : ''
  return `Grade ratio: ${pctStr}% from grade ${grade} (${count} of ${total})${limitStr}`
}

function formatGradeAdjacencyWarning(details: Record<string, unknown>): string | null {
  const gradesPresent = details['grades_present']
  const missingGrades = details['missing_grades']
  if (!Array.isArray(gradesPresent) || !Array.isArray(missingGrades)) return null
  const missing = missingGrades.join(', ')
  return `Grades [${gradesPresent.join(', ')}] (missing ${missing})`
}

function formatAgeFlowInversion(details: Record<string, unknown>): string | null {
  const lowerBunk = details['lower_bunk']
  const lowerAge = details['lower_avg_age']
  const higherBunk = details['higher_bunk']
  const higherAge = details['higher_avg_age']
  if (
    typeof lowerBunk !== 'string' ||
    typeof lowerAge !== 'number' ||
    typeof higherBunk !== 'string' ||
    typeof higherAge !== 'number'
  )
    return null
  return `${lowerBunk} avg age ${lowerAge} > ${higherBunk} avg age ${higherAge}`
}

function formatIsolationRisk(details: Record<string, unknown>): string | null {
  const groupSize = details['group_size']
  const isolatedCampers = details['isolated_campers']
  if (typeof groupSize !== 'number' || !Array.isArray(isolatedCampers)) return null
  const isolatedCount = isolatedCampers.length
  return `${groupSize} connected friends + ${isolatedCount} isolated camper${isolatedCount === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type Formatter = (details: Record<string, unknown>) => string | null

const FORMATTERS: Record<string, Formatter> = {
  capacity_violation: formatCapacityViolation,
  age_spread_warning: formatAgeSpreadWarning,
  grade_spread_warning: formatGradeSpreadWarning,
  grade_ratio_warning: formatGradeRatioWarning,
  grade_adjacency_warning: formatGradeAdjacencyWarning,
  age_flow_inversion: formatAgeFlowInversion,
  isolation_risk: formatIsolationRisk,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Returns a short human-readable detail string for a bunk-level validation
 * issue, including the validator's actual numbers.
 *
 * Falls back to `issue.message` when `details` is absent, or the type has
 * no registered formatter, or the formatter's required fields are missing.
 */
export function formatBunkIssueDetail(issue: PostCheckIssue): string {
  const formatter = FORMATTERS[issue.type]
  if (formatter && issue.details) {
    const result = formatter(issue.details)
    if (result !== null) return result
  }
  return issue.message
}
