import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { SHARE_GLOW_CLASS, SHARE_MOTION_SELECTOR } from './shareEmphasis'
import { ShareMarks } from './ShareMarks'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return { grain: 'household', household_cm_id: 1000001, display_name: 'Johnson', ...overrides }
}

describe('ShareMarks — the anchor', () => {
  it('renders the always-on anchor even for an unanswered household', () => {
    render(<ShareMarks party={party({ share: { preference: 'unknown' } })} />)
    expect(screen.getByRole('button', { name: 'Share: Not answered' })).toBeInTheDocument()
  })
  it('renders nothing at all for a person-grain party', () => {
    // `share: undefined` is not assignable under `exactOptionalPropertyTypes`
    // (the brief's sample snippet predates that check, per `shareMarks.test.ts`'s
    // rule-1 comment) — omitting the key is the same runtime fact
    // (`party.share === undefined`) and compiles.
    const { container } = render(<ShareMarks party={party({ grain: 'person' })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ShareMarks — the capsule caps are explicit classes from the list', () => {
  it('a solo NEAR mark is a full circle', () => {
    render(<ShareMarks party={party({ share: { preference: 'no_share', proximity: ['near'] } })} />)
    expect(screen.getByRole('button', { name: 'Near family' }).className).toContain('rounded-full')
  })
  it('a three-mark capsule caps left and right and squares the middle', () => {
    render(
      <ShareMarks
        party={party({
          share: {
            preference: 'yes_share',
            proximity: ['near', 'with', 'similar_ages'],
            wants_with_named: true,
          },
        })}
      />
    )
    expect(screen.getByRole('button', { name: 'Share with family' }).className).toContain(
      'rounded-l-full'
    )
    expect(screen.getByRole('button', { name: 'Similar age kids' }).className).toContain(
      'rounded-none'
    )
    expect(screen.getByRole('button', { name: 'Near family' }).className).toContain(
      'rounded-r-full'
    )
  })
})

describe('ShareMarks — anchor and cluster are independent', () => {
  it('radio-NO + NEAR renders both the quiet-gray anchor and the indigo NEAR mark (the 86-household combo)', () => {
    render(<ShareMarks party={party({ share: { preference: 'no_share', proximity: ['near'] } })} />)
    const anchor = screen.getByRole('button', { name: 'Share: Will not share' })
    expect(anchor.className).toContain('bg-muted')
    const near = screen.getByRole('button', { name: 'Near family' })
    expect(near.className).toContain('bg-indigo-100')
  })
  it('renders the anchor alone when there are no requests / proximity is blank', () => {
    render(<ShareMarks party={party({ share: { preference: 'yes_share' } })} />)
    expect(screen.getByRole('button', { name: 'Share: Open to sharing' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-cluster')).not.toBeInTheDocument()
  })
})

/**
 * The emphasis treatment — spec 2026-08-24 §3 ("The halo") and §4 ("why the
 * halo and the motion ride different elements"). Four card shapes, one row of
 * §3's table each, plus the two rules the geometry finding produced.
 */
describe('ShareMarks — the emphasis halo, per card shape (§3)', () => {
  /** The halo/transform vehicles inside one rendered card, in document order. */
  const vehicles = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(SHARE_MOTION_SELECTOR))

  it('anchor yes, no cluster ticks: one halo, on the anchor circle', () => {
    const { container } = render(
      <ShareMarks party={party({ share: { preference: 'yes_share' } })} />
    )
    const found = vehicles(container)
    expect(found).toHaveLength(1)
    expect(found[0]?.className).toContain(SHARE_GLOW_CLASS)
    expect(found[0]?.contains(screen.getByRole('button', { name: 'Share: Open to sharing' }))).toBe(
      true
    )
  })

  it('a hot cluster: one halo on the CAPSULE, hugging NEAR along with it', () => {
    // WITH + NEAR flush-joined — the mixed capsule §3's capsule halo exists
    // for, ~11 of 88 emphasized households in 2026.
    const { container } = render(
      <ShareMarks
        party={party({
          share: { preference: 'no_share', proximity: ['near'], wants_with_named: true },
        })}
      />
    )
    const found = vehicles(container)
    expect(found).toHaveLength(1)
    expect(found[0]).toBe(screen.getByTestId('share-cluster'))
    expect(found[0]?.className).toContain(SHARE_GLOW_CLASS)
  })

  it('a similar-age-only cluster is hot too (the 8-household case)', () => {
    const { container } = render(
      <ShareMarks
        party={party({ share: { preference: 'no_share', proximity: ['similar_ages'] } })}
      />
    )
    expect(vehicles(container)).toHaveLength(1)
  })

  it('anchor yes AND a hot cluster: TWO separate halos, never one merged', () => {
    const { container } = render(
      <ShareMarks
        party={party({
          share: { preference: 'yes_share', proximity: ['near'], wants_with_named: true },
        })}
      />
    )
    const found = vehicles(container)
    expect(found).toHaveLength(2)
    const [anchorVehicle, clusterVehicle] = found as [HTMLElement, HTMLElement]
    expect(clusterVehicle).toBe(screen.getByTestId('share-cluster'))
    // Separate questions: neither halo may swallow the other, which is what a
    // single vehicle wrapping both would draw.
    expect(anchorVehicle.contains(clusterVehicle)).toBe(false)
    expect(clusterVehicle.contains(anchorVehicle)).toBe(false)
    expect(anchorVehicle.className).toContain(SHARE_GLOW_CLASS)
    expect(clusterVehicle.className).toContain(SHARE_GLOW_CLASS)
  })

  it('a NEAR-only cluster gets nothing — proximity is not sharing (147 households)', () => {
    const { container } = render(
      <ShareMarks party={party({ share: { preference: 'no_share', proximity: ['near'] } })} />
    )
    expect(vehicles(container)).toHaveLength(0)
    expect(container.querySelector(`.${SHARE_GLOW_CLASS}`)).toBeNull()
  })

  it.each(['maybe_mutual', 'no_share', 'unknown'] as const)(
    'a %s anchor never glows',
    (preference) => {
      const { container } = render(<ShareMarks party={party({ share: { preference } })} />)
      expect(vehicles(container)).toHaveLength(0)
    }
  )

  it('renders no vehicle for a person-grain party, which has no share question', () => {
    const { container } = render(<ShareMarks party={party({ grain: 'person' })} />)
    expect(vehicles(container)).toHaveLength(0)
  })
})

describe('ShareMarks — the transform vehicle is the capsule, never a glyph (§4)', () => {
  it('stamps the wrapper, and no button inside it', () => {
    // Measured 2026-08-24: scaling one glyph inside a flush capsule takes it
    // to 21.45px beside its 20px neighbour and the pill goes lopsided. The
    // wrapper scales both halves proportionally.
    const { container } = render(
      <ShareMarks
        party={party({
          share: {
            preference: 'no_share',
            proximity: ['near', 'similar_ages'],
            wants_with_named: true,
          },
        })}
      />
    )
    const found = Array.from(container.querySelectorAll<HTMLElement>(SHARE_MOTION_SELECTOR))
    expect(found).toHaveLength(1)
    expect(found[0]?.tagName).toBe('SPAN')
    for (const button of container.querySelectorAll('button')) {
      expect(button.matches(SHARE_MOTION_SELECTOR)).toBe(false)
      expect(button.className).not.toContain(SHARE_GLOW_CLASS)
    }
  })

  it('leaves every fill exactly as the parent spec locked it', () => {
    // Emphasis is a halo plus motion layer and nothing else — a treatment
    // that recoloured NEAR would contradict green-means-share.
    render(
      <ShareMarks
        party={party({
          share: { preference: 'yes_share', proximity: ['near'], wants_with_named: true },
        })}
      />
    )
    expect(screen.getByRole('button', { name: 'Near family' }).className).toContain('bg-indigo-100')
    expect(screen.getByRole('button', { name: 'Share with family' }).className).toContain(
      'bg-forest-100'
    )
    expect(screen.getByRole('button', { name: 'Share: Open to sharing' }).className).toContain(
      'bg-forest-100'
    )
  })

  it('keeps the halo in the markup, so a reduced-motion viewer still sees it', () => {
    // The glow is the STATE; the breathe is only the entrance. Nothing in
    // this component consults motion preference — `shareEmphasis` gates the
    // burst — so the halo renders whether or not the burst ever runs.
    const { container } = render(
      <ShareMarks party={party({ share: { preference: 'yes_share' } })} />
    )
    expect(container.querySelector(`.${SHARE_GLOW_CLASS}`)).not.toBeNull()
  })
})
