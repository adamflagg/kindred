/**
 * One household chip in a grid cell (design-language rule 21): the camper's name truncates, the chip beside it never
 * drops (unlike AidNameChips' +N) and links to the household. A camper CampMinder links to no household gets a dashed
 * "no household" chip that is not a link. Fictional names.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidHouseholdChip, AidNameWithChip } from './NameChips'

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>)

describe('AidHouseholdChip', () => {
  it('is one link to the household, with ⌂ and the household label, in the name-chip dress (22px, 12px, primary ink)', () => {
    wrap(
      <AidHouseholdChip
        label="Mia & Noah Johnson"
        href="/aid/household/h1"
        title="Open the Mia & Noah Johnson household"
      />
    )
    const link = screen.getByRole('link', { name: /Mia & Noah Johnson/ })
    expect(link).toHaveAttribute('href', '/aid/household/h1')
    expect(link).toHaveAttribute('title', 'Open the Mia & Noah Johnson household')
    expect(link).toHaveClass(
      'h-[22px]',
      'text-[12px]',
      'text-primary',
      'rounded-full',
      'flex-none',
      'whitespace-nowrap'
    )
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('never drops: no measuring, no "+N", whatever the room', () => {
    wrap(<AidHouseholdChip label="Wei & Lin Chen" href="/aid/household/h2" />)
    expect(screen.getByRole('link')).toBeVisible()
    expect(screen.queryByTestId('chips-more')).toBeNull()
  })

  it('titles itself with its label when given no title (§8)', () => {
    wrap(<AidHouseholdChip label="Wei & Lin Chen" href="/aid/household/h2" />)
    expect(screen.getByRole('link')).toHaveAttribute('title', 'Wei & Lin Chen')
  })

  it('takes at most 45% of the cell: a long label cuts with an ellipsis, the FULL label in its native title', () => {
    const label = 'Alexandra & Maximilian Sam-Lindqvist-Okafor'
    wrap(<AidHouseholdChip label={label} href="/aid/household/h3" />)
    const link = screen.getByRole('link')
    // flex-none with a max-width: its own width up to 45%, and min-w-0 so that cap can win over its content
    expect(link).toHaveClass('max-w-[45%]', 'min-w-0', 'flex-none')
    expect(link).toHaveAttribute('title', label)
    const words = screen.getByText(label)
    expect(words).not.toBe(link) // the label is its own box, so it is what cuts (the ⌂ stays)
    expect(words).toHaveClass('min-w-0', 'truncate')
  })

  it('keeps the full label in its title when the page titles it', () => {
    const label = 'Alexandra & Maximilian Sam-Lindqvist-Okafor'
    wrap(
      <AidHouseholdChip
        label={label}
        href="/aid/household/h3"
        title={`Open the ${label} household`}
      />
    )
    expect(screen.getByRole('link').getAttribute('title')).toContain(label)
  })

  it('with no household is a dashed muted "no household" chip that is not a link, its reason in its title', () => {
    wrap(<AidHouseholdChip href={null} />)
    expect(screen.queryByRole('link')).toBeNull()
    const chip = screen.getByText('no household')
    expect(chip).toHaveClass('border-dashed', 'text-muted-foreground', 'cursor-help', 'h-[22px]')
    expect(chip).not.toHaveClass('text-primary')
    expect(chip.getAttribute('title')).toMatch(/no household/)
  })
})

describe('AidNameWithChip', () => {
  it('cuts the name and keeps the chip whole: the name shrinks (min-w-0, truncate), the chip does not', () => {
    wrap(
      <AidNameWithChip
        name={<span>Theodore Sam-Lindqvist</span>}
        chip={<AidHouseholdChip href={null} />}
      />
    )
    const name = screen.getByText('Theodore Sam-Lindqvist').parentElement as HTMLElement
    expect(name).toHaveClass('min-w-0', 'truncate')
    const box = name.parentElement as HTMLElement
    expect(box).toHaveClass('flex', 'min-w-0', 'items-center')
    // the chip comes after the name, as its own flex item
    expect(box.lastElementChild).toHaveTextContent('no household')
  })
})
