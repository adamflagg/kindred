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
 * Stage 3a parent-paramount: requestInfo now carries Shape A flags
 * (parentMinOneViolation / staffUnsatisfiedAlert) instead of legacy flat
 * counts. The alert gates delegate entirely to those pre-computed booleans.
 */
import { describe, it, expect } from 'vitest'
import { buildCamperAlerts } from './camperAlertUtils'
import type { CamperAlertInputs } from './camperAlertUtils'

const EMPTY_SLICE = { total: 0, satisfied: 0, satisfactionRate: 0 }

const BASE_INPUTS: CamperAlertInputs = {
  assignedBunkCmId: 42,
  requestInfo: {
    materialParent: EMPTY_SLICE,
    bestEffortParent: EMPTY_SLICE,
    staff: EMPTY_SLICE,
    parentMinOneViolation: false,
    staffUnsatisfiedAlert: false,
  },
  lockState: 'none',
  lockGroupSize: 0,
}

// ─── unsatisfied-parent-requests alert (parity with CamperCard parent triangle) ───

describe('buildCamperAlerts — unsatisfied-parent-requests alert', () => {
  it('fires when parentMinOneViolation is true', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 2, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: true,
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-parent-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('orange')
    expect(alert?.label).toBe('2 parent requests, none satisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses singular "request" when materialParent.total === 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: true,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')?.label).toBe(
      '1 parent request, none satisfied'
    )
  })

  it('does NOT fire when parentMinOneViolation is false (at least one satisfied)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 3, satisfied: 1, satisfactionRate: 0.33 },
        parentMinOneViolation: false,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  it('does NOT fire when parentMinOneViolation is false (no parent requests at all)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
        staffUnsatisfiedAlert: true,
        parentMinOneViolation: false,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned (no bunk)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 5, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: true,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  // ── Materiality rule: best-effort-only campers must NOT trip parent alert ──
  it('socialize_with-only camper with unsatisfied best-effort does NOT trigger unsatisfied-parent-requests alert', () => {
    // parentMinOneViolation is false because only bestEffortParent has requests.
    // The alert gate must delegate to the flag, not re-derive from slice totals.
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        materialParent: { total: 0, satisfied: 0, satisfactionRate: 0 },
        bestEffortParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
        staff: { total: 0, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: false,
        staffUnsatisfiedAlert: false,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })
})

// ─── unsatisfied-staff-requests alert (parity with CamperCard staff dot) ───

describe('buildCamperAlerts — unsatisfied-staff-requests alert', () => {
  it('fires when staffUnsatisfiedAlert is true', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
        staffUnsatisfiedAlert: true,
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-staff-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('amber')
    expect(alert?.label).toBe('1 staff request, none satisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses plural "requests" when staff.total > 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        staff: { total: 3, satisfied: 0, satisfactionRate: 0 },
        staffUnsatisfiedAlert: true,
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
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 1, satisfied: 1, satisfactionRate: 1 },
        staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: false,
        staffUnsatisfiedAlert: true,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeDefined()
  })

  it('does NOT fire when staffUnsatisfiedAlert is false (at least one satisfied)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        staff: { total: 2, satisfied: 1, satisfactionRate: 0.5 },
        staffUnsatisfiedAlert: false,
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        staff: { total: 3, satisfied: 0, satisfactionRate: 0 },
        staffUnsatisfiedAlert: true,
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
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
        staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: true,
        staffUnsatisfiedAlert: true,
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
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 1, satisfied: 1, satisfactionRate: 1 },
        staff: { total: 1, satisfied: 1, satisfactionRate: 1 },
        parentMinOneViolation: false,
        staffUnsatisfiedAlert: false,
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
        ...BASE_INPUTS.requestInfo,
        materialParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
        parentMinOneViolation: true,
      },
    }
    const result1 = buildCamperAlerts(inputs)
    const result2 = buildCamperAlerts(inputs)
    expect(result1).toEqual(result2)
  })
})
