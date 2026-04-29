/**
 * Tests for buildCamperAlerts pure utility.
 *
 * Contract: buildCamperAlerts is a pure formatter that converts pre-computed
 * inputs into the alert catalog. The unsatisfied-parent-requests /
 * unsatisfied-staff-requests triggers are computed upstream (via
 * getSatisfiedRequestInfo from BunkRequestProvider) so this sidebar utility
 * uses the EXACT same source of truth as the bunking-board CamperCard — no
 * parallel/divergent satisfaction logic lives here.
 *
 * Stage 2 parent-paramount: legacy 'unsatisfied-requests' was split into
 * 'unsatisfied-parent-requests' (orange) and 'unsatisfied-staff-requests'
 * (amber). Both can fire simultaneously; staff alert is independent of
 * parent state (resolved Q #4 + Q #6 in the Stage 2 spec).
 */
import { describe, it, expect } from 'vitest'
import { buildCamperAlerts } from './camperAlertUtils'
import type { CamperAlertInputs } from './camperAlertUtils'

const BASE_INPUTS: CamperAlertInputs = {
  assignedBunkCmId: 42,
  requestInfo: {
    totalRequests: 0,
    satisfiedCount: 0,
    parentTotal: 0,
    parentSatisfied: 0,
    staffTotal: 0,
    staffSatisfied: 0,
  },
  lockState: 'none',
  lockGroupSize: 0,
}

// ─── unsatisfied-parent-requests alert (parity with CamperCard parent triangle) ───

describe('buildCamperAlerts — unsatisfied-parent-requests alert', () => {
  it('fires when parentTotal > 0 && parentSatisfied === 0', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 2,
        satisfiedCount: 0,
        parentTotal: 2,
        parentSatisfied: 0,
        staffTotal: 0,
        staffSatisfied: 0,
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-parent-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('orange')
    expect(alert?.label).toBe('2 parent requests, none satisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses singular "request" when parentTotal === 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 1,
        satisfiedCount: 0,
        parentTotal: 1,
        parentSatisfied: 0,
        staffTotal: 0,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')?.label).toBe(
      '1 parent request, none satisfied'
    )
  })

  it('does NOT fire when at least one parent request is satisfied', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 3,
        satisfiedCount: 1,
        parentTotal: 3,
        parentSatisfied: 1,
        staffTotal: 0,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  it('does NOT fire when parentTotal is 0 (only staff requests exist)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 1,
        satisfiedCount: 0,
        parentTotal: 0,
        parentSatisfied: 0,
        staffTotal: 1,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned (no bunk)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      requestInfo: {
        totalRequests: 5,
        satisfiedCount: 0,
        parentTotal: 5,
        parentSatisfied: 0,
        staffTotal: 0,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })
})

// ─── unsatisfied-staff-requests alert (parity with CamperCard staff dot) ───

describe('buildCamperAlerts — unsatisfied-staff-requests alert', () => {
  it('fires when staffTotal > 0 && staffSatisfied === 0', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 1,
        satisfiedCount: 0,
        parentTotal: 0,
        parentSatisfied: 0,
        staffTotal: 1,
        staffSatisfied: 0,
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-staff-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('amber')
    expect(alert?.label).toBe('1 staff request, none satisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses plural "requests" when staffTotal > 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 3,
        satisfiedCount: 0,
        parentTotal: 0,
        parentSatisfied: 0,
        staffTotal: 3,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')?.label).toBe(
      '3 staff requests, none satisfied'
    )
  })

  it('fires even when parent is fully satisfied (resolved Q #6)', () => {
    // User wants the complete "what didn't land" picture: staff alert is
    // independent of parent state. Parent satisfied + staff unsat → only the
    // staff alert appears (no parent alert).
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 2,
        satisfiedCount: 1,
        parentTotal: 1,
        parentSatisfied: 1,
        staffTotal: 1,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeDefined()
  })

  it('does NOT fire when at least one staff request is satisfied', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 2,
        satisfiedCount: 1,
        parentTotal: 0,
        parentSatisfied: 0,
        staffTotal: 2,
        staffSatisfied: 1,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      requestInfo: {
        totalRequests: 3,
        satisfiedCount: 0,
        parentTotal: 0,
        parentSatisfied: 0,
        staffTotal: 3,
        staffSatisfied: 0,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeUndefined()
  })
})

// ─── both alerts together ──────────────────────────────────────────────────

describe('buildCamperAlerts — combined parent + staff matrix', () => {
  it('emits BOTH alerts when both parent and staff are unsatisfied', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 2,
        satisfiedCount: 0,
        parentTotal: 1,
        parentSatisfied: 0,
        staffTotal: 1,
        staffSatisfied: 0,
      },
    })
    const ids = alerts.map((a) => a.id)
    expect(ids).toContain('unsatisfied-parent-requests')
    expect(ids).toContain('unsatisfied-staff-requests')
  })

  it('emits no request alerts when both parent and staff are fully satisfied', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        totalRequests: 2,
        satisfiedCount: 2,
        parentTotal: 1,
        parentSatisfied: 1,
        staffTotal: 1,
        staffSatisfied: 1,
      },
    })
    const ids = alerts.map((a) => a.id)
    expect(ids).not.toContain('unsatisfied-parent-requests')
    expect(ids).not.toContain('unsatisfied-staff-requests')
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
      requestInfo: {
        totalRequests: 1,
        satisfiedCount: 0,
        parentTotal: 1,
        parentSatisfied: 0,
        staffTotal: 0,
        staffSatisfied: 0,
      },
    }
    const result1 = buildCamperAlerts(inputs)
    const result2 = buildCamperAlerts(inputs)
    expect(result1).toEqual(result2)
  })
})
