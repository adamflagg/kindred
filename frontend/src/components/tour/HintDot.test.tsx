/**
 * TDD Tests for HintDot component.
 *
 * HintDot renders a small pulsing button inline next to interactive elements.
 * On click, it creates a driver.js instance and calls driver.highlight()
 * to spotlight the target element with a descriptive popover.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HintDot } from './HintDot'
import type { HintDefinition } from '../../tours/types'

// Mock driver.js
const mockHighlight = vi.fn()
const mockDestroy = vi.fn()
const mockDriverInstance = {
  highlight: mockHighlight,
  destroy: mockDestroy,
}

vi.mock('driver.js', () => ({
  driver: vi.fn(() => mockDriverInstance),
}))

const sampleHint: HintDefinition = {
  element: '[data-tour="test-element"]',
  title: 'Test Hint',
  description: 'This is a test hint description',
}

describe('HintDot', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a button with correct aria-label', () => {
    render(<HintDot hint={sampleHint} />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    expect(button).toBeInTheDocument()
  })

  it('calls driver.highlight() on click with correct config', async () => {
    const user = userEvent.setup()
    render(<HintDot hint={sampleHint} />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    await user.click(button)

    expect(mockHighlight).toHaveBeenCalledWith({
      element: '[data-tour="test-element"]',
      popover: {
        title: 'Test Hint',
        description: 'This is a test hint description',
        popoverClass: 'kindred-hint',
      },
    })
  })

  it('is keyboard accessible (Enter key triggers highlight)', () => {
    render(<HintDot hint={sampleHint} />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    fireEvent.keyDown(button, { key: 'Enter' })

    expect(mockHighlight).toHaveBeenCalled()
  })

  it('is keyboard accessible (Space key triggers highlight)', () => {
    render(<HintDot hint={sampleHint} />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    fireEvent.keyDown(button, { key: ' ' })

    expect(mockHighlight).toHaveBeenCalled()
  })

  it('stops event propagation on click', () => {
    const outerClickHandler = vi.fn()
    render(
      <div onClick={outerClickHandler} role="presentation">
        <HintDot hint={sampleHint} />
      </div>
    )

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    fireEvent.click(button)

    expect(outerClickHandler).not.toHaveBeenCalled()
  })

  it('accepts and applies className prop', () => {
    render(<HintDot hint={sampleHint} className="ml-1" />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    expect(button.className).toContain('ml-1')
  })

  it('destroys previous driver instance before creating new one', async () => {
    const user = userEvent.setup()
    render(<HintDot hint={sampleHint} />)

    const button = screen.getByRole('button', { name: /hint: test hint/i })
    await user.click(button)
    await user.click(button)

    // First click creates, second click should destroy previous then create new
    expect(mockDestroy).toHaveBeenCalled()
  })
})
