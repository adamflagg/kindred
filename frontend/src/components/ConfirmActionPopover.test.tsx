import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { ConfirmActionPopover } from './ConfirmActionPopover'
import { Modal } from './ui/Modal'

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

  it('calls onCancel when a scroll event fires anywhere in the document', () => {
    const onCancel = vi.fn()
    render(<ConfirmActionPopover {...defaultProps} onCancel={onCancel} />)

    // Scroll would desync the popover from its captured anchor; dismiss instead.
    fireEvent.scroll(document, {})
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('ConfirmActionPopover — over a ui/Modal (kindred#2205)', () => {
  // `AllCamperRequestsModal.tsx` and `RequestReviewPanel.tsx` both render
  // exactly this composition: `<Modal>…{confirming && <ConfirmActionPopover
  // />}</Modal>`. The popover portals independently of the Modal, so both
  // attach their own `keydown` Escape listener to `document` — without the
  // shared overlay token stack, one press fires both, and the popover
  // cancelling itself takes the whole modal down with it.
  //
  // The popover mounts CONDITIONALLY, after a later click — not alongside
  // the Modal in its first render — matching the real host exactly. That
  // ordering matters: React fires mount effects bottom-up, so a popover
  // mounted in the SAME commit as its parent Modal would register its token
  // before the Modal's own, inverting who is "topmost". Only a popover that
  // opens in a later, separate commit is guaranteed to land on top of an
  // already-registered Modal, which is what every real caller does.
  function ModalWithPopover({
    onCloseModal,
    onCancelPopover,
  }: {
    onCloseModal: () => void
    onCancelPopover: () => void
  }) {
    const [confirming, setConfirming] = useState(false)
    return (
      <Modal isOpen={true} onClose={onCloseModal} title="Camper requests">
        <button onClick={() => setConfirming(true)}>Decline</button>
        {confirming && (
          <ConfirmActionPopover
            isOpen
            anchorRect={{ top: 200, left: 300, width: 40, height: 40 }}
            action="approve"
            onConfirm={vi.fn()}
            onCancel={() => {
              setConfirming(false)
              onCancelPopover()
            }}
          />
        )}
      </Modal>
    )
  }

  it('one Escape closes only the popover, never the modal beneath it', () => {
    const onCloseModal = vi.fn()
    const onCancelPopover = vi.fn()
    render(<ModalWithPopover onCloseModal={onCloseModal} onCancelPopover={onCancelPopover} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancelPopover).toHaveBeenCalledTimes(1)
    expect(onCloseModal).not.toHaveBeenCalled()
  })

  it('a second Escape, once the popover is gone, closes the modal', () => {
    const onCloseModal = vi.fn()
    const onCancelPopover = vi.fn()
    render(<ModalWithPopover onCloseModal={onCloseModal} onCancelPopover={onCancelPopover} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancelPopover).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCloseModal).toHaveBeenCalledTimes(1)
  })

  it('does NOT act on Escape when a further overlay opens on top of it', () => {
    // The popover's own `isTopOverlay` gate, isolated from the Modal's — a
    // second overlay (e.g. another `ui/Modal`) opened after the popover must
    // own the key instead. Nothing in the app stacks a third overlay on a
    // popover today, but the popover registers in the SAME shared stack as
    // everything else, so it has to honour "am I topmost?" too, not just
    // "is a Modal open somewhere below me?".
    function Scene({
      onCancelPopover,
      onCloseNested,
    }: {
      onCancelPopover: () => void
      onCloseNested: () => void
    }) {
      const [nested, setNested] = useState(false)
      return (
        <>
          <ConfirmActionPopover
            isOpen
            anchorRect={{ top: 200, left: 300, width: 40, height: 40 }}
            action="approve"
            onConfirm={vi.fn()}
            onCancel={onCancelPopover}
          />
          <button onClick={() => setNested(true)}>Open nested</button>
          <Modal isOpen={nested} onClose={onCloseNested} title="Nested">
            <p>Nested content</p>
          </Modal>
        </>
      )
    }

    const onCancelPopover = vi.fn()
    const onCloseNested = vi.fn()
    render(<Scene onCancelPopover={onCancelPopover} onCloseNested={onCloseNested} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open nested' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCloseNested).toHaveBeenCalledTimes(1)
    expect(onCancelPopover).not.toHaveBeenCalled()
  })

  it('releases its overlay token on unmount, so the stack does not leak', () => {
    const { unmount } = render(
      <ConfirmActionPopover
        isOpen={true}
        anchorRect={{ top: 200, left: 300, width: 40, height: 40 }}
        action="approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    unmount()

    // A fresh Modal opening afterward must be topmost immediately — a leaked
    // popover token would silently no-op its Escape.
    const onClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={onClose} title="Fresh">
        <p>Content</p>
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
