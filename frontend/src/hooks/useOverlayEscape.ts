import { useEffect } from 'react'

import { acquireOverlayToken, isTopOverlay, releaseOverlayToken } from '../components/ui/modalStack'

/**
 * kindred#2237. The shared shape every overlay in the kindred#2205 token
 * stack should use to wire up Escape — one hook, not fifteen hand-rolled
 * acquire/listen/release effects that can each drift slightly.
 *
 * Mirrors `ConfirmActionPopover`'s already-shipped inline pattern exactly:
 * acquire a token while `isOpen`, act on Escape only while that token is
 * topmost, release it on close or unmount. A token acquired but not
 * released on every exit path silently disables Escape for every overlay
 * opened after it — see kindred#2237 and the leak `#2205` pins for the
 * three existing adopters (`Modal`, `ConfirmActionPopover`, `Tooltip`).
 *
 * Deliberately bubble-phase, no `stopPropagation` — the token gate is what
 * arbitrates who acts, not a capture-phase race to get there first. Several
 * pre-#2237 overlays used a capture-phase listener with `stopPropagation`
 * specifically "to stop it before an outer modal listener reacts"; that
 * approach only works against the ONE outer listener it was written to
 * beat, and still leaves two overlays open at once colliding with each
 * other. The token stack is the general fix; this hook is how a caller
 * opts into it without re-deriving the pattern.
 */
export function useOverlayEscape(isOpen: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!isOpen) return

    const token = acquireOverlayToken()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isTopOverlay(token)) return
      onEscape()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      releaseOverlayToken(token)
    }
  }, [isOpen, onEscape])
}
