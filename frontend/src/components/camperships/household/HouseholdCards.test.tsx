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

  it('shows each card its Decided and Posted labels, its states line and its stripe', () => {
    const page = {
      ...SPLIT_PAGE,
      households: [
        {
          ...SPLIT_PAGE.households[0]!,
          money: {
            decided: 710,
            posted: 500,
            in_campminder: 290,
            states: [{ status: 'short' as const, count: 1, gap: -210 }],
          },
        },
        SPLIT_PAGE.households[1]!,
      ],
    }
    render(<HouseholdCards page={page} />)
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('1 short $210')).toBeInTheDocument()
    expect(within(johnson).getByText('Decided', { exact: false })).toHaveTextContent('Decided $710')
    expect(within(johnson).getByText('Posted', { exact: false })).toHaveTextContent('Posted $500')
    expect(johnson).toHaveClass('border-l-sky-400')
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(garcia).toHaveClass('border-l-purple-400')
    expect(within(garcia).queryByText(/short/)).toBeNull()
  })
})
