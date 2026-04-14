import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ConfirmActionPopover } from './ConfirmActionPopover'

describe('ConfirmActionPopover', () => {
  const defaultProps = {
    isOpen: true,
    anchorRect: { top: 200, left: 300, width: 40, height: 40 },
    action: 'approve' as const,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders nothing when isOpen is false', () => {
    render(<ConfirmActionPopover {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders popover with approve message when action is approve', () => {
    render(<ConfirmActionPopover {...defaultProps} action="approve" />)
    expect(screen.getByText(/Approve this request\?/)).toBeInTheDocument()
  })

  it('renders popover with decline message when action is decline', () => {
    render(<ConfirmActionPopover {...defaultProps} action="decline" />)
    expect(screen.getByText(/Decline this request\?/)).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onConfirm={onConfirm} />)

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when clicking outside the popover', () => {
    const onCancel = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    // Click on document body (outside the popover)
    fireEvent.mouseDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when clicking inside the popover', () => {
    const onCancel = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    const popover = screen.getByRole('dialog')
    fireEvent.mouseDown(popover)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('has green confirm button for approve action', () => {
    render(<ConfirmActionPopover {...defaultProps} action="approve" />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    // Check for forest/green classes
    expect(confirmBtn.className).toMatch(/forest|green/)
  })

  it('has red confirm button for decline action', () => {
    render(<ConfirmActionPopover {...defaultProps} action="decline" />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    // Check for red/destructive classes
    expect(confirmBtn.className).toMatch(/red|destructive/)
  })

  it('renders as a portal (attached to document.body)', () => {
    render(<ConfirmActionPopover {...defaultProps} />)
    // The popover should be a direct child of body (via createPortal)
    const popover = screen.getByRole('dialog')
    expect(popover.parentElement).toBe(document.body)
  })

  it('positions the popover near the anchor', () => {
    render(
      <ConfirmActionPopover
        {...defaultProps}
        anchorRect={{ top: 100, left: 200, width: 40, height: 40 }}
      />
    )
    const popover = screen.getByRole('dialog')
    // Should have style with top/left set from anchor position
    expect(popover.style.top).toBeTruthy()
    expect(popover.style.left).toBeTruthy()
  })

  it('focuses the confirm button when the dialog opens', () => {
    render(<ConfirmActionPopover {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('restores focus to the previously focused element when closed via onCancel', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const onCancel = vi.fn()
    const { rerender } = render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    // Close the popover
    rerender(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} isOpen={false} />)
    expect(document.activeElement).toBe(trigger)

    document.body.removeChild(trigger)
  })

  it('has aria-modal="true" on the dialog', () => {
    render(<ConfirmActionPopover {...defaultProps} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('cycles focus forward with Tab key', () => {
    render(<ConfirmActionPopover {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })

    // Auto-focused on confirm (last button); Tab should wrap to first (cancel)
    expect(document.activeElement).toBe(confirmBtn)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false })
    expect(document.activeElement).toBe(cancelBtn)

    // Tab again wraps back to confirm
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false })
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('cycles focus backward with Shift+Tab', () => {
    render(<ConfirmActionPopover {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })

    // Auto-focused on confirm; Shift+Tab should wrap backward to cancel
    expect(document.activeElement).toBe(confirmBtn)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancelBtn)
  })
})
