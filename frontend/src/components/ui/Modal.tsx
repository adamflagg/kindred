import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  acquireBackgroundInert,
  acquireOverlayToken,
  isTopOverlay,
  releaseBackgroundInert,
  releaseOverlayToken,
  type OverlayToken,
} from './modalStack'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  header?: ReactNode // Custom header content (overrides title)
  footer?: ReactNode // Footer content
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  noPadding?: boolean // Remove default padding for complex layouts
  scrollable?: boolean // Make content area scrollable
  // Accessibility: callers using the custom `header` slot should thread
  // either an id referencing the heading element, or a literal label, so
  // screen readers have a name for the dialog.
  ariaLabelledBy?: string
  ariaLabel?: string
  // CSS length (e.g. "28rem") that insets BOTH the blurred backdrop and the
  // modal-centering wrapper from the viewport's right edge. Used when the
  // modal opens on top of a right-side slide-out panel — the panel area
  // stays unblurred and the modal centers in the remaining space.
  backdropInsetRight?: string
  // Set when the `header` slot paints a dark ground (the forest band the
  // sessions landing header uses). The close button defaults to
  // `text-muted-foreground`, which is a mid grey — legible on the card, poor
  // on forest-700. This is the close button's contrast only; it changes
  // nothing else, so existing callers keep exactly what they have.
  headerOnDark?: boolean
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
} as const

// Elements a keyboard user can Tab to inside the dialog. Modal content is
// arbitrary (inputs, selects, textareas, links, buttons — not just buttons),
// unlike the button-only queries in ConfirmActionPopover.tsx and
// RequestReviewPanel.tsx, so this needs the real focusable set or form
// fields get silently stranded outside the trap.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

// The open-dialog counter and the background `inert` it drives live in
// `./modalStack` — `hasOpenModal` is read from outside this file (see that
// module), and a .tsx exporting both a component and a plain function breaks
// Fast Refresh.

/**
 * Shared modal component for consistent modal styling across the app.
 *
 * Usage (simple):
 * ```tsx
 * <Modal isOpen={isOpen} onClose={handleClose} title="My Modal" size="md">
 *   <p>Modal content goes here</p>
 * </Modal>
 * ```
 *
 * Usage (with slots):
 * ```tsx
 * <Modal
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   header={<div className="flex items-center">Custom Header</div>}
 *   footer={<div className="flex gap-2"><button>Cancel</button><button>Save</button></div>}
 *   noPadding
 *   scrollable
 * >
 *   <div className="p-6">Scrollable content</div>
 * </Modal>
 * ```
 */
