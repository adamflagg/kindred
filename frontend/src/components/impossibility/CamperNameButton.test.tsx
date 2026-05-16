import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CamperNameButton } from './CamperNameButton'

describe('CamperNameButton', () => {
  it('renders the name and calls onSelect with the stringified cm_id when clicked', () => {
    const onSelect = vi.fn()
    render(<CamperNameButton cmId={4242} name="Emma Johnson" onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: /Emma Johnson/ })
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledWith('4242')
  })

  it('has type="button" so it does not submit enclosing forms', () => {
    render(<CamperNameButton cmId={1} name="Liam Garcia" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Liam Garcia/ })).toHaveAttribute('type', 'button')
  })

  it('exposes an aria-label describing the action', () => {
    render(<CamperNameButton cmId={1} name="Olivia Chen" onSelect={() => {}} />)
    const button = screen.getByRole('button', { name: /Olivia Chen/ })
    expect(button).toHaveAttribute('aria-label', 'Open details for Olivia Chen')
  })

  it('has a persistent visual affordance (underline class)', () => {
    render(<CamperNameButton cmId={1} name="Riley Sam" onSelect={() => {}} />)
    const button = screen.getByRole('button', { name: /Riley Sam/ })
    // Dotted underline is always present (not only on hover/focus)
    expect(button.className).toMatch(/\bunderline\b/)
  })

  it('when disabled, does not call onSelect on click and is not in the tab order', () => {
    const onSelect = vi.fn()
    render(<CamperNameButton cmId={1} name="Samuel Johnson" onSelect={onSelect} disabled />)
    const span = screen.getByText('Samuel Johnson')
    // Disabled renders a plain span, not a button
    expect(span.tagName).toBe('SPAN')
    fireEvent.click(span)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('when disabled, uses a muted text color so the non-interactive state is visible', () => {
    // Otherwise the disabled span is indistinguishable from regular foreground
    // text and users may try to click it expecting the same affordance as the
    // enabled state.
    render(<CamperNameButton cmId={1} name="Riley Sam" onSelect={() => {}} disabled />)
    const span = screen.getByText('Riley Sam')
    expect(span.className).toMatch(/text-muted-foreground/)
  })
})
