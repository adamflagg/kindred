import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach } from 'vitest'

import {
  CamperPill,
  ValidationScoreCard,
  ValidationSection,
  getExportButtonLabel,
  getExportButtonTitle,
  type ValidationResult,
  type ValidationStatistics,
} from './ScenarioComparisonPage'
import type { LockGroupSummary } from '../utils/scenarioComparisonUtils'

function makeStats(overrides: Partial<ValidationStatistics> = {}): ValidationStatistics {
  return {
    total_requests: 0,
    satisfied_requests: 0,
    request_satisfaction_rate: 0,
    material_parent_requests: 0,
    satisfied_material_parent_requests: 0,
    material_parent_request_satisfaction_rate: 0,
    campers_with_unsatisfied_material_parent_requests: 0,
    best_effort_parent_requests: 0,
    satisfied_best_effort_parent_requests: 0,
    best_effort_parent_request_satisfaction_rate: 0,
    staff_requests: 0,
    satisfied_staff_requests: 0,
    staff_request_satisfaction_rate: 0,
    campers_with_unsatisfied_staff_requests: 0,
    negative_request_violations: 0,
    assigned_campers: 0,
    unassigned_campers: 0,
    isolation_risks: 0,
    mp_campers_total: 0,
    mp_campers_with_at_least_one_satisfied: 0,
    mp_campers_with_all_satisfied: 0,
    ...overrides,
  }
}

function makeValidation(stats: ValidationStatistics): ValidationResult {
  return { statistics: stats, issues: [] }
}

afterEach(cleanup)

const liam = {
  personId: 'p1',
  personCmId: 1001,
  name: 'Liam Garcia',
  firstName: 'Liam',
  lastName: 'Garcia',
  age: 11,
  grade: 5,
  gender: 'male',
  bunkId: 'b1',
  bunkName: 'Bunk A',
  bunkPlanId: 'plan1',
}

const olivia = {
  ...liam,
  personId: 'p2',
  personCmId: 1002,
  name: 'Olivia Chen',
  firstName: 'Olivia',
  lastName: 'Chen',
}

const emma = {
  ...liam,
  personId: 'p3',
  personCmId: 1003,
  name: 'Emma Johnson',
  firstName: 'Emma',
  lastName: 'Johnson',
}

const camperById = new Map([
  [1001, liam],
  [1002, olivia],
  [1003, emma],
])

const palsGroup: LockGroupSummary = {
  id: 'g1',
  name: 'Pals',
  color: '#ff0000',
  memberCmIds: [1001, 1002, 1003],
}

function getPillRoot(): HTMLElement {
  return screen.getByTestId('camper-pill')
}

describe('FriendGroupPopover (CamperPill hover)', () => {
  it('does not render a popover when the hovered camper is not in any friend group', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={undefined} camperById={camperById} />
    )
    fireEvent.mouseEnter(getPillRoot())
    expect(screen.queryByTestId('friend-group-popover')).toBeNull()
  })

  it('opens a popover with header + member rows on mouseenter of a grouped pill', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={palsGroup} camperById={camperById} />
    )
    fireEvent.mouseEnter(getPillRoot())

    const popover = screen.getByTestId('friend-group-popover')
    expect(popover).toHaveTextContent('Pals')
    const memberRows = popover.querySelectorAll('[data-testid="friend-group-member"]')
    expect(memberRows.length).toBe(3)
    const memberTexts = Array.from(memberRows).map((el) => el.textContent)
    expect(memberTexts).toEqual(['Emma Johnson', 'Liam Garcia', 'Olivia Chen'])
  })

  it('closes the popover on mouseleave', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={palsGroup} camperById={camperById} />
    )
    const root = getPillRoot()
    fireEvent.mouseEnter(root)
    expect(screen.getByTestId('friend-group-popover')).toBeInTheDocument()
    fireEvent.mouseLeave(root)

    expect(screen.queryByTestId('friend-group-popover')).toBeNull()
  })

  it('renders members with no matching CamperAssignment as <unknown camper>', () => {
    const groupWithGhost: LockGroupSummary = {
      ...palsGroup,
      memberCmIds: [1001, 9999],
    }
    render(
      <CamperPill camper={liam} status="unchanged" group={groupWithGhost} camperById={camperById} />
    )
    fireEvent.mouseEnter(getPillRoot())
    const popover = screen.getByTestId('friend-group-popover')
    expect(popover).toHaveTextContent('<unknown camper>')
    expect(popover).toHaveTextContent('Liam Garcia')
  })

  it('renders header + 1 row when group has a single member', () => {
    const singleGroup: LockGroupSummary = { ...palsGroup, memberCmIds: [1001] }
    render(
      <CamperPill camper={liam} status="unchanged" group={singleGroup} camperById={camperById} />
    )
    fireEvent.mouseEnter(getPillRoot())
    const popover = screen.getByTestId('friend-group-popover')
    expect(popover).toHaveTextContent('Pals')
    const memberRows = popover.querySelectorAll('[data-testid="friend-group-member"]')
    expect(memberRows.length).toBe(1)
    expect(memberRows[0]?.textContent).toBe('Liam Garcia')
  })

  it('renders the popover via a portal (attached to document.body) so it escapes overflow-hidden bunk cards', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={palsGroup} camperById={camperById} />
    )
    fireEvent.mouseEnter(getPillRoot())
    const popover = screen.getByTestId('friend-group-popover')
    expect(popover.parentElement).toBe(document.body)
    expect(popover.closest('[data-testid="camper-pill"]')).toBeNull()
  })
})

