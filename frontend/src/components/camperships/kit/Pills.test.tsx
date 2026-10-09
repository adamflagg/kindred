import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ConfirmationOut } from '../../../types/api-generated'
import { CM_PENDING_WORD } from '../requests/views'
import { STATUS_TONE } from './kitStyles'
import { CancelMark, ConfirmationState, HouseholdChip, IdChip, OverPill, StatusPill } from './Pills'

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
  // Design language §11 (owner 10-09, "needs to be one line"): a chip never wraps. It truncates in a
  // narrow column and its title carries the full words. This replaces the 2026-10-02 two-line chip.
  it('stays on one line, truncating, with its full words in the title', () => {
    render(
      <StatusPill tone={STATUS_TONE.hold} title="Round 3 · Refused by finance on Apr 2">
        R3 · Refused by finance
      </StatusPill>
    )
    const pill = screen.getByText('R3 · Refused by finance')
    expect(pill).toHaveClass('truncate', 'max-w-full')
    expect(pill).not.toHaveClass('whitespace-normal')
    expect(pill).toHaveAttribute('title', 'Round 3 · Refused by finance on Apr 2')
  })

  it.each([
    ['hold', 'bg-red-100'],
    ['note', 'bg-amber-100'],
    // §9: emerald is retired in Camperships; the positive pill is the forest ok tone.
    ['accepted', 'text-forest-800'],
    ['round2', 'bg-sky-100'],
    ['round3', 'bg-purple-100'],
    ['cancelled', 'bg-stone-200'],
  ] as const)('dresses %s in its hue', (state, hue) => {
    render(<StatusPill tone={STATUS_TONE[state]}>{state}</StatusPill>)
    // §11: one chip size, 11.5/16 600, padding 1px 8px.
    expect(screen.getByText(state)).toHaveClass(
      'rounded-full',
      'px-2',
      'py-px',
      'text-[11.5px]',
      'font-semibold',
      hue
    )
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

  // §9: the positive state reads in the forest ok tone (emerald retired), on one line (§11).
  it('reads ✓ confirmed with its date, in the forest ok tone, on one line', () => {
    render(<ConfirmationState confirmation={confirmation({})} />)
    const pill = screen.getByText('✓ confirmed Mar 12')
    expect(pill).toHaveClass('text-forest-800')
    expect(pill).not.toHaveClass('whitespace-normal')
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

// Design language §11 rev1 (owner: "cancelled probably go with the circle slash before the name
// because a long name could force the chip offscreen"): a glyph before the name, never a chip.
describe('CancelMark', () => {
  it('draws a muted stone ⊘ carrying the cancellation as its title', () => {
    render(<CancelMark title="Cancelled May 14 (from CampMinder enrollment)" />)
    const mark = screen.getByText('⊘')
    expect(mark).toHaveAttribute('title', 'Cancelled May 14 (from CampMinder enrollment)')
    expect(mark.className).toContain('stone')
    expect(mark).not.toHaveClass('rounded-full')
  })
})
