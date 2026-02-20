import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TourReplayButton } from './TourReplayButton'

describe('TourReplayButton', () => {
  it('renders when tourId is provided', () => {
    render(<TourReplayButton tourId="debug" onReplay={vi.fn()} />)
    expect(screen.getByRole('button', { name: /replay tour/i })).toBeInTheDocument()
  })

  it('does not render when tourId is null', () => {
    const { container } = render(<TourReplayButton tourId={null} onReplay={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onReplay when clicked', () => {
    const onReplay = vi.fn()
    render(<TourReplayButton tourId="debug" onReplay={onReplay} />)
    fireEvent.click(screen.getByRole('button', { name: /replay tour/i }))
    expect(onReplay).toHaveBeenCalledOnce()
  })

  it('renders the HelpCircle icon', () => {
    const { container } = render(<TourReplayButton tourId="debug" onReplay={vi.fn()} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })
})
