import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmActionPopoverProps {
  isOpen: boolean
  anchorRect: { top: number; left: number; width: number; height: number }
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
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      const popover = document.getElementById('confirm-action-popover')
      if (popover && !popover.contains(target)) {
        onCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const popoverWidth = 220
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
  const message = isApprove ? 'Approve this request?' : 'Decline this request?'

  return createPortal(
    <div
      id="confirm-action-popover"
      role="dialog"
      aria-label={message}
      className="bg-popover fixed z-[200] rounded-lg border p-3 shadow-lg"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
    >
      <p className="text-foreground mb-3 text-sm font-medium">{message}</p>
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
