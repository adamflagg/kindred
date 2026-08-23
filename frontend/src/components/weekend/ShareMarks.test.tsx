import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
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
