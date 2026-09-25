/**
 * The weekend board's slide-in side panel: the SHELL `FamilyDetailsPanel` was
 * built in, extracted so a second panel -- a Jotform-linked write-in's
 * (kindred#2759 follow-up) -- is the same component rather than a copy.
 *
 * What it owns is the interaction contract, unchanged from when it lived
 * inline: `{ onClose, requestClose }` with `requestClose` driving an animated
 * close, the `pointer-events-none fixed inset-0 z-[59]` click-outside layer,
 * `data-panel="family-details"` (which `shouldKeepPanelsOpen` reads, so a
 * click on either panel never dismisses it), and a full `ui/modalStack` token
 * for Escape and the backdrop. The panel supplies the header's title and
 * subtitle and the body.
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  acquireOverlayToken,
  isTopOverlay,
  releaseOverlayToken,
  type OverlayToken,
} from '../ui/modalStack'

export interface SlideInPanelProps {
  /**
   * What the panel is showing. A change resets a close in progress: the
   * panels update in place rather than remounting, so closing one and opening
   * another inside the slide-out must not hand the new one the old exit.
   */
  identity: string
  title: ReactNode
  subtitle: ReactNode
  ariaLabel: string
  /** Parent-driven animated close, as the summer board does. */
  requestClose?: boolean
  onClose: () => void
  /** See `FamilyDetailsPanelProps.backdropInteractive`. */
  backdropInteractive?: boolean
  /** The panel's own test handle; the backdrop's is derived from it. */
  testId?: string
  backdropTestId?: string
  children: ReactNode
}

export function SlideInPanel({
  identity,
  title,
  subtitle,
  ariaLabel,
  requestClose = false,
  onClose,
  backdropInteractive = false,
  testId = 'family-details-panel',
  backdropTestId = 'family-panel-backdrop',
  children,
}: SlideInPanelProps) {
  const [isClosing, setIsClosing] = useState(false)

  // The board and map stopped keying the family panel per party, so a family switch
  // updates it in place instead of remounting. Remounting used to reset
  // `isClosing` for free; nothing else does. Without this, closing one family
  // and picking another inside the 300ms slide-out hands the new family the
  // old one's exit, and `handleAnimationEnd` closes the panel on them.
  //
  // Adjusted during render, not in an effect: an effect commits one frame with
  // the exit class still on, which is the flicker this exists to prevent.
  // `requestClose` needs no equivalent HERE for a same-click family switch —
  // the parent's `openParty` already sets it false. A party that DEPARTS the
  // roster instead of being switched away from is a different path
  // (kindred#2137 bug 2): this panel can unmount mid-exit-animation before
  // `onClose` ever fires, so nothing here would clear a latched
  // `requestClose` for it. `usePanelParty`'s own render-time correction is
  // what clears it in that case, not this component.
  // kindred#2650 follow-up. Read by `handleBackdropClick` below, written by
  // the token effect further down — split the same way `ui/Modal`'s own
  // `overlayTokenRef` is, so the JSX click handler (defined outside that
  // effect) can see the current token without re-deriving it.
  const overlayTokenRef = useRef<OverlayToken | null>(null)

  const [shownIdentity, setShownIdentity] = useState(identity)
  if (identity !== shownIdentity) {
    setShownIdentity(identity)
    setIsClosing(false)
  }

  const exiting = requestClose || isClosing

  const handleClose = useCallback(() => {
    setIsClosing(true)
  }, [])

  const handleAnimationEnd = useCallback(
    (event: React.AnimationEvent) => {
      if (!exiting) return
      // jsdom reports an empty animationName; allow it so tests can drive the
      // same path the browser takes.
      const name = event.animationName || ''
      if (name.length === 0 || name.includes('Out')) onClose()
    },
    [exiting, onClose]
  )

  useEffect(() => {
    if (isClosing) return
    // This panel is now a full participant in `ui/modalStack`'s token stack,
    // exactly as `ui/Modal` itself is (kindred#2650) -- not merely a reader
    // of `hasOpenModal()`. Two directions both have to work:
    //
    //  - A `ui/Modal` this panel HOSTS (kindred#2073's "see members" is the
    //    first) opens ON TOP of it. That modal acquires ITS OWN token after
    //    this one, so it becomes topmost and this effect's own check below
    //    correctly stands down for it.
    //  - A `ui/Modal` HOSTS this panel instead (kindred#2650:
    //    `CabinWeekendModal` opens this panel from a family-name click). This
    //    panel's token is acquired AFTER the modal's, so IT becomes topmost —
    //    which is what lets the modal's own `isTopOverlay` check stand down
    //    in turn, rather than closing itself out from under a panel still
    //    visibly on top.
    //
    // `hasOpenModal()` (`overlayStack.length > 0`) could not tell these two
    // directions apart: once this panel held its own token, the stack would
    // never again read as empty, and the FIRST direction above would break —
    // a "see members" click would leave the panel unable to close on its own
    // Escape ever again.
    const token = acquireOverlayToken()
    overlayTokenRef.current = token

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!isTopOverlay(token)) return
      handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      releaseOverlayToken(token)
      overlayTokenRef.current = null
    }
  }, [isClosing, handleClose, overlayTokenRef])

  // kindred#2650 follow-up. Mirrors the Escape check just above, and
  // `ui/Modal`'s own identically-shaped backdrop gate: a click on THIS
  // panel's own click-outside layer must defer to whatever overlay is
  // currently on top of it, exactly like Escape already does. Kept separate
  // from `handleClose` (shared with the header close button and Escape)
  // because the header's own explicit close button is not gated — it mirrors
  // `ui/Modal`'s own close button, which stays reachable-or-not purely by
  // whatever visually covers it, never by this token.
  const handleBackdropClick = useCallback(() => {
    const token = overlayTokenRef.current
    if (token !== null && !isTopOverlay(token)) return
    handleClose()
  }, [handleClose, overlayTokenRef])

  return (
    <>
      {/* Click-outside layer, as the summer board lays over the page. */}
      <div
        data-testid={backdropTestId}
        className={`${backdropInteractive ? 'pointer-events-auto' : 'pointer-events-none'} fixed inset-0 z-[59]`}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        data-panel="family-details"
        data-testid={testId}
        role="dialog"
        aria-label={ariaLabel}
        className={`bg-card shadow-lodge-xl border-border fixed top-0 right-0 bottom-0 z-[60] flex w-[26rem] max-w-full flex-col border-l ${
          exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
        }`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="from-forest-700 via-forest-800 to-forest-900 flex flex-shrink-0 items-start gap-3 bg-gradient-to-br p-4 text-white">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">{title}</h2>
            <p className="text-forest-100 mt-0.5 text-xs">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close panel"
            className="-mr-1 rounded-lg p-1.5 transition-colors hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  )
}
