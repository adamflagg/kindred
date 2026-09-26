import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { trapTab } from './ui/focusTrap'
import { acquireOverlayToken, isTopOverlay, releaseOverlayToken } from './ui/modalStack'
import { useAnchoredOverlay } from './ui/useAnchoredOverlay'

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
  const { ref: popoverRef, position } = useAnchoredOverlay<HTMLDivElement>({
    open: isOpen,
    getAnchorRect: () => anchorRect,
    placement: 'below',
    // The old arithmetic's padding, kept so placement does not move.
    edge: 10,
  })
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
      } else {
        trapTab(e, popoverRef.current)
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onCancel()
      }
    }

    // The anchor rect is a click-time snapshot, so a scroll OUTSIDE the
    // popover still dismisses it rather than leave it floating orphaned. A
    // scroll INSIDE it (a scrollable body) is the popover's own and must not.
    function handleScroll(e: Event) {
      if (popoverRef.current && e.target instanceof Node && popoverRef.current.contains(e.target))
        return
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
  }, [isOpen, onCancel, popoverRef])

  if (!isOpen) return null

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
        top: `${String(position?.top ?? -9999)}px`,
        left: `${String(position?.left ?? -9999)}px`,
        width: '220px',
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
