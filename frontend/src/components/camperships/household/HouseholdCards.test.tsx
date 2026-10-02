import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { householdPage, SPLIT_PAGE } from './householdFixtures'
import { HouseholdCards } from './HouseholdCards'

describe('HouseholdCards (§6.3 item 2; D32)', () => {
  it('draws nothing for one household: its details are in the band', () => {
    const { container } = render(<HouseholdCards page={householdPage()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws a card per household, chip first, with its money and its shares', () => {
    render(<HouseholdCards page={SPLIT_PAGE} />)
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('opened from')).toBeInTheDocument()
    expect(within(johnson).getByText('Samuel Johnson')).toBeInTheDocument()
    expect(
      within(johnson).getByText(/household 1000001 · 555-0100 · test@example.com · Riverside, CA/)
    ).toBeInTheDocument()
    expect(
      within(johnson).getByRole('link', { name: 'Open Emma Johnson in CampMinder ↗' })
    ).toHaveAttribute('href', 'https://system.campminder.com/ui/person/Record#1000002:2027')
    expect(within(johnson).getByText('50% of Emma')).toBeInTheDocument()
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(within(garcia).queryByText('opened from')).toBeNull()
    // A household that only pays a share has no camper here, so no CampMinder link.
    expect(within(garcia).queryByRole('link')).toBeNull()
    expect(within(garcia).getByText('$710')).toBeInTheDocument()
  })
})
