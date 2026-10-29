import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ClosedChip } from './ClosedChip'
import { CLOSED_CHIP_TITLE } from './words'
import { STRIP_BADGE_CLOSED } from './kitStyles'

// CLOSED-SEASONS-DONE (owner ruling CSD-4): a closed season's strip counts 0 everywhere, plus one stone
// "Closed N" chip, so its requests don't seem to vanish. A kit chip (kit-first rule), not a hand-made pill.
describe('ClosedChip (CSD-4)', () => {
  it('reads "Closed N" in stone, its count in tabular figures', () => {
    render(<ClosedChip count={576} />)
    const chip = screen.getByTestId('closed-chip')
    expect(chip).toHaveTextContent('Closed 576')
    expect(chip.className).toBe(STRIP_BADGE_CLOSED)
    expect(STRIP_BADGE_CLOSED).toContain('bg-stone-100')
    expect(chip.querySelector('i')).toHaveTextContent('576')
  })

  it('says what closed means in its title, and is not a link: there is nothing to open', () => {
    render(<ClosedChip count={2} />)
    const chip = screen.getByTestId('closed-chip')
    expect(chip).toHaveAttribute('title', CLOSED_CHIP_TITLE)
    expect(CLOSED_CHIP_TITLE).toMatch(/closed/i)
    expect(chip.tagName).toBe('SPAN')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
