/**
 * The request panel must distinguish NEAR from WITH and must never imply a
 * household consented to sharing when they simply did not answer.
 *
 * The vocabulary here is Go's, not this layer's: `no_share | maybe_mutual |
 * yes_share`, with an empty column arriving as `unknown`. `request_text` is
 * ONE pre-joined string — the ingest joins three source fields with "; " and
 * that join is lossy to reverse, so it is never split back apart.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ShareRequest } from '../../types/lodging'
import { ShareRequestPanel } from './ShareRequestPanel'

function share(overrides: Partial<ShareRequest> = {}): ShareRequest {
  return {
    preference: 'unknown',
    preference_raw: '',
    proximity: [],
    request_text: '',
    needs_resolution: false,
    ...overrides,
  }
}

describe('SharePreferenceChip inside ShareRequestPanel', () => {
  it('renders a hard no as "Will not share"', () => {
    render(<ShareRequestPanel share={share({ preference: 'no_share' })} />)
    expect(screen.getByText('Will not share')).toBeInTheDocument()
  })

  it('renders the maybe answer as mutual-only', () => {
    render(<ShareRequestPanel share={share({ preference: 'maybe_mutual' })} />)
    expect(screen.getByText('Only if mutual')).toBeInTheDocument()
  })

  it('renders the yes answer as open to sharing', () => {
    render(<ShareRequestPanel share={share({ preference: 'yes_share' })} />)
    expect(screen.getByText('Open to sharing')).toBeInTheDocument()
  })

  it('renders an unanswered preference as "Not answered", not as consent', () => {
    render(<ShareRequestPanel share={share({ preference: 'unknown' })} />)
    expect(screen.getByText('Not answered')).toBeInTheDocument()
    expect(screen.queryByText('Open to sharing')).not.toBeInTheDocument()
  })

  it('shows the verbatim CampMinder answer as a tooltip so staff can audit it', () => {
    render(
      <ShareRequestPanel
        share={share({ preference: 'no_share', preference_raw: 'No, prefer not to share' })}
      />
    )
    expect(screen.getByText('Will not share')).toHaveAttribute('title', 'No, prefer not to share')
  })
})

describe('proximity kinds', () => {
  it('labels NEAR as proximity, not co-housing', () => {
    render(<ShareRequestPanel share={share({ proximity: ['near'] })} />)
    expect(screen.getByText('Near another family')).toBeInTheDocument()
    expect(screen.queryByText('Same cabin as another family')).not.toBeInTheDocument()
  })

  it('labels WITH as co-housing', () => {
    render(<ShareRequestPanel share={share({ proximity: ['with'] })} />)
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
  })

  it('renders both when the multi-select carried both', () => {
    render(<ShareRequestPanel share={share({ proximity: ['near', 'with'] })} />)
    expect(screen.getByText('Near another family')).toBeInTheDocument()
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
  })

  it('labels the similarly-aged option distinctly', () => {
    render(<ShareRequestPanel share={share({ proximity: ['similar_ages'] })} />)
    expect(screen.getByText('With similarly-aged kids')).toBeInTheDocument()
  })

  it('renders similar_ages ALONGSIDE with, never instead of it', () => {
    // similar_ages always accompanies `with` on the wire — the option it comes
    // from begins "Share a cabin WITH", and what differs is only that the
    // partner is unnamed. Dropping the WITH chip would drop these households
    // out of any "wants to share a cabin" view.
    render(<ShareRequestPanel share={share({ proximity: ['with', 'similar_ages'] })} />)
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
    expect(screen.getByText('With similarly-aged kids')).toBeInTheDocument()
  })
})

describe('raw request text', () => {
  it('shows the verbatim text with a needs-resolution badge', () => {
    render(
      <ShareRequestPanel
        share={share({
          request_text: 'Please house us near the Garcia family',
          needs_resolution: true,
        })}
      />
    )
    expect(screen.getByText(/Please house us near the Garcia family/)).toBeInTheDocument()
    expect(screen.getByText('Needs resolution')).toBeInTheDocument()
  })

  it('renders a multi-field joined request as ONE verbatim block', () => {
    // The ingest pre-joins three source fields with "; ". Splitting it back
    // apart is lossy, so the panel shows the string exactly as sent.
    const joined = 'Near the Garcia family; we have a toddler; ground floor please'
    render(<ShareRequestPanel share={share({ request_text: joined, needs_resolution: true })} />)
    expect(
      screen.getByText(new RegExp(joined.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    ).toBeInTheDocument()
  })

  it('shows nothing to resolve when there is no free text', () => {
    render(<ShareRequestPanel share={share()} />)
    expect(screen.queryByText('Needs resolution')).not.toBeInTheDocument()
  })
})
