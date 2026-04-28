/**
 * Tests for buildCamperAlerts pure utility.
 *
 * Contract: buildCamperAlerts is a pure formatter that converts pre-computed
 * inputs into the alert catalog. The unsatisfied-requests trigger is computed
 * upstream (via getSatisfiedRequestInfo from BunkRequestProvider) so this
 * sidebar utility uses the EXACT same source of truth as the bunking-board
 * CamperCard — no parallel/divergent satisfaction logic lives here.
 */
import { describe, it, expect } from 'vitest'
import { buildCamperAlerts } from './camperAlertUtils'
import type { CamperAlertInputs } from './camperAlertUtils'

const BASE_INPUTS: CamperAlertInputs = {
  assignedBunkCmId: 42,
  requestInfo: { totalRequests: 0, satisfiedCount: 0 },
  lockState: 'none',
  lockGroupSize: 0,
}

// ─── unsatisfied-requests alert (parity with CamperCard) ───────────────────

describe('buildCamperAlerts — unsatisfied-requests alert', () => {
  it('fires when requestInfo.totalRequests > 0 && satisfiedCount === 0', () => {
    // Mirror of the CamperCard trigger: any request count, zero satisfied.
    // Pending/declined/age_preference all count toward totalRequests because
    // getSatisfiedRequestInfo (the shared source) does not status-filter.
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: { totalRequests: 2, satisfiedCount: 0 },
    })
    const unsatisfied = alerts.find((a) => a.id === 'unsatisfied-requests')
    expect(unsatisfied).toBeDefined()
    expect(unsatisfied?.severity).toBe('yellow')
    expect(unsatisfied?.label).toBe('Has 2 requests, none satisfied')
    expect(unsatisfied?.requestRelated).toBe(true)
  })

  it('uses singular "request" when totalRequests === 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: { totalRequests: 1, satisfiedCount: 0 },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')?.label).toBe(
      'Has 1 request, none satisfied'
    )
  })

  it('does NOT fire when at least one request is satisfied', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: { totalRequests: 3, satisfiedCount: 1 },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })

  it('does NOT fire when totalRequests is 0 (no requests at all)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: { totalRequests: 0, satisfiedCount: 0 },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned (no bunk)', () => {
    // Mirrors CamperCard which short-circuits to totalRequests=0 when
    // assigned_bunk_cm_id is falsy. Defense-in-depth: even if upstream
    // provides nonzero totalRequests for an unassigned camper, suppress.
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      requestInfo: { totalRequests: 5, satisfiedCount: 0 },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })
})

// ─── friend-group alert ────────────────────────────────────────────────────

describe('buildCamperAlerts — friend-group alert', () => {
  it('does NOT appear when lockState is "none"', () => {
    const alerts = buildCamperAlerts({ ...BASE_INPUTS, lockState: 'none' })
    expect(alerts.find((a) => a.id === 'friend-group')).toBeUndefined()
  })

  it('appears when lockState is "locked"', () => {
    const alerts = buildCamperAlerts({ ...BASE_INPUTS, lockState: 'locked', lockGroupSize: 3 })
    const friendGroup = alerts.find((a) => a.id === 'friend-group')
    expect(friendGroup).toBeDefined()
    expect(friendGroup?.severity).toBe('blue')
    expect(friendGroup?.label).toBe('In friend group (3 members)')
  })

  it('uses singular "member" label when group size is 1', () => {
    const alerts = buildCamperAlerts({ ...BASE_INPUTS, lockState: 'locked', lockGroupSize: 1 })
    expect(alerts.find((a) => a.id === 'friend-group')?.label).toBe('In friend group (1 member)')
  })
})

// ─── output stability (useMemo regression guard) ──────────────────────────

describe('buildCamperAlerts — output stability', () => {
  it('returns structurally equal output for the same inputs', () => {
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      requestInfo: { totalRequests: 1, satisfiedCount: 0 },
    }
    const result1 = buildCamperAlerts(inputs)
    const result2 = buildCamperAlerts(inputs)
    expect(result1).toEqual(result2)
  })
})
