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
    // D15: adults in bold on their own line, then "household · city", then "first adult · phone · email".
    expect(within(johnson).getByText('Samuel Johnson')).toHaveClass('font-bold')
    expect(within(johnson).getByText('household 1000001 · Riverside, CA')).toBeInTheDocument()
    expect(
      within(johnson).getByText('Samuel Johnson · 555-0100 · test@example.com')
    ).toBeInTheDocument()
    // N7: "Household", CampMinder's link, opening its first camper's record (Decision 20).
    const link = within(johnson).getByRole('link', { name: 'Household' })
    expect(link).toHaveAttribute(
      'href',
      'https://system.campminder.com/ui/person/Record#1000002:2027'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(johnson).getByText('50% of Emma')).toBeInTheDocument()
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(within(garcia).queryByText('opened from')).toBeNull()
    // A household that only pays a share has no camper here, so no CampMinder link.
    expect(within(garcia).queryByRole('link')).toBeNull()
    expect(within(garcia).getByText('$710')).toBeInTheDocument()
  })

  it('shows each card its Decided and Posted labels, its confirmation pills and its stripe', () => {
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
    // D14: what CampMinder shows, beside the amber gap pill.
    expect(within(johnson).getByText('CampMinder shows $290')).toBeInTheDocument()
    expect(within(johnson).getByText('short $210')).toHaveClass('bg-amber-100')
    expect(within(johnson).getByText('Decided', { exact: false })).toHaveTextContent('Decided $710')
    expect(within(johnson).getByText('Posted', { exact: false })).toHaveTextContent('Posted $500')
    // D3: the inset stripe (a box-shadow), not a curved border.
    expect(johnson.className).toContain('inset_4px_0_0_var(--color-sky-400)')
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(garcia.className).toContain('inset_4px_0_0_var(--color-purple-400)')
    expect(within(garcia).queryByText(/short/)).toBeNull()
  })
  it('confirms a household as a pill, and draws the card still, 1px at radius 12 (D2, D14)', () => {
    const page = {
      ...SPLIT_PAGE,
      households: [
        {
          ...SPLIT_PAGE.households[0]!,
          money: {
            decided: 900,
            posted: 900,
            in_campminder: 900,
            states: [{ status: 'confirmed' as const, count: 1, gap: 0 }],
          },
        },
        SPLIT_PAGE.households[1]!,
      ],
    }
    render(<HouseholdCards page={page} />)
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('✓ confirmed')).toHaveClass('bg-emerald-100')
    expect(johnson).not.toHaveClass('card-lodge')
    expect(johnson).toHaveClass('rounded-xl', 'border')
  })

  it('drops a missing contact field and its separator (D15)', () => {
    const page = {
      ...SPLIT_PAGE,
      households: [
        { ...SPLIT_PAGE.households[0]!, adults: [], phone: '', emails: [], city: '' },
        SPLIT_PAGE.households[1]!,
      ],
    }
    render(<HouseholdCards page={page} />)
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('household 1000001')).toBeInTheDocument()
    expect(within(johnson).queryByText(/·\s*$/)).toBeNull()
  })
})
