/**
 * AidSegmented (design-language §18; kit .cf-seg / CF.seg): every single-choice view filter is the
 * grey segmented well, 26px, its buttons 12px/500, primary fill when on, and a choice's count inside
 * its own segment ("All 16", "Needs a group 0").
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AidSegmented } from './Segmented'

const CHOICES = [
  { value: 'all', label: 'All', count: 16 },
  { value: 'group', label: 'Needs a group', count: 0 },
  { value: 'none', label: 'No funder yet' },
] as const

describe('AidSegmented', () => {
  it('draws a 26px tinted well with each count inside its segment', () => {
    render(<AidSegmented label="Show" value="all" options={CHOICES} onChange={vi.fn()} />)
    const well = screen.getByRole('group', { name: 'Show' })
    expect(well).toHaveClass('h-[26px]')
    expect(screen.getByRole('button', { name: 'All 16' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Needs a group 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No funder yet' })).toBeInTheDocument()
  })

  it('fills the picked segment with primary and marks it pressed', () => {
    render(<AidSegmented label="Show" value="group" options={CHOICES} onChange={vi.fn()} />)
    const on = screen.getByRole('button', { name: 'Needs a group 0' })
    expect(on).toHaveClass('bg-primary')
    expect(on).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All 16' })).not.toHaveClass('bg-primary')
  })

  it('reports the choice clicked', async () => {
    const onChange = vi.fn()
    render(<AidSegmented label="Show" value="all" options={CHOICES} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'No funder yet' }))
    expect(onChange).toHaveBeenCalledWith('none')
  })

  it('carries a title on a choice that has one', () => {
    render(
      <AidSegmented
        label="Round"
        value="r1"
        options={[{ value: 'r1', label: 'R1', title: 'Round 1' }]}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'R1' })).toHaveAttribute('title', 'Round 1')
  })

  // Approved final mock reports-statistics.html (seg): a choice can be off, its title saying why.
  it('draws a disabled choice off, says why in its title, and never reports it', async () => {
    const onChange = vi.fn()
    render(
      <AidSegmented
        label="Round"
        value="all"
        options={[
          { value: 'r1', label: 'R1', disabled: true, title: 'Every round is a column here' },
          { value: 'all', label: 'All' },
        ]}
        onChange={onChange}
      />
    )
    const off = screen.getByRole('button', { name: 'R1' })
    expect(off).toBeDisabled()
    expect(off).toHaveAttribute('title', 'Every round is a column here')
    expect(off).toHaveClass('opacity-45', 'cursor-not-allowed')
    await userEvent.click(off)
    expect(onChange).not.toHaveBeenCalled()
  })
})
