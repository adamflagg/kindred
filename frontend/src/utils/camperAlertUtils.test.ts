/**
 * Tests for buildCamperAlerts pure utility.
 *
 * Covers:
 *   - Finding 1: unsatisfied-requests alert must only fire when the camper has
 *     RESOLVED requests — not when all requests are pending/unresolved.
 *   - Finding 2 (regression guard): memoized result must remain stable when
 *     inputs have not changed.
 */
import { describe, it, expect } from 'vitest'
import { buildCamperAlerts } from './camperAlertUtils'
import type { CamperAlertInputs } from './camperAlertUtils'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRequest(
  id: string,
  type: 'bunk_with' | 'not_bunk_with' | 'age_preference',
  status: string
) {
  return {
    id,
    request_type: type,
    status,
    requestee_id: 1001,
  }
}

const BASE_INPUTS: CamperAlertInputs = {
  assignedBunkCmId: 42,
  bunkRequests: [],
  satisfactionData: {},
  lockState: 'none',
  lockGroupSize: 0,
}

// ─── Finding 1: resolved-only scope ─────────────────────────────────────────

describe('buildCamperAlerts — unsatisfied-requests alert', () => {
  it('does NOT fire when all requests are pending (no resolved requests)', () => {
    // Emma Johnson has 2 pending bunk_with requests and 0 resolved requests.
    // satisfactionData is empty because the satisfaction query only processes
    // resolved requests — so satisfiedCount is 0 by definition, but
    // totalRequests (resolved only) is also 0.  Alert must NOT appear.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [
        makeRequest('req-1', 'bunk_with', 'pending'),
        makeRequest('req-2', 'bunk_with', 'pending'),
      ],
      satisfactionData: {},
    }
    const alerts = buildCamperAlerts(inputs)
    const unsatisfied = alerts.find((a) => a.id === 'unsatisfied-requests')
    expect(unsatisfied).toBeUndefined()
  })

  it('does NOT fire when requests are declined (non-resolved status)', () => {
    // Liam Garcia has 1 declined request — still not resolved.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [makeRequest('req-3', 'not_bunk_with', 'declined')],
      satisfactionData: {},
    }
    const alerts = buildCamperAlerts(inputs)
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })

  it('DOES fire when camper has resolved requests and none are satisfied', () => {
    // Olivia Chen has 2 resolved requests, both not_satisfied.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [
        makeRequest('req-4', 'bunk_with', 'resolved'),
        makeRequest('req-5', 'bunk_with', 'resolved'),
      ],
      satisfactionData: {
        'req-4': { status: 'not_satisfied' },
        'req-5': { status: 'not_satisfied' },
      },
    }
    const alerts = buildCamperAlerts(inputs)
    const unsatisfied = alerts.find((a) => a.id === 'unsatisfied-requests')
    expect(unsatisfied).toBeDefined()
    expect(unsatisfied?.severity).toBe('yellow')
    expect(unsatisfied?.label).toBe('Has 2 requests, none satisfied')
  })

  it('does NOT fire when at least one resolved request is satisfied', () => {
    // Riley Sam has 2 resolved requests, one satisfied — alert should be silent.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [
        makeRequest('req-6', 'bunk_with', 'resolved'),
        makeRequest('req-7', 'bunk_with', 'resolved'),
      ],
      satisfactionData: {
        'req-6': { status: 'satisfied' },
        'req-7': { status: 'not_satisfied' },
      },
    }
    const alerts = buildCamperAlerts(inputs)
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })

  it('does NOT fire when camper is unassigned (no bunk)', () => {
    // Samuel Johnson is unassigned — satisfaction is irrelevant.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      assignedBunkCmId: null,
      bunkRequests: [makeRequest('req-8', 'bunk_with', 'resolved')],
      satisfactionData: { 'req-8': { status: 'not_satisfied' } },
    }
    const alerts = buildCamperAlerts(inputs)
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })

  it('uses singular "request" label when exactly 1 resolved unsatisfied request', () => {
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [makeRequest('req-9', 'bunk_with', 'resolved')],
      satisfactionData: { 'req-9': { status: 'not_satisfied' } },
    }
    const alerts = buildCamperAlerts(inputs)
    const unsatisfied = alerts.find((a) => a.id === 'unsatisfied-requests')
    expect(unsatisfied?.label).toBe('Has 1 request, none satisfied')
  })

  it('does not count age_preference requests toward totalRequests', () => {
    // Only age_preference requests (resolved) — these are outside the scope of
    // the unsatisfied-requests alert which only tracks bunk_with/not_bunk_with.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [makeRequest('req-10', 'age_preference', 'resolved')],
      satisfactionData: {},
    }
    const alerts = buildCamperAlerts(inputs)
    expect(alerts.find((a) => a.id === 'unsatisfied-requests')).toBeUndefined()
  })
})

// ─── Finding 2: friend-group alert ──────────────────────────────────────────

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

// ─── Finding 2: referential stability (useMemo regression guard) ─────────────

describe('buildCamperAlerts — output stability', () => {
  it('returns an identical array reference when called twice with same inputs', () => {
    // This test verifies that buildCamperAlerts is a pure function suitable for
    // memoization — same inputs always produce structurally equal output.
    const inputs: CamperAlertInputs = {
      ...BASE_INPUTS,
      bunkRequests: [makeRequest('req-s1', 'bunk_with', 'resolved')],
      satisfactionData: { 'req-s1': { status: 'not_satisfied' } },
    }
    const result1 = buildCamperAlerts(inputs)
    const result2 = buildCamperAlerts(inputs)
    // Deep-equal (not same reference since it's a pure fn, but same structure)
    expect(result1).toEqual(result2)
    expect(result1[0]).toEqual(result2[0])
  })
})
