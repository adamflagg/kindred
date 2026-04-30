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
    expect(screen.getByText(/1 unit, 1 bunk/i)).toBeInTheDocument()
  })

  it('renders plural labels for count > 1', () => {
    render(<GraphFilterStatus unitCount={2} bunkCount={3} onClick={() => {}} />)
    expect(screen.getByText(/2 units, 3 bunks/i)).toBeInTheDocument()
  })

  it('drops "0 bunks" when only units are selected', () => {
    render(<GraphFilterStatus unitCount={2} bunkCount={0} onClick={() => {}} />)
    expect(screen.getByText(/Filtered: 2 units$/)).toBeInTheDocument()
  })

  it('drops "0 units" when only bunks are selected', () => {
    render(<GraphFilterStatus unitCount={0} bunkCount={1} onClick={() => {}} />)
    expect(screen.getByText(/Filtered: 1 bunk$/)).toBeInTheDocument()
  })

  it('uses aria-live=polite for screen reader announcements', () => {
    render(<GraphFilterStatus unitCount={1} bunkCount={0} onClick={() => {}} />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveAttribute('aria-live', 'polite')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<GraphFilterStatus unitCount={1} bunkCount={0} onClick={onClick} />)
    fireEvent.click(screen.getByRole('status'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
