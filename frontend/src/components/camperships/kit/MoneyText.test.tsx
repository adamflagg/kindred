import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MINUS } from './money'
import { Money, MoneyCompact, ReversedAmount } from './MoneyText'

describe('Money', () => {
  it('sets figures in tabular numerals', () => {
    render(<Money value={1800} />)
    expect(screen.getByText('$1,800')).toHaveClass('tabular-nums')
  })

  it('inks a negative red, and only a negative', () => {
    render(
      <>
        <Money value={-1200} />
        <Money value={0} />
      </>
    )
    expect(screen.getByText(`${MINUS}$1,200`)).toHaveClass('text-red-700')
    expect(screen.getByText('$0')).not.toHaveClass('text-red-700')
  })

  it('shows "—" for nothing there', () => {
    render(<Money value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('MoneyCompact', () => {
  it('reads thousands as k and inks a negative red', () => {
    render(
      <>
        <MoneyCompact value={153400} />
        <MoneyCompact value={-1200} />
      </>
    )
    expect(screen.getByText('$153k')).toBeInTheDocument()
    expect(screen.getByText(`${MINUS}$1k`)).toHaveClass('text-red-700')
  })
})

describe('ReversedAmount (D74: one row, struck through)', () => {
  it('strikes the amount and says when it was reversed', () => {
    render(<ReversedAmount value={1500} reversedOn="2027-06-03" />)
    expect(screen.getByText('$1,500').tagName).toBe('S')
    expect(screen.getByText('reversed Jun 3')).toBeInTheDocument()
  })
})
