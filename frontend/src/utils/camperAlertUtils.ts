/**
 * Pure utility for building the CamperDetailsPanel alert catalog.
 *
 * The unsatisfied-parent-requests / unsatisfied-staff-requests triggers use
 * pre-computed `requestInfo` from BunkRequestProvider's getSatisfiedRequestInfo
 * — the SAME source the bunking-board CamperCard uses. This guarantees parity
 * by construction: if the parent triangle / staff dot show on the card, the
 * matching alert row shows in the sidebar, and vice versa. Don't reintroduce
 * a parallel satisfaction code path here.
 *
 * Stage 2 parent-paramount: the legacy single 'unsatisfied-requests' alert was
 * split into two alerts that match the CamperCard's two icons (resolved Q #4
 * in the Stage 2 spec — IDs renamed outright, no backwards compat needed).
 *
 * Stage 3a parent-paramount: requestInfo now carries Shape A
 * (SatisfiedRequestInfo) instead of the legacy flat-count shape. The alert
 * gates delegate entirely to the pre-computed boolean flags
 * parentMinOneViolation / staffUnsatisfiedAlert so that best-effort-only
 * (socialize_with) campers do NOT trip the parent alert.
 */
import type { CamperAlert } from '../components/CamperAlertSection'
import type { SatisfiedRequestInfo } from '../contexts/BunkRequestContext'

export interface CamperAlertInputs {
  /** null / undefined means unassigned */
  assignedBunkCmId: number | null | undefined
  /** Pre-computed by BunkRequestProvider.getSatisfiedRequestInfo (Shape A) */
  requestInfo: SatisfiedRequestInfo
  lockState: 'locked' | 'pending' | 'none'
  lockGroupSize: number
}

export function buildCamperAlerts(inputs: CamperAlertInputs): CamperAlert[] {
  const { assignedBunkCmId, requestInfo, lockState, lockGroupSize } = inputs
  const alerts: CamperAlert[] = []

  if (assignedBunkCmId) {
    // Parent-paramount alert: orange, fires when material parent requests exist
    // and zero are satisfied. Delegates to pre-computed parentMinOneViolation so
    // best-effort (socialize_with) requests never trip this alert.
    // Mirrors the CamperCard parent triangle.
    if (requestInfo.parentMinOneViolation) {
      const count = requestInfo.materialParent.total
      alerts.push({
        id: 'unsatisfied-parent-requests',
        severity: 'orange',
        label: `${count} parent ${count === 1 ? 'request' : 'requests'}, none satisfied`,
        requestRelated: true,
      })
    }
    // Staff alert: amber, fires when staff has >=1 request and zero satisfied —
    // independent of parent state (resolved Q #6: user wants the complete
    // "what didn't land" picture for staff input). Mirrors the CamperCard
    // staff-dot rule.
    if (requestInfo.staffUnsatisfiedAlert) {
      const count = requestInfo.staff.total
      alerts.push({
        id: 'unsatisfied-staff-requests',
        severity: 'amber',
        label: `${count} staff ${count === 1 ? 'request' : 'requests'}, none satisfied`,
        requestRelated: true,
      })
    }
  }

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
