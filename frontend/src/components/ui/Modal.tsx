import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
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
  /**
   * Where the dialog sits vertically. `center` (the default, and every
   * existing caller's behaviour) or `top`.
   *
   * ⚠️ `top` EXISTS FOR A REAL DEFECT, not for taste. A centred dialog is
   * laid out around a card whose height is its content's, so ANY change in
   * that content re-centres the whole card — the header, the input and the
   * footer all move. That is invisible on a dialog whose body is fixed, and
   * disqualifying on one the staff member types into: `AssignFamilyModal`'s
   * search box moved 133px across a three-character typeahead, and 28px on
   * the single keystroke that swaps the region beneath it, which is precisely
   * the jump its ruling exists to forbid ("the panel does not jump under the
   * cursor").
   *
   * Anchoring to the top makes a content-height change grow downward only, so
   * everything above it stays put. Opt-in, because a short confirmation
   * dialog reads better centred and nothing else here has this problem.
   */
  anchor?: 'center' | 'top'
  /**
   * An exact `max-w-*` class, REPLACING `size`'s step for this one caller.
   *
   * ⚠️ OPT-IN, AND IT EXISTS FOR A RULED NUMBER RATHER THAN FOR TASTE.
   * `size` is a five-step scale and every step is somebody's deliberate
   * choice; `AssignFamilyModal` is the one dialog whose width was MEASURED
   * and ruled — 520px, from the kindred#2072 review artifact
   * (`.modalcard{max-width:520px}`), which is the width the candidate row's
   * five columns were laid out against. Tailwind has no 520 step: `max-w-lg`
   * is 512 and `max-w-xl` is 576, so `size` cannot express it.
   *
   * `size="lg"` (`max-w-2xl`, 672px) is what it shipped with, and that was a
   * default nobody chose — 152px wider than the design it was drawn from.
   *
   * Reach for `size` first. This is for a width that is itself a ruling.
   */
  maxWidthClassName?: string
  /**
   * The element to focus when the dialog opens. USE THIS INSTEAD OF A CHILD'S
   * `autoFocus` — that attribute is actively harmful here, in two ways that
   * were both measured on `AssignFamilyModal` (2026-08-20, browser and jsdom
   * alike).
   *
   * 1. IT NEVER WON. React applies `autoFocus` during commit and this effect
   *    runs after it, so the line below took the focus straight back to
   *    `focusable[0]` — which, in any dialog using the custom `header` slot,
   *    is the CLOSE BUTTON, because the close button is rendered above the
   *    body. A dialog whose whole point was to be typed into opened with
   *    focus on Close, where a printable key does nothing and Space or Enter
   *    SHUTS IT.
   * 2. IT BROKE FOCUS RESTORATION TOO, silently. `previouslyFocusedRef`
   *    captures `document.activeElement` in this same effect — by which time
   *    React's `autoFocus` had already moved it INSIDE the dialog. So the
   *    element restored on close was the dialog's own field, detached by
   *    then, and `.focus()` on a detached node is a no-op: focus landed on
   *    `<body>` rather than back on the control that opened it.
   *
   * A ref is attached during commit, before this effect, so passing one is
   * both reliable and leaves `document.activeElement` outside the dialog for
   * the capture above to read correctly.
   *
   * ⚠️ FIVE OTHER DIALOGS STILL DECLARE `autoFocus` on a field and still lose
   * it the same way: `ManualResolutionModal`, `MergeDialog`, `ResolveDialog`,
   * `ScenarioEditModal`, `NewScenarioModal`. They are untouched here because
   * each is a separate surface with its own review; this is the primitive
   * they should move to.
   */
  initialFocusRef?: RefObject<HTMLElement | null>
  // Set when the `header` slot paints a dark ground (the forest band the
  // sessions landing header uses). The close button defaults to
  // `text-muted-foreground`, which is a mid grey — legible on the card, poor
  // on forest-700. This is the close button's contrast only; it changes
  // nothing else, so existing callers keep exactly what they have.
  headerOnDark?: boolean
  /**
   * Where the floating close button sits in a custom header — `'center'`
   * (the default, vertically centred in the header band) or `'top'`
   * (`top-4`, the old default, for a header that wants it).
   *
   * ⚠️ IT EXISTS BECAUSE `top-4` IS A CONSTANT AND HEADER HEIGHT IS NOT.
   * 16px + a 36px box needs 52px of header; a caller that tightens its own
   * header makes this button hang past it. `AssignFamilyModal` took the
   * kindred#2072 artifact's 14px inset, its header went to 47px, and the
   * button's hover fill painted across the divider below it while its hit
   * area covered the top edge of the search box (measured in Chromium,
   * 2026-08-20; the later no-rule ruling reduced it to 1px). Centring in the
   * band cannot come apart that way whatever the caller's header height is.
   *
   * ★ DEFAULT FLIPPED 2026-08-21 (kindred#2507), and the flip is the point.
   * This read "DEFAULT UNCHANGED, deliberately ... moving them is its own
   * review". That review ran. Measured in Chromium against this component,
   * with each caller's own header markup: Manage Scenarios 16/29 -> 22.5/22.5,
   * Lodging Units 16/36 -> 26/26, Heads Up 16/22.5 -> 19.25/19.25, Assign
   * Family 16/-1 (a 1px overhang) -> 7.5/7.5. Centring returns EQUAL gaps
   * everywhere; `top-4` was visibly high at every one.
   *
   * The 18px in-flow mark this docstring called "the standardisation the
   * owner actually wants" was built, shown to them, and REJECTED on sight.
   * Centring the existing 36px control is what they chose instead.
   *
   * The other two branches never read this. `hasSimpleTitle` is already an
   * `items-center` flex row, and the no-header branch has no band to centre
   * in — both measured byte-identical at either setting.
   */
  closeAlign?: 'top' | 'center'
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
  anchor = 'center',
  maxWidthClassName,
  initialFocusRef,
  headerOnDark = false,
  closeAlign = 'center',
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
    // `initialFocusRef` wins — see its prop doc for the two measured defects
    // it exists to close. Unchanged for every caller that passes none.
    ;(initialFocusRef?.current ?? focusable[0] ?? container)?.focus()
    // eslint asks for `initialFocusRef` in the deps below and it is there, not
    // suppressed: a ref object from `useRef` is stable, so the effect does not
    // re-run for any caller that follows the prop's contract. A caller passing
    // an unstable object would re-run it, which is balanced (the cleanup
    // releases exactly what the body acquires) but pointless — pass a ref.

    return () => {
      releaseBackgroundInert()
      releaseOverlayToken(token)
      overlayTokenRef.current = null
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [isOpen, initialFocusRef])

  if (!isOpen) return null

  // Determine if we're using custom header or simple title mode
  // `null` is NOT a custom header, and `header !== undefined` alone let it be
  // one: `PostValidationResultsModal` passes `header={null}` and so rode this
  // branch with a ZERO-HEIGHT band. `top-4` survived that by luck; centring on
  // a 0px band computes `0 - 18 = -18px` and puts half the button above the
  // panel's `overflow-hidden` edge, invisible and unclickable. The default
  // flip is what makes this load-bearing, so it ships alongside it.
  const hasCustomHeader = header !== undefined && header !== null
  const hasSimpleTitle = !hasCustomHeader && title !== undefined

  const resolvedLabelledBy = ariaLabelledBy ?? (hasSimpleTitle ? 'modal-title' : undefined)

  // Portal to document.body so the modal escapes any parent stacking context
  // (e.g. z-[60] CamperDetailsPanel). z-[100] keeps us above documented panels.
  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex justify-center ${
        // `pt-[10vh]` rather than a fixed offset: the dialog should sit in the
        // upper third at any viewport height, and `items-start` alone would
        // pin it to the very edge.
        anchor === 'top' ? 'items-start overflow-y-auto py-[10vh]' : 'items-center'
      }`}
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
        } ${noPadding ? '' : 'p-6'} ${maxWidthClassName ?? sizeClasses[size]} mx-4 w-full`}
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
              className={`absolute ${
                closeAlign === 'center' ? 'top-1/2 -translate-y-1/2' : 'top-4'
              } right-4 z-20 rounded-lg p-2 transition-colors ${
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
