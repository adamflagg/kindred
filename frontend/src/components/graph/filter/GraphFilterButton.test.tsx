import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GraphFilterButton from './GraphFilterButton'

describe('GraphFilterButton', () => {
  it('renders without badge when count is 0', () => {
    render(<GraphFilterButton count={0} open={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Filter/i })).toBeInTheDocument()
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument()
  })

  it('renders badge with the count', () => {
    render(<GraphFilterButton count={3} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn()
    render(<GraphFilterButton count={0} open={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /Filter/i }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('aria-expanded reflects open prop', () => {
    const { rerender } = render(<GraphFilterButton count={0} open={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Filter/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    rerender(<GraphFilterButton count={0} open={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Filter/i })).toHaveAttribute('aria-expanded', 'true')
  })
})
