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
 * requestInfo now carries CamperSatisfaction flags
 * (parent_min_one_violation / staff_unsatisfied_alert). The alert gates
 * delegate entirely to those pre-computed booleans.
 */
import { describe, it, expect } from 'vitest'
import { buildCamperAlerts } from './camperAlertUtils'
import type { CamperAlertInputs } from './camperAlertUtils'

const EMPTY_COUNT = { satisfied: 0, total: 0 }

const BASE_INPUTS: CamperAlertInputs = {
  assignedBunkCmId: 42,
  requestInfo: {
    person_cm_id: 42,
    per_request: [],
    counted_totals: {
      material_parent: EMPTY_COUNT,
      staff: EMPTY_COUNT,
    },
    immaterial: EMPTY_COUNT,
    flags: {
      parent_min_one_violation: false,
      staff_unsatisfied_alert: false,
      has_any_counted_request: false,
    },
  },
  lockState: 'none',
  lockGroupSize: 0,
}

// ─── unsatisfied-parent-requests alert (parity with CamperCard parent triangle) ───

describe('buildCamperAlerts — unsatisfied-parent-requests alert', () => {
  it('fires when parent_min_one_violation is true', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          material_parent: { total: 2, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, parent_min_one_violation: true },
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-parent-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('orange')
    expect(alert?.label).toBe('2 parent requests, none satisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses singular "request" when material_parent.total === 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          material_parent: { total: 1, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, parent_min_one_violation: true },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')?.label).toBe(
      '1 parent request, none satisfied'
    )
  })

  it('does NOT fire when parent_min_one_violation is false (at least one satisfied)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          material_parent: { total: 3, satisfied: 1 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, parent_min_one_violation: false },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  it('does NOT fire when parent_min_one_violation is false (no parent requests at all)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 1, satisfied: 0 },
        },
        flags: {
          ...BASE_INPUTS.requestInfo.flags,
          staff_unsatisfied_alert: true,
          parent_min_one_violation: false,
        },
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
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          material_parent: { total: 5, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, parent_min_one_violation: true },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })

  // ── Materiality rule: immaterial-only campers must NOT trip parent alert ──
  it('socialize_with-only camper with unsatisfied immaterial does NOT trigger unsatisfied-parent-requests alert', () => {
    // parent_min_one_violation is false because only immaterial has requests.
    // The alert gate must delegate to the flag, not re-derive from slice totals.
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        immaterial: { total: 1, satisfied: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
          has_any_counted_request: false,
        },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
  })
})

// ─── unsatisfied-staff-requests alert (parity with CamperCard staff dot) ───

describe('buildCamperAlerts — unsatisfied-staff-requests alert', () => {
  it('fires when staff_unsatisfied_alert is true', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 1, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, staff_unsatisfied_alert: true },
      },
    })
    const alert = alerts.find((a) => a.id === 'unsatisfied-staff-requests')
    expect(alert).toBeDefined()
    expect(alert?.severity).toBe('amber')
    expect(alert?.label).toBe('1 staff request, 1 unsatisfied')
    expect(alert?.requestRelated).toBe(true)
  })

  it('uses plural "requests" when staff.total > 1', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 3, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, staff_unsatisfied_alert: true },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')?.label).toBe(
      '3 staff requests, 3 unsatisfied'
    )
  })

  it('shows correct unsatisfied count when partially satisfied (e.g., 3 total, 1 satisfied)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 3, satisfied: 1 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, staff_unsatisfied_alert: true },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')?.label).toBe(
      '3 staff requests, 2 unsatisfied'
    )
  })

  it('fires even when parent is fully satisfied', () => {
    // User wants the complete "what didn't land" picture: staff alert is
    // independent of parent state. Parent satisfied + staff unsat → only the
    // staff alert appears (no parent alert).
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          material_parent: { total: 1, satisfied: 1 },
          staff: { total: 1, satisfied: 0 },
        },
        flags: {
          ...BASE_INPUTS.requestInfo.flags,
          parent_min_one_violation: false,
          staff_unsatisfied_alert: true,
        },
      },
    })
    expect(alerts.find((a) => a.id === 'unsatisfied-parent-requests')).toBeUndefined()
    expect(alerts.find((a) => a.id === 'unsatisfied-staff-requests')).toBeDefined()
  })

  it('does NOT fire when staff_unsatisfied_alert is false (at least one satisfied)', () => {
    const alerts = buildCamperAlerts({
      ...BASE_INPUTS,
      requestInfo: {
        ...BASE_INPUTS.requestInfo,
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 2, satisfied: 1 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, staff_unsatisfied_alert: false },
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
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          staff: { total: 3, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, staff_unsatisfied_alert: true },
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
        counted_totals: {
          material_parent: { total: 1, satisfied: 0 },
          staff: { total: 1, satisfied: 0 },
        },
        flags: {
          ...BASE_INPUTS.requestInfo.flags,
          parent_min_one_violation: true,
          staff_unsatisfied_alert: true,
        },
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
        counted_totals: {
          material_parent: { total: 1, satisfied: 1 },
          staff: { total: 1, satisfied: 1 },
        },
        flags: {
          ...BASE_INPUTS.requestInfo.flags,
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
        },
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
        counted_totals: {
          ...BASE_INPUTS.requestInfo.counted_totals,
          material_parent: { total: 1, satisfied: 0 },
        },
        flags: { ...BASE_INPUTS.requestInfo.flags, parent_min_one_violation: true },
      },
    }
    const result1 = buildCamperAlerts(inputs)
    const result2 = buildCamperAlerts(inputs)
    expect(result1).toEqual(result2)
  })
})