// Legacy explicit_csv_* aggregate fields were removed from
// ValidationStatistics. Guard against accidental re-introduction.

describe('explicit_csv_* fields are removed', () => {
  it('makeStats does not produce legacy explicit_csv_* keys', () => {
    const stats = makeStats()
    const keys = Object.keys(stats)
    expect(keys).not.toContain('explicit_csv_requests')
    expect(keys).not.toContain('satisfied_explicit_csv_requests')
    expect(keys).not.toContain('explicit_csv_request_satisfaction_rate')
  })
})

// ─── Stage 3a parent-paramount: ValidationScoreCard — staff tile (TG-6 updated) ──
// Note: Material Parent and Best-Effort Parent tiles were replaced in TG-6 with
// camper-level two-tier MP coverage tiles. Staff tile relabeled to "Staff requests".

describe('ValidationScoreCard parent-paramount stats', () => {
  it('renders Staff requests stat (relabeled from "Staff Requests")', () => {
    const stats = makeStats({
      staff_requests: 50,
      satisfied_staff_requests: 25,
      staff_request_satisfaction_rate: 0.5,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="right" />)
    const staffLabel = screen.getByText(/^staff requests$/i)
    const staffSection = staffLabel.parentElement!
    const staffScope = within(staffSection)
    expect(staffScope.getByText('50%')).toBeInTheDocument()
    expect(staffScope.getByText('(25/50)')).toBeInTheDocument()
  })

  it('does not render NaN% when rate/camper fields are missing from a stale payload', () => {
    // TG-6 rate fields are typed as required `number`, but during rollout
    // (or with a stale cached scenario response) the runtime payload can
    // still arrive without them. Guard against NaN rendering.
    const stats = makeStats({
      total_requests: 100,
      satisfied_requests: 50,
    })
    // @ts-expect-error — deliberately violating the type contract to simulate
    // a stale runtime payload, mirroring the real risk during rollout.
    delete stats.request_satisfaction_rate
    // @ts-expect-error — see above
    delete stats.staff_request_satisfaction_rate
    // @ts-expect-error — see above
    delete stats.mp_campers_total
    // @ts-expect-error — see above
    delete stats.mp_campers_with_at_least_one_satisfied
    // @ts-expect-error — see above
    delete stats.mp_campers_with_all_satisfied

    const { container } = render(
      <ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />
    )
    expect(container.textContent).not.toContain('NaN')
    // Score card shows at least 2 zero-percent tiles (at-least-one + all-requests)
    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(2)
  })

  it('renders camper-level coverage tiles and staff tile (not legacy combo tiles)', () => {
    const stats = makeStats({
      mp_campers_total: 10,
      mp_campers_with_at_least_one_satisfied: 9,
      mp_campers_with_all_satisfied: 6,
      staff_requests: 50,
      satisfied_staff_requests: 26,
      staff_request_satisfaction_rate: 0.52,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/at least one request/i)).toBeInTheDocument()
    expect(screen.getByText(/^all requests$/i)).toBeInTheDocument()
    expect(screen.getByText(/^staff requests$/i)).toBeInTheDocument()
    // Old tiles must not appear
    expect(screen.queryByText(/^material parent$/i)).toBeNull()
    expect(screen.queryByText(/^best-effort parent$/i)).toBeNull()
  })
})

// ─── TG-6: two-tier camper-level MP coverage tiles ──────────────────────────

describe('ValidationScoreCard TG-6: two-tier MP coverage + relabels', () => {
  it('renders "At least one request" tile from mp_campers_with_at_least_one_satisfied / mp_campers_total', () => {
    // 3 MP campers total, 2 have at least one satisfied → 67%
    const stats = makeStats({
      mp_campers_total: 3,
      mp_campers_with_at_least_one_satisfied: 2,
      mp_campers_with_all_satisfied: 1,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/at least one request/i)).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText(/2\s*\/\s*3 campers/)).toBeInTheDocument()
  })

  it('renders "All requests" tile from mp_campers_with_all_satisfied / mp_campers_total', () => {
    // 3 MP campers total, 1 has all satisfied → 33%
    const stats = makeStats({
      mp_campers_total: 3,
      mp_campers_with_at_least_one_satisfied: 2,
      mp_campers_with_all_satisfied: 1,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/^all requests$/i)).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText(/1\s*\/\s*3 campers/)).toBeInTheDocument()
  })

  it('shows 0% when mp_campers_total is 0 (no division by zero)', () => {
    const stats = makeStats({
      mp_campers_total: 0,
      mp_campers_with_at_least_one_satisfied: 0,
      mp_campers_with_all_satisfied: 0,
    })
    const { container } = render(
      <ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />
    )
    expect(container.textContent).not.toContain('NaN')
  })

  it('labels "Violations" tile as "Families to call"', () => {
    const stats = makeStats({ negative_request_violations: 3 })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/families to call/i)).toBeInTheDocument()
    expect(screen.queryByText(/^violations$/i)).toBeNull()
  })

  it('labels isolation tile as "Isolated campers" (not "Isolation Risks")', () => {
    const stats = makeStats({ isolation_risks: 2 })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/isolated campers/i)).toBeInTheDocument()
    expect(screen.queryByText(/^isolation risks$/i)).toBeNull()
  })

  it('labels staff tile as "Staff requests" (not "Staff Requests" with capital R)', () => {
    const stats = makeStats({
      staff_requests: 10,
      satisfied_staff_requests: 8,
      staff_request_satisfaction_rate: 0.8,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    // Case-insensitive: staff requests label present
    expect(screen.getByText(/^staff requests$/i)).toBeInTheDocument()
  })

  it('does NOT render synthetic "All Requests" MP+staff combo tile', () => {
    const stats = makeStats({
      material_parent_requests: 10,
      satisfied_material_parent_requests: 8,
      staff_requests: 20,
      satisfied_staff_requests: 15,
      mp_campers_total: 5,
      mp_campers_with_at_least_one_satisfied: 4,
      mp_campers_with_all_satisfied: 3,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    // The old synthetic "All Requests" tile showed a count like "(23/30)" — that combo should be gone.
    // We verify the old combined total (10+20=30) does NOT appear as a denominator.
    expect(screen.queryByText('(23/30)')).toBeNull()
  })

  it('does NOT render "Material Parent" (request-level) tile', () => {
    const stats = makeStats({
      material_parent_requests: 10,
      satisfied_material_parent_requests: 9,
      material_parent_request_satisfaction_rate: 0.9,
      mp_campers_total: 5,
      mp_campers_with_at_least_one_satisfied: 4,
      mp_campers_with_all_satisfied: 3,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.queryByText(/^material parent$/i)).toBeNull()
  })

  it('does NOT render "Best-Effort Parent" muted tile', () => {
    const stats = makeStats({
      best_effort_parent_requests: 5,
      satisfied_best_effort_parent_requests: 3,
      best_effort_parent_request_satisfaction_rate: 0.6,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.queryByText(/^best-effort parent$/i)).toBeNull()
  })
})

// ─── CamperPill friend-group dot (Issue #1060 contract) ──────────────────────
//
// Locked groups are scenario-specific — production side has no locked groups
// by design. These tests pin the exact rendering contract so the "no dot on
// production" behaviour is never mistaken for a bug.
describe('CamperPill friend-group dot rendering (Issue #1060)', () => {
  it('renders no dot when group prop is undefined (production side)', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={undefined} camperById={camperById} />
    )
    expect(screen.queryByRole('img', { hidden: true })).toBeNull()
    // Mirror the presence assertion's role+name+hidden pattern (line 318) so
    // both ends of the contract use the same accessibility tree query.
    // `queryByRole('generic')` filters non-interactive generics by default;
    // the dot is a bare <span aria-label="..."> with role="generic", so the
    // hidden:true escape is required to match the presence query strategy
    // (scan-it Finding #5).
    expect(screen.queryByRole('generic', { hidden: true, name: /friend group/i })).toBeNull()
  })

  it('renders a coloured dot when group has a color (saved-scenario side)', () => {
    render(
      <CamperPill camper={liam} status="unchanged" group={palsGroup} camperById={camperById} />
    )
    const dot = screen.getByRole('generic', { hidden: true, name: /friend group: pals/i })
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveStyle({ backgroundColor: '#ff0000' })
  })

  it('renders no dot when group.color is empty string', () => {
    const groupNoColor: LockGroupSummary = { ...palsGroup, color: '' }
    render(
      <CamperPill camper={liam} status="unchanged" group={groupNoColor} camperById={camperById} />
    )
    // Mirror the presence assertion's role+name+hidden pattern (line 318).
    // See note on the previous absence assertion (Finding #5).
    expect(screen.queryByRole('generic', { hidden: true, name: /friend group/i })).toBeNull()
  })
})

// ─── #1003: Export button label/title should reflect the active changeFilter ──

describe('getExportButtonLabel', () => {
  it('returns "Export Moved" when changeFilter is "moved"', () => {
    expect(getExportButtonLabel('moved')).toBe('Export Moved')
  })

  it('returns "Export All" when changeFilter is "all"', () => {
    expect(getExportButtonLabel('all')).toBe('Export All')
  })
})

describe('getExportButtonTitle', () => {
  it('returns moved tooltip when changeFilter is "moved"', () => {
    expect(getExportButtonTitle('moved')).toBe('Export moved campers to CSV')
  })

  it('returns all tooltip when changeFilter is "all"', () => {
    expect(getExportButtonTitle('all')).toBe('Export all campers to CSV')
  })
})

// ─── Issue #1083 + #1064: ValidationSection QueryGuard four-state coverage ───

describe('ValidationSection — QueryGuard four states', () => {
  const leftStats = makeStats({
    material_parent_requests: 10,
    satisfied_material_parent_requests: 8,
    material_parent_request_satisfaction_rate: 0.8,
  })
  const leftValidation = makeValidation(leftStats)

  it('loading state: renders loading spinner, not score cards', () => {
    render(
      <ValidationSection
        isLoading={true}
        error={null}
        leftValidation={undefined}
        rightValidation={undefined}
        leftScenarioName="Before"
        rightScenarioName="After"
      />
    )
    // QueryGuard loading renders a spinner; score cards must not appear
    expect(screen.queryByText('Loading validation...')).toBeNull()
    expect(screen.queryByText('Validation Details')).toBeNull()
    // Loading indicator must be present (spinner text or aria)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('error state: renders error message, not score cards', () => {
    const error = new Error('Network error')
    render(
      <ValidationSection
        isLoading={false}
        error={error}
        leftValidation={undefined}
        rightValidation={undefined}
        leftScenarioName="Before"
        rightScenarioName="After"
      />
    )
    expect(screen.queryByText('Loading validation...')).toBeNull()
    expect(screen.queryByText('Validation Details')).toBeNull()
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument()
  })

  it('empty state: renders empty message when both validations are null', () => {
    render(
      <ValidationSection
        isLoading={false}
        error={null}
        leftValidation={null}
        rightValidation={null}
        leftScenarioName="Before"
        rightScenarioName="After"
      />
    )
    expect(screen.queryByText('Loading validation...')).toBeNull()
    expect(screen.queryByText('Validation Details')).toBeNull()
    expect(screen.getByText(/No validation data available/i)).toBeInTheDocument()
  })

  it('success state: renders Validation Details card with both score cards', () => {
    render(
      <ValidationSection
        isLoading={false}
        error={null}
        leftValidation={leftValidation}
        rightValidation={leftValidation}
        leftScenarioName="Before"
        rightScenarioName="After"
      />
    )
    expect(screen.getByText('Validation Details')).toBeInTheDocument()
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    // Score cards should show stat tiles, not "Loading validation..."
    expect(screen.queryByText('Loading validation...')).toBeNull()
  })
})

// ─── Issue #1064: ValidationScoreCard null guard removed ─────────────────────

describe('ValidationScoreCard — no longer shows Loading placeholder', () => {
  it('does not render "Loading validation..." text when validation is valid', () => {
    const stats = makeStats({ material_parent_request_satisfaction_rate: 0.75 })
    render(
      <ValidationScoreCard label="Test Scenario" validation={makeValidation(stats)} side="left" />
    )
    expect(screen.queryByText('Loading validation...')).toBeNull()
  })
})

// ─── Asymmetric data: left resolves, right is null ────────────────────────────

describe('ValidationSection — asymmetric data (left valid, right null)', () => {
  it('shows Validation Details heading and "Not available" placeholder for the right card', () => {
    const stats = makeStats({
      material_parent_requests: 5,
      satisfied_material_parent_requests: 5,
      material_parent_request_satisfaction_rate: 1.0,
    })
    const leftValidation = makeValidation(stats)

    render(
      <ValidationSection
        isLoading={false}
        error={null}
        leftValidation={leftValidation}
        rightValidation={null}
        leftScenarioName="Left"
        rightScenarioName="Right"
      />
    )

    // Success branch must be entered (heading visible)
    expect(screen.getByText('Validation Details')).toBeInTheDocument()

    // Right card should show "Not available" placeholder, not "Loading validation..."
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText('Loading validation...')).toBeNull()

    // Left scenario name should be visible
    expect(screen.getByText('Left')).toBeInTheDocument()
  })
})
