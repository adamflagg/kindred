import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PHASE_COLORS } from './phaseColors'
import { PhaseBadge } from './PhaseBadge'

describe('PHASE_COLORS', () => {
  it('exports colors for all three registration phases', () => {
    expect(PHASE_COLORS).toHaveProperty('priority')
    expect(PHASE_COLORS).toHaveProperty('early')
    expect(PHASE_COLORS).toHaveProperty('open')
  })
})

describe('PhaseBadge', () => {
  it('renders the phase label with colored background', () => {
    const { container } = render(<PhaseBadge phase="priority" label="Priority Registration" />)
    const badge = container.querySelector('span')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('Priority')
    // jsdom converts hsl to rgb, so check style attribute is set
    expect(badge?.style.backgroundColor).toBeTruthy()
    expect(badge?.style.color).toBeTruthy()
  })

  it('strips " Registration" suffix from label', () => {
    render(<PhaseBadge phase="early" label="Early Registration" />)
    expect(screen.getByText('Early')).toBeTruthy()
  })

  it('renders nothing when phase has no color defined', () => {
    const { container } = render(<PhaseBadge phase="unknown" label="Unknown" />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('renders each phase with distinct styling', () => {
    const { container: c1 } = render(<PhaseBadge phase="open" label="Open Registration" />)
    const { container: c2 } = render(<PhaseBadge phase="priority" label="Priority Registration" />)
    // Each phase gets a different color
    expect(c1.querySelector('span')?.style.color).not.toBe(c2.querySelector('span')?.style.color)
  })
})
