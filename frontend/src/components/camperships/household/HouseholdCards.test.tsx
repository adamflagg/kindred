import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { householdPage, SPLIT_PAGE, TIED_PAGE } from './householdFixtures'
import { HouseholdCards } from './HouseholdCards'
import { stripeOf } from './householdStyles'

describe('HouseholdCards (§6.3 item 2; D32)', () => {
  it('chips carry the short name when there is one, else the family name (O3)', () => {
    const [a, b] = SPLIT_PAGE.households
    render(
      <HouseholdCards
        page={{
          ...SPLIT_PAGE,
          households: [
            { ...a!, short_name: 'Johnsons' },
            { ...b!, short_name: '' },
          ],
        }}
      />
    )
    expect(screen.getByText('1 · Johnsons')).toBeInTheDocument()
    expect(screen.getByText('2 · The Garcia Family')).toBeInTheDocument()
  })

  // #3019: the server builds the short name from the household's adults, so two surnames come
  // joined ("Garcia & Chen"). The chip draws it as sent; a blank one still falls back.
  it('chips draw a short name built from two adults as sent', () => {
    const [a, b] = SPLIT_PAGE.households
    render(
      <HouseholdCards
        page={{
          ...SPLIT_PAGE,
          households: [
            { ...a!, short_name: 'Garcia & Chen' },
            { ...b!, short_name: '' },
          ],
        }}
      />
    )
    expect(screen.getByText('1 · Garcia & Chen')).toBeInTheDocument()
    expect(screen.getByText('2 · The Garcia Family')).toBeInTheDocument()
  })

  // #3025 (owner, 2026-10-05): a card names its household by the server's label, the adults' names
  // alone, with the tie-break muted after it when two households read the same. The chip is unchanged.
  it('names each card by its label in bold, the tie-break muted after it, the chip unchanged', () => {
    render(<HouseholdCards page={TIED_PAGE} />)
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('Pat Garcia')).toHaveClass('font-bold')
    // Owner pass 3 (V3): a city tie-break the card's own address line already says is dropped.
    expect(within(johnson).queryByText('Riverside, CA')).toBeNull()
    expect(within(johnson).getByText('household 1000001 · Riverside, CA')).toBeInTheDocument()
    expect(within(garcia).getByText('Pat Garcia')).toHaveClass('font-bold')
    expect(within(garcia).getByText('#1000003')).toHaveClass('text-muted-foreground')
    // The label replaces the adults line: Samuel Johnson is named once, in the contact line.
    expect(within(johnson).queryByText('Samuel Johnson')).toBeNull()
  })

  it("keeps a city tie-break the card's address line does not say", () => {
    const [a, b] = TIED_PAGE.households
    render(
      <HouseholdCards
        page={{
          ...TIED_PAGE,
          households: [{ ...a!, city: '' }, b!],
        }}
      />
    )
    const johnson = screen
      .getByText('1 · The Johnson Family')
      .closest('[data-household]') as HTMLElement
    expect(within(johnson).getByText('Riverside, CA')).toHaveClass('text-muted-foreground')
  })

  it('draws no tie-break when the label is unique', () => {
    const [a, b] = SPLIT_PAGE.households
    render(
      <HouseholdCards
        page={{
          ...SPLIT_PAGE,
          households: [
            { ...a!, label: 'Samuel Johnson', label_tiebreak: '' },
            { ...b!, label: 'Liam & Olivia Garcia', label_tiebreak: '' },
          ],
        }}
      />
    )
    const garcia = screen
      .getByText('2 · The Garcia Family')
      .closest('[data-household]') as HTMLElement
    expect(within(garcia).getByText('Liam & Olivia Garcia')).toHaveClass('font-bold')
    expect(within(garcia).queryByText(/#1000003/)).toBeNull()
  })

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
    // Decision 2 (owner 2026-10-05): CampMinder has no household record, only the camper's Person
    // record, which each request card links; a household card links nothing.
    expect(within(johnson).queryByRole('link')).toBeNull()
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
    // Design language §9: emerald is retired; the positive pill is the forest ok tone.
    expect(within(johnson).getByText('✓ confirmed')).toHaveClass('text-forest-800')
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

// Conformance gap 3 (owner 10-10): chip 3 is forest now, and each card's stripe matches its chip (D32).
describe('the household stripe', () => {
  it('is forest on the third household, as its chip is: emerald is retired (design language §9)', () => {
    expect(stripeOf(3)).toContain('--color-forest-')
    expect(stripeOf(3)).not.toContain('emerald')
  })
})
