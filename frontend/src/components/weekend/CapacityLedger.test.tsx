/**
 * The capacity ledger answers the one question a camper list cannot: does this
 * weekend fit in the site, and what don't we know?
 *
 * Unknown capacity is never rounded to zero and never silently dropped — it is
 * a distinct indeterminate band, because "389 beds" and "389 beds plus five
 * cabins nobody has measured" are different facts.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CapacityLedger } from './CapacityLedger'

describe('CapacityLedger', () => {
  it('leads with the beds the weekend needs', () => {
    render(<CapacityLedger bedsNeeded={231} bedsAvailable={389} cabinsUnmeasured={0} />)
    expect(screen.getByText('231')).toBeInTheDocument()
    expect(screen.getByText('beds needed')).toBeInTheDocument()
    expect(screen.getByText('of 389 available')).toBeInTheDocument()
  })

  it('reports unmeasured cabins rather than counting them as zero', () => {
    render(<CapacityLedger bedsNeeded={231} bedsAvailable={389} cabinsUnmeasured={5} />)
    expect(screen.getByText('5 cabins unmeasured')).toBeInTheDocument()
  })

  it('says nothing about unmeasured cabins when every capacity is known', () => {
    render(<CapacityLedger bedsNeeded={231} bedsAvailable={389} cabinsUnmeasured={0} />)
    expect(screen.queryByText(/unmeasured/)).not.toBeInTheDocument()
  })

  it('singularises a lone unmeasured cabin', () => {
    render(<CapacityLedger bedsNeeded={10} bedsAvailable={389} cabinsUnmeasured={1} />)
    expect(screen.getByText('1 cabin unmeasured')).toBeInTheDocument()
  })

  it('warns when demand exceeds the beds we can account for', () => {
    render(<CapacityLedger bedsNeeded={420} bedsAvailable={389} cabinsUnmeasured={0} />)
    expect(screen.getByText('31 beds short')).toBeInTheDocument()
  })

  it('qualifies a shortfall that unmeasured cabins might still cover', () => {
    // Honest: we cannot claim it fits, and we cannot claim it doesn't.
    render(<CapacityLedger bedsNeeded={420} bedsAvailable={389} cabinsUnmeasured={5} />)
    expect(screen.getByText('31 beds short')).toBeInTheDocument()
    expect(screen.getByText(/5 cabins unmeasured/)).toBeInTheDocument()
  })

  it('does not report a shortfall when demand exactly meets supply', () => {
    render(<CapacityLedger bedsNeeded={389} bedsAvailable={389} cabinsUnmeasured={0} />)
    expect(screen.queryByText(/beds short/)).not.toBeInTheDocument()
  })

  it('describes the measure for screen readers', () => {
    render(<CapacityLedger bedsNeeded={231} bedsAvailable={389} cabinsUnmeasured={5} />)
    expect(screen.getByRole('img', { name: /231 of 389 beds needed/i })).toBeInTheDocument()
  })

  it('survives a weekend with no enrolled parties', () => {
    render(<CapacityLedger bedsNeeded={0} bedsAvailable={389} cabinsUnmeasured={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByText(/beds short/)).not.toBeInTheDocument()
  })

  it('does not divide by zero when the registry reports no beds', () => {
    render(<CapacityLedger bedsNeeded={12} bedsAvailable={0} cabinsUnmeasured={0} />)
    expect(screen.getByText('12 beds short')).toBeInTheDocument()
  })
})
