/**
 * Pure utility for building the CamperDetailsPanel alert catalog.
 *
 * The unsatisfied-parent-requests / unsatisfied-staff-requests triggers use
 * pre-computed `requestInfo` from BunkRequestProvider's getSatisfiedRequestInfo,
 * which is sourced from /api/satisfaction — the SAME source the bunking-board
 * CamperCard uses. This guarantees parity by construction: if the parent
 * triangle / staff dot show on the card, the matching alert row shows in the
 * sidebar, and vice versa.
 *
 * Alert gates delegate entirely to the pre-computed boolean flags
 * `parent_min_one_violation` / `staff_unsatisfied_alert` so that immaterial
 * (socialize_with) campers do NOT trip the parent alert.
 */
import type { CamperAlert } from '../components/CamperAlertSection'
import type { CamperSatisfaction } from '../types/satisfaction'

export interface CamperAlertInputs {
  /** null / undefined means unassigned */
  assignedBunkCmId: number | null | undefined
  /** Pre-computed by BunkRequestProvider.getSatisfiedRequestInfo */
  requestInfo: CamperSatisfaction
  lockState: 'locked' | 'pending' | 'none'
  lockGroupSize: number
}

export function buildCamperAlerts(inputs: CamperAlertInputs): CamperAlert[] {
  const { assignedBunkCmId, requestInfo, lockState, lockGroupSize } = inputs
  const alerts: CamperAlert[] = []

  if (assignedBunkCmId) {
    if (requestInfo.flags.parent_min_one_violation) {
      const count = requestInfo.counted_totals.material_parent.total
      alerts.push({
        id: 'unsatisfied-parent-requests',
        severity: 'orange',
        label: `${count} parent ${count === 1 ? 'request' : 'requests'}, none satisfied`,
        requestRelated: true,
      })
    }
    if (requestInfo.flags.staff_unsatisfied_alert) {
      const total = requestInfo.counted_totals.staff.total
      const satisfied = requestInfo.counted_totals.staff.satisfied
      const unsatisfied = total - satisfied
      alerts.push({
        id: 'unsatisfied-staff-requests',
        severity: 'amber',
        label: `${total} staff ${total === 1 ? 'request' : 'requests'}, ${unsatisfied} unsatisfied`,
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
