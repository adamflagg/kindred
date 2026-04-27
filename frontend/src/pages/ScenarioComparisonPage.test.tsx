import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { CamperPill } from './ScenarioComparisonPage'
import type { LockGroupSummary } from '../utils/scenarioComparisonUtils'

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
})
