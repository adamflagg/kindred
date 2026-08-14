import { useEffect, useRef } from 'react'

import { acquireOverlayToken, isTopOverlay, releaseOverlayToken } from '../components/ui/modalStack'

/**
 * kindred#2237. The shared shape every overlay in the kindred#2205 token
 * stack should use to wire up Escape — one hook, not fifteen hand-rolled
 * acquire/listen/release effects that can each drift slightly.
 *
 * Acquire a token while `isOpen`, act on Escape only while that token is
 * topmost, release it on close or unmount. A token acquired but not released
 * on every exit path silently disables Escape for every overlay opened after
 * it — see kindred#2237 and the leak `#2205` pins for the three existing
 * adopters (`Modal`, `ConfirmActionPopover`, `Tooltip`).
 *
 * ## Why the CAPTURE phase, and why `stopPropagation` is conditional
 *
 * This is `ui/Tooltip`'s shipped kindred#2205 shape, not a new one: capture
 * on `document`, and swallow the key *only* while topmost.
 *
 * Both halves are load-bearing, and bubble-phase would break the first.
 * Twelve of kindred#2237's overlays are still unconverted, and one of them
 * — `CamperDetailsPanel` — installs a capture-phase `document` listener that
 * calls `stopPropagation()` unconditionally. A capture-phase stop at
 * `document` halts the event before the bubble phase begins, so a
 * bubble-phase `document` listener never runs at all. An adopter of this
 * hook stacked ABOVE such a listener would therefore lose Escape entirely,
 * which is worse than the double-close it replaced: the overlay the key was
 * pressed for stays open while the one underneath it closes.
 *
 * The conditional stop is the other half. Unconverted overlays that listen
 * on `document` or `window` in the BUBBLE phase (`CsvPipelineIndicator`,
 * `SocialNetworkGraph`, `metrics/DrillDownModal`, …) would otherwise close
 * alongside an adopter that is genuinely on top — the original kindred#2205
 * defect. Swallowing while topmost prevents that; NOT swallowing while a
 * token-gated overlay sits above us is what lets that overlay's own listener
 * (bubble-phase, gated identically) receive the key it owns.
 *
 * This does not fix the unconverted capture-phase listener above; only
 * converting `CamperDetailsPanel` can, and kindred#2237 is explicit that
 * each component is its own call. It does guarantee this hook never makes
 * that pairing worse.
 *
 * ## Why the callback is held in a ref
 *
 * The effect depends on `isOpen` alone. A caller passing an inline arrow
 * gets a fresh `onEscape` identity every render; if the token were tied to
 * that identity, an ordinary re-render of a BACKGROUND overlay — a query
 * refetch, a parent state change — would release and re-acquire its token,
 * republishing it as topmost and stealing Escape from whatever genuinely is
 * on top. The ref keeps the token's lifetime equal to the overlay's while
 * still invoking the latest callback.
 */
export function useOverlayEscape(isOpen: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!isOpen) return

    const token = acquireOverlayToken()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isTopOverlay(token)) return
      e.stopPropagation()
      onEscapeRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      releaseOverlayToken(token)
    }
  }, [isOpen])
}
