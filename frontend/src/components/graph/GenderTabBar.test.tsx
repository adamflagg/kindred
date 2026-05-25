import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenderTabBar from './GenderTabBar'

describe('GenderTabBar', () => {
  it('renders All/Boys/Girls and hides AG when not available', () => {
    render(<GenderTabBar gender="all" agAvailable={false} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boys' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Girls' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AG' })).toBeNull()
  })

  it('shows AG when available and marks the active tab pressed', () => {
    render(<GenderTabBar gender="girls" agAvailable onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'AG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Girls' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onSelect with the scope on click', async () => {
    const onSelect = vi.fn()
    render(<GenderTabBar gender="all" agAvailable onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Boys' }))
    expect(onSelect).toHaveBeenCalledWith('boys')
  })
})
