import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { acquireOverlayToken, isTopOverlay, releaseOverlayToken } from './ui/modalStack'

export interface ConfirmActionPopoverProps {
  isOpen: boolean
  anchorRect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
  action: 'approve' | 'decline'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmActionPopover({
  isOpen,
  anchorRect,
  action,
  onConfirm,
  onCancel,
}: ConfirmActionPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    confirmButtonRef.current?.focus()
    // kindred#2205: this popover portals independently of `ui/Modal`, so a
    // host rendering `<Modal><ConfirmActionPopover /></Modal>`
    // (`AllCamperRequestsModal.tsx`, `RequestReviewPanel.tsx`) has two
    // separate `document` Escape listeners. Only the topmost overlay acts.
    const token = acquireOverlayToken()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!isTopOverlay(token)) return
        onCancel()
      } else if (e.key === 'Tab') {
        const buttons = popoverRef.current
          ? Array.from(popoverRef.current.querySelectorAll<HTMLElement>('button'))
          : []
        if (buttons.length === 0) return
        e.preventDefault()
        const idx = buttons.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey) {
          buttons[idx <= 0 ? buttons.length - 1 : idx - 1]?.focus()
        } else {
          buttons[idx >= buttons.length - 1 ? 0 : idx + 1]?.focus()
        }
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onCancel()
      }
    }

    // The popover is positioned using a rect captured at click-time, so any
    // scroll desyncs it from its anchor button. Dismissing on scroll avoids
    // a floating, orphaned popover. capture:true catches scrolls on any
    // scrollable ancestor (e.g. modal body), which don't bubble.
    function handleScroll() {
      onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('scroll', handleScroll, true)
      releaseOverlayToken(token)
      previouslyFocused?.focus()
    }
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const popoverWidth = 220
  // Estimated: ~2 lines of text + padding; update if layout changes
  const popoverHeight = 90
  const padding = 10

  // Position below the anchor by default
  let top = anchorRect.top + anchorRect.height + 8
  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2

  // Flip above anchor if clipped at bottom
  if (top + popoverHeight > window.innerHeight - padding) {
    top = Math.max(padding, anchorRect.top - popoverHeight - 8)
  }

  // Shift left if clipped at right
  if (left + popoverWidth > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - popoverWidth - padding)
  }

  // Ensure not off-screen left
  if (left < padding) {
    left = padding
  }

  const isApprove = action === 'approve'
  const displayMessage = isApprove ? 'Approve this request?' : 'Decline this request?'

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-label={displayMessage}
      className="bg-popover fixed z-[200] rounded-lg border p-3 shadow-lg"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
    >
      <p className="text-foreground mb-3 text-sm font-medium">{displayMessage}</p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="text-muted-foreground hover:bg-muted rounded px-3 py-1.5 text-xs font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          ref={confirmButtonRef}
          type="button"
          aria-label="Confirm"
          onClick={onConfirm}
          className={
            isApprove
              ? 'bg-forest-600 hover:bg-forest-700 dark:bg-forest-700 dark:hover:bg-forest-600 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors'
              : 'rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'
          }
        >
          {isApprove ? 'Approve' : 'Decline'}
        </button>
      </div>
    </div>,
    document.body
  )
}