export function Modal({
  isOpen,
  onClose,
  title,
  header,
  footer,
  children,
  size = 'md',
  noPadding = false,
  scrollable = false,
  ariaLabelledBy,
  ariaLabel,
  backdropInsetRight,
  headerOnDark = false,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  // kindred#2205: which of possibly several stacked overlays this instance
  // is. Read by the Escape branch below, written by the mount effect that
  // acquires it — see that effect for why they're split.
  const overlayTokenRef = useRef<OverlayToken | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only the topmost overlay acts on a given Escape press. Without
        // this, a second `ui/Modal` (or any other overlay participating in
        // the same stack — `ConfirmActionPopover`, `ui/Tooltip`) opened on
        // top of this one would still leave THIS listener firing too, and
        // one keypress would close both — `ScenarioManagementModal.tsx` hits
        // this three times over (its confirm dialog, `ScenarioEditModal`,
        // `NewScenarioModal`, all opened on top of its always-open outer
        // Modal).
        const token = overlayTokenRef.current
        if (token !== null && !isTopOverlay(token)) return
        onClose()
        return
      }
      // Manual cycling (not letting the browser's native Tab handling run)
      // matches ConfirmActionPopover.tsx and RequestReviewPanel.tsx's
      // existing pattern in this repo — and jsdom doesn't implement native
      // Tab focus movement at all, so tests depend on it too.
      if (e.key === 'Tab') {
        const container = contentRef.current
        // A nested overlay (e.g. ConfirmActionPopover, rendered as a Modal
        // child but portaled independently to document.body — see
        // AllCamperRequestsModal.tsx) can hold focus outside this dialog's
        // own content subtree. If it does, this trap must no-op rather than
        // yank focus back in: both listeners are on `document`, so acting
        // here would fight the nested overlay's own trap for every Tab
        // press instead of leaving it to run its own cycle.
        if (!container?.contains(document.activeElement)) return
        const focusable = getFocusable(container)
        if (focusable.length === 0) return
        e.preventDefault()
        const idx = focusable.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey) {
          focusable[idx <= 0 ? focusable.length - 1 : idx - 1]?.focus()
        } else {
          focusable[idx >= focusable.length - 1 ? 0 : idx + 1]?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Initial focus, background inert, and focus restoration on close. Kept
  // separate from the keydown effect above — this one only needs to run on
  // open/close transitions ([isOpen]), not on every render where a caller
  // passes a new onClose identity.
  useEffect(() => {
    if (!isOpen) return

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    acquireBackgroundInert()
    const token = acquireOverlayToken()
    overlayTokenRef.current = token

    const container = contentRef.current
    const focusable = container ? getFocusable(container) : []
    ;(focusable[0] ?? container)?.focus()

    return () => {
      releaseBackgroundInert()
      releaseOverlayToken(token)
      overlayTokenRef.current = null
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [isOpen])

  if (!isOpen) return null

  // Determine if we're using custom header or simple title mode
  const hasCustomHeader = header !== undefined
  const hasSimpleTitle = !hasCustomHeader && title !== undefined

  const resolvedLabelledBy = ariaLabelledBy ?? (hasSimpleTitle ? 'modal-title' : undefined)

  // Portal to document.body so the modal escapes any parent stacking context
  // (e.g. z-[60] CamperDetailsPanel). z-[100] keeps us above documented panels.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedLabelledBy}
      aria-label={!resolvedLabelledBy ? ariaLabel : undefined}
      style={backdropInsetRight ? { right: backdropInsetRight } : undefined}
    >
      {/* Backdrop — fills the (already-inset) dialog wrapper via inset-0,
          so the wrapper's right offset is the single source of truth. */}
      <div
        data-testid="modal-backdrop"
        className="absolute inset-0 backdrop-blur"
        style={{ backgroundColor: 'rgba(17, 26, 22, 0.42)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions --
          onClick here only calls stopPropagation() to keep a backdrop click from
          bubbling up and closing the modal — it is not a user-facing affordance a
          keyboard user needs to reach or activate, so no role/keyboard handler
          applies. The actual dismiss controls are the Escape-key listener above and
          the close <button>s below; the backdrop itself is aria-hidden and
          click-only by design, which is why it and this rule are exempted here but
          not elsewhere in this wave. */}
      <div
        ref={contentRef}
        data-testid="modal-content"
        // -1: not a natural Tab stop, only a JS-focus fallback for the rare
        // dialog with no focusable content of its own.
        tabIndex={-1}
        className={`bg-card relative overflow-hidden rounded-2xl ${
          // A dark header slot paints its own chrome to the card's edge, and a
          // light 1px ring around it reads as a white outline against the
          // colour rather than as an edge. Bordered stays the default.
          headerOnDark ? '' : 'border-border border'
        } ${noPadding ? '' : 'p-6'} ${sizeClasses[size]} mx-4 w-full`}
        style={{
          boxShadow:
            '0 24px 60px -24px rgba(7, 20, 14, 0.35), 0 8px 24px -12px rgba(7, 20, 14, 0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Custom header mode - header spans full width, close button floats on top */}
        {hasCustomHeader && (
          <div className="relative">
            {header}
            <button
              onClick={onClose}
              className={`absolute top-4 right-4 z-20 rounded-lg p-2 transition-colors ${
                headerOnDark
                  ? 'text-white/70 hover:bg-white/10 hover:text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-black/10'
              }`}
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Simple title mode */}
        {hasSimpleTitle && (
          <div className="mb-4 flex items-center justify-between">
            <h2 id="modal-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* No title/header mode - floating close button */}
        {!hasCustomHeader && !hasSimpleTitle && (
          <div className="absolute top-4 right-4">
            <button
              onClick={onClose}
              className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Content area - optionally scrollable */}
        {scrollable ? (
          <div data-testid="modal-body" className="max-h-[calc(90vh-200px)] overflow-y-auto">
            {children}
          </div>
        ) : (
          children
        )}

        {/* Footer */}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export default Modal
