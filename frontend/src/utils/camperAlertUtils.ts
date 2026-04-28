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
 */
import type { CamperAlert } from '../components/CamperAlertSection'

export interface CamperAlertInputs {
  /** null / undefined means unassigned */
  assignedBunkCmId: number | null | undefined
  /** Pre-computed by BunkRequestProvider.getSatisfiedRequestInfo */
  requestInfo: {
    totalRequests: number
    satisfiedCount: number
    parentTotal: number
    parentSatisfied: number
    staffTotal: number
    staffSatisfied: number
  }
  lockState: 'locked' | 'pending' | 'none'
  lockGroupSize: number
}

export function buildCamperAlerts(inputs: CamperAlertInputs): CamperAlert[] {
  const { assignedBunkCmId, requestInfo, lockState, lockGroupSize } = inputs
  const alerts: CamperAlert[] = []

  if (assignedBunkCmId) {
    // Parent-paramount alert: orange, fires when parent submitted requests and
    // zero are satisfied. Mirrors the CamperCard parent triangle.
    if (requestInfo.parentTotal > 0 && requestInfo.parentSatisfied === 0) {
      alerts.push({
        id: 'unsatisfied-parent-requests',
        severity: 'orange',
        label: `${requestInfo.parentTotal} parent ${
          requestInfo.parentTotal === 1 ? 'request' : 'requests'
        }, none satisfied`,
        requestRelated: true,
      })
    }
    // Staff alert: amber, always fires when staff is fully unsatisfied —
    // independent of parent state (resolved Q #6: user wants the complete
    // "what didn't land" picture for staff input). Mirrors the CamperCard
    // staff-dot rule.
    if (requestInfo.staffTotal > 0 && requestInfo.staffSatisfied === 0) {
      alerts.push({
        id: 'unsatisfied-staff-requests',
        severity: 'amber',
        label: `${requestInfo.staffTotal} staff ${
          requestInfo.staffTotal === 1 ? 'request' : 'requests'
        }, none satisfied`,
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
