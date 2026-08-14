import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GraphFilterStatus from './GraphFilterStatus'

describe('GraphFilterStatus', () => {
  it('renders nothing when filter is inactive', () => {
    const { container } = render(
      <GraphFilterStatus unitCount={0} bunkCount={0} onClick={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders singular labels for count of 1', () => {
    render(<GraphFilterStatus unitCount={1} bunkCount={1} onClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/1 unit, 1 bunk/i)
  })

  it('renders plural labels for count > 1', () => {
    render(<GraphFilterStatus unitCount={2} bunkCount={3} onClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/2 units, 3 bunks/i)
  })

  it('drops "0 bunks" when only units are selected', () => {
    render(<GraphFilterStatus unitCount={2} bunkCount={0} onClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/Filtered: 2 units/)
  })

  it('drops "0 units" when only bunks are selected', () => {
    render(<GraphFilterStatus unitCount={0} bunkCount={1} onClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/Filtered: 1 bunk/)
  })

  it('renders no aria-live region — no assistive tech reads this app (kindred#2348)', () => {
    // Regression: a `role="status" aria-live="polite"` div used to sit
    // beside the button, carrying the SAME string verbatim. Nothing here
    // reads it (`frontend/CLAUDE.md` §Accessibility), so the visible
    // button is now the only place the text lives.
    render(<GraphFilterStatus unitCount={1} bunkCount={0} onClick={() => {}} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<GraphFilterStatus unitCount={1} bunkCount={0} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
