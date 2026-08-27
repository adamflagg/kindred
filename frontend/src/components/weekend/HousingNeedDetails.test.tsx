import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HousingNeedDetails } from './HousingNeedDetails'

const medical = {
  bathroom_explain: 'Grandmother cannot manage the walk at night.',
  accommodation_explain: '',
  cpap_info: '',
  special_needs_info: '',
  allergy_info: 'Tree nut',
  dietary_info: 'Vegetarian',
  physician_info: 'On file',
  additional_info: 'A birthday on Saturday',
  allergy_gate: 'yes',
  dietary_gate: 'yes',
  special_needs_gate: 'no',
  physician_gate: 'yes',
  cpap_gate: 'no',
}

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: medical, isLoading: false, error: null }),
}))
let canRead = true
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => canRead }),
}))

function party(flags: Record<string, boolean>) {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    children: [],
    adults: [],
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      needs_fridge: false,
      needs_step_free: false,
      has_infant: false,
      has_child_under_two: false,
      ...flags,
    },
  } as never
}

describe('HousingNeedDetails', () => {
  it('renders one row per need, carrying the family words', () => {
    canRead = true
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.getByText(/Grandmother cannot manage/)).toBeInTheDocument()
  })

  it('renders no gate pill', () => {
    canRead = true
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.queryByText('Yes')).not.toBeInTheDocument()
    expect(screen.queryByText('No')).not.toBeInTheDocument()
  })

  it('cuts allergies, dietary, physician and additional entirely', () => {
    canRead = true
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.queryByText(/Tree nut/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vegetarian/)).not.toBeInTheDocument()
    expect(screen.queryByText(/On file/)).not.toBeInTheDocument()
    expect(screen.queryByText(/birthday on Saturday/)).not.toBeInTheDocument()
  })

  it('keeps the need row but drops its words without bunking.manage', () => {
    canRead = false
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.queryByText(/Grandmother cannot manage/)).not.toBeInTheDocument()
  })

  it('renders nothing for a household that asked for nothing', () => {
    canRead = true
    const { container } = render(
      <HousingNeedDetails party={party({})} householdCmId={1000001} year={2026} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('promotes the blocker above everything', () => {
    canRead = true
    render(
      <HousingNeedDetails
        party={party({
          needs_accommodation: true,
          accommodation_is_mandatory: true,
          needs_private_bathroom: true,
        })}
        householdCmId={1000001}
        year={2026}
      />
    )
    const rows = screen.getAllByTestId(/^need-row-/)
    expect(rows[0]).toHaveAttribute('data-testid', 'need-row-blocker')
  })
})
