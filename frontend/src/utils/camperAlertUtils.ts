/**
 * Pure utility for building the CamperDetailsPanel alert catalog.
 *
 * Extracted from the inline `buildAlerts` closure in CamperDetailsPanel so the
 * logic can be unit-tested without mounting the full component, and so the
 * result can be memoized via `useMemo`.
 */
import type { CamperAlert } from '../components/CamperAlertSection'

/** Minimal shape of a satisfaction result (mirrors SatisfactionResult in CamperDetailsPanel) */
interface SatisfactionResult {
  status: 'satisfied' | 'not_satisfied' | 'checking' | 'unknown'
  detail?: string
}

/** Minimal shape of a bunk request needed for alert derivation */
interface BunkRequestInput {
  id: string
  request_type: string
  /** "resolved", "pending", "declined", etc. */
  status: string
  requestee_id?: number | null
}

export interface CamperAlertInputs {
  /** null / undefined means unassigned */
  assignedBunkCmId: number | null | undefined
  bunkRequests: BunkRequestInput[]
  satisfactionData: Record<string, SatisfactionResult>
  lockState: 'locked' | 'pending' | 'none'
  lockGroupSize: number
}

/**
 * Derive the alert catalog for a camper panel.
 *
 * Alert 1 — unsatisfied-requests (yellow):
 *   Fires when the camper is assigned AND has at least one **resolved**
 *   bunk_with/not_bunk_with request AND none of those resolved requests are
 *   satisfied.  Pending/declined requests are excluded from `totalRequests`
 *   because satisfactionData only holds results for resolved requests — mixing
 *   the two scopes causes false positives.
 *
 * Alert 2 — friend-group (blue):
 *   Fires when the camper is in a locked friend group.
 */
export function buildCamperAlerts(inputs: CamperAlertInputs): CamperAlert[] {
  const { assignedBunkCmId, bunkRequests, satisfactionData, lockState, lockGroupSize } = inputs
  const alerts: CamperAlert[] = []

  // 1. Unsatisfied requests warning (mirrors orange triangle on CamperCard).
  //    Only relevant when camper is assigned to a bunk.
  if (assignedBunkCmId) {
    // Count only RESOLVED bunk_with/not_bunk_with requests — matches the scope
    // of the satisfaction query which filters r.status === 'resolved'.
    const totalRequests = bunkRequests.filter(
      (r) =>
        (r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with') &&
        r.status === 'resolved'
    ).length

    const satisfiedCount = Object.values(satisfactionData).filter(
      (r) => r.status === 'satisfied'
    ).length

    if (totalRequests > 0 && satisfiedCount === 0) {
      alerts.push({
        id: 'unsatisfied-requests',
        severity: 'yellow',
        label: `Has ${totalRequests} ${totalRequests === 1 ? 'request' : 'requests'}, none satisfied`,
        requestRelated: true,
      })
    }
  }

  // 2. Friend group (mirrors lock icon on CamperCard).
  //    Only shown when the camper is in a locked group.
  if (lockState === 'locked') {
    alerts.push({
      id: 'friend-group',
      severity: 'blue',
      label: `In friend group (${lockGroupSize} ${lockGroupSize === 1 ? 'member' : 'members'})`,
      requestRelated: false,
    })
  }

  return alerts
}
