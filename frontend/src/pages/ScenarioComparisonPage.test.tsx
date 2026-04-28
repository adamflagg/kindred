import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach } from 'vitest'

import {
  CamperPill,
  ValidationScoreCard,
  type ValidationResult,
  type ValidationStatistics,
} from './ScenarioComparisonPage'
import type { LockGroupSummary } from '../utils/scenarioComparisonUtils'

function makeStats(overrides: Partial<ValidationStatistics> = {}): ValidationStatistics {
  return {
    total_requests: 0,
    satisfied_requests: 0,
    request_satisfaction_rate: 0,
    explicit_csv_requests: 0,
    satisfied_explicit_csv_requests: 0,
    explicit_csv_request_satisfaction_rate: 0,
    parent_requests: 0,
    satisfied_parent_requests: 0,
    parent_request_satisfaction_rate: 0,
    campers_with_unsatisfied_parent_requests: 0,
    staff_requests: 0,
    satisfied_staff_requests: 0,
    staff_request_satisfaction_rate: 0,
    campers_with_unsatisfied_staff_requests: 0,
    negative_request_violations: 0,
    assigned_campers: 0,
    unassigned_campers: 0,
    isolation_risks: 0,
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

// ─── Stage 2 parent-paramount: ValidationScoreCard badges ──────────────────

describe('ValidationScoreCard parent-paramount stats', () => {
  it('renders Parent Requests stat from parent_request_satisfaction_rate (not explicit_csv)', () => {
    const stats = makeStats({
      total_requests: 100,
      satisfied_requests: 50,
      request_satisfaction_rate: 0.5,
      // Legacy values (mixed staff notes — what the badge USED to read)
      explicit_csv_requests: 100,
      satisfied_explicit_csv_requests: 50,
      explicit_csv_request_satisfaction_rate: 0.5,
      // Honest parent-paramount values (what the badge SHOULD read)
      parent_requests: 10,
      satisfied_parent_requests: 9,
      parent_request_satisfaction_rate: 0.9,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    const parentLabel = screen.getByText(/^Parent Requests$/i)
    const parentSection = parentLabel.parentElement!
    const parentScope = within(parentSection)
    expect(parentScope.getByText('90%')).toBeInTheDocument()
    expect(parentScope.getByText('(9/10)')).toBeInTheDocument()
  })

  it('renders Staff Requests stat as a sibling badge', () => {
    const stats = makeStats({
      parent_requests: 10,
      satisfied_parent_requests: 10,
      parent_request_satisfaction_rate: 1.0,
      staff_requests: 50,
      satisfied_staff_requests: 25,
      staff_request_satisfaction_rate: 0.5,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="right" />)
    const staffLabel = screen.getByText(/^Staff Requests$/i)
    const staffSection = staffLabel.parentElement!
    const staffScope = within(staffSection)
    expect(staffScope.getByText('50%')).toBeInTheDocument()
    expect(staffScope.getByText('(25/50)')).toBeInTheDocument()
  })

  it('renders an All Requests stat alongside Parent and Staff', () => {
    const stats = makeStats({
      total_requests: 60,
      satisfied_requests: 35,
      request_satisfaction_rate: 35 / 60,
      parent_requests: 10,
      satisfied_parent_requests: 9,
      parent_request_satisfaction_rate: 0.9,
      staff_requests: 50,
      satisfied_staff_requests: 26,
      staff_request_satisfaction_rate: 0.52,
    })
    render(<ValidationScoreCard label="Test" validation={makeValidation(stats)} side="left" />)
    expect(screen.getByText(/^All Requests$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Parent Requests$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Staff Requests$/i)).toBeInTheDocument()
  })
})
