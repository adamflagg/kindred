/**
 * The ledger answers the one question a camper list cannot: does this weekend
 * fit in the site?
 *
 * The unit of that question is SPACES, not beds. A family holds a whole cabin
 * whether or not it fills it, so a cabin sleeping 8 housing a family of 3
 * leaves five beds no other family can use. Beds still matter for whether a
 * given family fits a given cabin — that is the board's question, not this
 * page's — so they appear as a footnote, not the headline.
 *
 * The space count is provisional: merging or splitting cabins on the board
 * changes it, and the ledger says so rather than presenting it as settled.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CapacityLedger } from './CapacityLedger'

const base = {
  families: 62,
  spaces: 79,
  spacesUnmeasured: 2,
  bedsNeeded: 223,
  bedsAvailable: 389,
}

describe('CapacityLedger', () => {
  it('leads with families against spaces, not beds', () => {
    render(<CapacityLedger {...base} />)
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(screen.getByText('families')).toBeInTheDocument()
    expect(screen.getByText('into 79 spaces')).toBeInTheDocument()
  })

  it('reports the spare spaces, which is the real headroom', () => {
    render(<CapacityLedger {...base} />)
    expect(screen.getByText('17 spaces spare')).toBeInTheDocument()
  })

  it('warns when there are more families than spaces', () => {
    render(<CapacityLedger {...base} families={85} />)
    expect(screen.getByText('6 more families than spaces')).toBeInTheDocument()
    expect(screen.queryByText(/spaces spare/)).not.toBeInTheDocument()
  })

  it('says the count is exact when families and spaces match', () => {
    render(<CapacityLedger {...base} families={79} />)
    expect(screen.getByText('No spare spaces')).toBeInTheDocument()
  })

  it('states that merges move the space count', () => {
    render(<CapacityLedger {...base} />)
    expect(
      screen.getByText(/Merging or splitting cabins on the board changes the space count/)
    ).toBeInTheDocument()
  })

  it('keeps beds as a footnote, framed as a fit question', () => {
    render(<CapacityLedger {...base} />)
    expect(screen.getByText(/223 beds needed across 389/)).toBeInTheDocument()
  })

  it('reports spaces of unknown size rather than assuming they are usable', () => {
    render(<CapacityLedger {...base} />)
    expect(screen.getByText(/2 spaces of unknown size/)).toBeInTheDocument()
  })

  it('singularises a lone space of unknown size', () => {
    render(<CapacityLedger {...base} spacesUnmeasured={1} />)
    expect(screen.getByText(/1 space of unknown size/)).toBeInTheDocument()
  })

  it('says nothing about unknown sizes when every space is measured', () => {
    render(<CapacityLedger {...base} spacesUnmeasured={0} />)
    expect(screen.queryByText(/unknown size/)).not.toBeInTheDocument()
  })

  it('describes the measure for screen readers', () => {
    render(<CapacityLedger {...base} />)
    expect(screen.getByRole('img', { name: /62 families in 79 spaces/i })).toBeInTheDocument()
  })

  it('survives a weekend with nobody enrolled', () => {
    render(<CapacityLedger {...base} families={0} bedsNeeded={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('79 spaces spare')).toBeInTheDocument()
  })

  it('does not divide by zero when the registry has no spaces', () => {
    render(<CapacityLedger {...base} families={12} spaces={0} spacesUnmeasured={0} />)
    expect(screen.getByText('12 more families than spaces')).toBeInTheDocument()
  })
})
