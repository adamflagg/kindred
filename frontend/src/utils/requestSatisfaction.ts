/**
 * Per-request satisfaction — single source of truth.
 *
 * Both `useSatisfactionData` (PB-backed) and `CamperDetailsPanel`
 * (scenario-aware in-memory) call this function. The decision tree here
 * MUST match `BunkRequestProvider.getSatisfiedRequestInfo`'s implicit
 * per-request logic so the orange-triangle alert on the bunking-board card
 * and the Met/Unmet pill in the modal never disagree.
 */
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'
import { formatGradeOrdinal } from './gradeUtils'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import type { BunkmateInfo } from '../contexts/BunkRequestContext'
import type { SatisfactionResult } from '../hooks/camper/types'

export interface ComputeRequestSatisfactionInputs {
  request: EnhancedBunkRequest
  /** Requester's bunk in the active view; null = unassigned */
  requesterBunkCmId: number | null
  /** Roster of the requester's bunk, EXCLUDING the requester themselves */
  requesterBunkmates: BunkmateInfo[]
  /**
   * Target's bunk in the active view; null = unassigned. Only consulted for
   * `bunk_with` / `not_bunk_with`. Caller resolves the lookup before calling.
   */
  targetBunkCmId: number | null
  requesterGrade: number | null
}

export function computeRequestSatisfaction({
  request,
  requesterBunkCmId,
  requesterBunkmates,
  targetBunkCmId,
  requesterGrade,
}: ComputeRequestSatisfactionInputs): SatisfactionResult {
  if (requesterBunkCmId == null) {
    return { status: 'unknown', detail: 'Requester not assigned' }
  }

  if (request.request_type === 'bunk_with' && request.requestee_id && request.requestee_id > 0) {
    if (targetBunkCmId == null) {
      return { status: 'not_satisfied', detail: 'Target not assigned' }
    }
    const sameBunk = targetBunkCmId === requesterBunkCmId
    return sameBunk
      ? { status: 'satisfied', detail: 'Same bunk' }
      : { status: 'not_satisfied', detail: 'Different bunks' }
  }

  if (
    request.request_type === 'not_bunk_with' &&
    request.requestee_id &&
    request.requestee_id > 0
  ) {
    if (targetBunkCmId == null) {
      return { status: 'satisfied', detail: 'Target not assigned' }
    }
    const sameBunk = targetBunkCmId === requesterBunkCmId
    return sameBunk
      ? { status: 'not_satisfied', detail: 'Same bunk (conflict!)' }
      : { status: 'satisfied', detail: 'Different bunks' }
  }

  if (request.request_type === 'age_preference' && request.age_preference_target) {
    if (requesterGrade == null) {
      return { status: 'unknown', detail: 'No grade on file' }
    }
    const bunkmateGrades = requesterBunkmates
      .map((b) => b.grade)
      .filter((g): g is number => g != null)
    if (bunkmateGrades.length === 0) {
      return { status: 'not_satisfied', detail: 'No bunkmates assigned yet' }
    }
    const preference = request.age_preference_target as 'older' | 'younger'
    const { satisfied, detail } = isAgePreferenceSatisfied(
      requesterGrade,
      bunkmateGrades,
      preference
    )
    const gradeCounts = new Map<number, number>()
    for (const g of bunkmateGrades) {
      gradeCounts.set(g, (gradeCounts.get(g) ?? 0) + 1)
    }
    const breakdown = Array.from(gradeCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([g, c]) => `${formatGradeOrdinal(g)}: ${c}`)
      .join(' | ')
    return {
      status: satisfied ? 'satisfied' : 'not_satisfied',
      detail: `Bunk: ${breakdown} — ${detail}`,
    }
  }

  return { status: 'unknown' }
}
