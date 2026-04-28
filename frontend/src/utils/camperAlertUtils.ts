/**
 * Pure utility for building the CamperDetailsPanel alert catalog.
 *
 * The unsatisfied-requests trigger uses pre-computed `requestInfo` from
 * BunkRequestProvider's `getSatisfiedRequestInfo` — the SAME source the
 * bunking-board CamperCard uses. This guarantees parity by construction:
 * if the orange triangle shows on the card, the yellow row shows in the
 * sidebar, and vice versa. Don't reintroduce a parallel satisfaction code
 * path here.
 */
import type { CamperAlert } from '../components/CamperAlertSection'

export interface CamperAlertInputs {
  /** null / undefined means unassigned */
  assignedBunkCmId: number | null | undefined
  /** Pre-computed by BunkRequestProvider.getSatisfiedRequestInfo */
  requestInfo: { totalRequests: number; satisfiedCount: number }
  lockState: 'locked' | 'pending' | 'none'
  lockGroupSize: number
}

export function buildCamperAlerts(inputs: CamperAlertInputs): CamperAlert[] {
  const { assignedBunkCmId, requestInfo, lockState, lockGroupSize } = inputs
  const alerts: CamperAlert[] = []

  if (assignedBunkCmId && requestInfo.totalRequests > 0 && requestInfo.satisfiedCount === 0) {
    alerts.push({
      id: 'unsatisfied-requests',
      severity: 'yellow',
      label: `Has ${requestInfo.totalRequests} ${
        requestInfo.totalRequests === 1 ? 'request' : 'requests'
      }, none satisfied`,
      requestRelated: true,
    })
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
