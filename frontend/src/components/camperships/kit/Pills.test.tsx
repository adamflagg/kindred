import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ConfirmationOut } from '../../../types/api-generated'
import { CM_PENDING_WORD } from '../requests/views'
import { STATUS_TONE } from './kitStyles'
import { ConfirmationState, HouseholdChip, IdChip, OverPill, StatusPill } from './Pills'

function confirmation(over: Partial<ConfirmationOut>): ConfirmationOut {
  return {
    status: 'confirmed',
    locked: 1800,
    in_campminder: 1800,
    gap: 0,
    on: '2027-03-12',
    reconciled: true,
    family_unplaced: 0,
    shares: [],
    ...over,
  }
}

describe('StatusPill (§4.5; D19, D59)', () => {
  // Owner 2026-10-02: a chip that wraps to two lines centres its text.
  it('centres its text when it wraps, and keeps one line otherwise', () => {
    render(
      <StatusPill tone={STATUS_TONE.hold} wrap>
        R3 · Refused by finance
      </StatusPill>
    )
    const wrapped = screen.getByText('R3 · Refused by finance')
    expect(wrapped).toHaveClass('text-center', 'whitespace-normal')
    expect(wrapped).not.toHaveClass('text-left')
  })

  it.each([
    ['hold', 'bg-red-100'],
    ['note', 'bg-amber-100'],
    ['accepted', 'bg-emerald-100'],
    ['round2', 'bg-sky-100'],
    ['round3', 'bg-purple-100'],
    ['cancelled', 'bg-stone-200'],
  ] as const)('dresses %s in its hue', (state, hue) => {
    render(<StatusPill tone={STATUS_TONE[state]}>{state}</StatusPill>)
    expect(screen.getByText(state)).toHaveClass('rounded-full', 'px-2', 'py-0.5', 'text-xs', hue)
  })
})

describe('ConfirmationState (D59; mockups/posted-words.html E)', () => {
  // Owner V1 (10-03): one vocabulary with the grid's CM ✓ chip, so a tick awaiting the sync reads "pending".
  it("reads pending, quietly, in the CM ✓ chip's own word", () => {
    render(<ConfirmationState confirmation={confirmation({ status: 'awaiting_sync', on: null })} />)
    expect(CM_PENDING_WORD).toBe('pending')
    expect(screen.getByText(CM_PENDING_WORD)).toHaveClass('bg-muted')
    expect(screen.queryByText(/tonight/)).toBeNull()
  })

  it('reads ✓ confirmed with its date, in emerald', () => {
    render(<ConfirmationState confirmation={confirmation({})} />)
    expect(screen.getByText('✓ confirmed Mar 12')).toHaveClass('bg-emerald-100')
  })

  it("names CampMinder's figure only when it disagrees, and the gap exactly (D74)", () => {
    render(
      <ConfirmationState
        confirmation={confirmation({
          status: 'short',
          locked: 2400,
          in_campminder: 2399.72,
          gap: -0.28,
        })}
      />
    )
    expect(screen.getByText('CampMinder shows $2,399.72')).toBeInTheDocument()
    expect(screen.getByText('short $0.28')).toHaveClass('bg-amber-100')
  })

  it('reads over, and Missing in CM (owner V1), in amber', () => {
    const { unmount } = render(
      <ConfirmationState
        confirmation={confirmation({ status: 'over', locked: 1200, in_campminder: 1500, gap: 300 })}
      />
    )
    expect(screen.getByText('over $300')).toHaveClass('bg-amber-100')
    unmount()
    render(
      <ConfirmationState
        confirmation={confirmation({ status: 'not_in_campminder', in_campminder: 0 })}
      />
    )
    expect(screen.getByText('Missing in CM')).toHaveClass('bg-amber-100')
    expect(screen.queryByText(/not in CampMinder/)).toBeNull()
  })

  it('reads reversed with its date, in stone', () => {
    render(
      <ConfirmationState confirmation={confirmation({ status: 'reversed', on: '2027-06-03' })} />
    )
    expect(screen.getByText('reversed Jun 3')).toHaveClass('bg-stone-200')
  })
})

// Ruling 2026-10-01 (plan review): §4.2's pill, built rather than dropped.
describe('OverPill (§4.2; D119: only the total is hard)', () => {
  it('says "over allocation" on a pool or round, and "over budget" only on the total', () => {
    const { unmount } = render(<OverPill scope="pool" />)
    expect(screen.getByText('over allocation')).toHaveClass('bg-amber-100')
    unmount()
    render(<OverPill scope="total" />)
    expect(screen.getByText('over budget')).toHaveClass('bg-amber-100')
  })
})

// Ruling 2026-10-01 (plan review): D27's chip, built rather than dropped.
describe('IdChip (D27: a matched CampMinder id shows as a highlighted chip under the name)', () => {
  it('shows the id highlighted, in monospace', () => {
    render(<IdChip id={1000002} />)
    expect(screen.getByText('1000002')).toHaveClass('font-mono', 'bg-amber-100')
  })
})

describe('HouseholdChip (D32)', () => {
  it.each([
    [1, 'Johnson', 'bg-sky-100'],
    [2, 'Garcia', 'bg-purple-100'],
    [3, 'Chen', 'bg-emerald-100'],
  ] as const)('shows household %i · %s in its colour', (index, name, hue) => {
    render(<HouseholdChip index={index} name={name} />)
    expect(screen.getByText(`${index} · ${name}`)).toHaveClass(hue)
  })

  it.each([4, 7, 12])(
    'shows a fourth-or-later household %i in a neutral chip, not unstyled',
    (index) => {
      render(<HouseholdChip index={index} name="Sam" />)
      const chip = screen.getByText(`${String(index)} · Sam`)
      expect(chip).toHaveClass('bg-muted', 'rounded-md')
      expect(chip.className).not.toContain('undefined')
    }
  )
})
