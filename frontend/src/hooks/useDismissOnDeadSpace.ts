import { useEffect, useRef } from 'react'

import { shouldKeepPanelsOpen } from '../utils/clickoutsidePredicate'

/**
 * Dismiss open side panels when the user clicks dead space — the nav, the page
 * margins, the gaps between cards. Shared by the summer bunking board and both
 * weekend lodging surfaces so the three cannot drift.
 *
 * NOT `useClickOutside`, which is ref-containment on `mousedown` with no
 * deferral. This one is predicate-based (`shouldKeepPanelsOpen`, itself shared
 * with its own unit test), listens on `click`, and attaches ONE MACROTASK LATE.
 *
 * That deferral is the load-bearing part: the click that opens a panel is
 * itself a click, so a listener that were already live would hear it and close
 * what the user just opened.
 *
 * `openKey` identifies WHICH panels are open, not merely whether any is — pass
 * null when nothing is. A second panel opening changes the key, which re-runs
 * the effect and re-arms the deferral, sparing the click that opened it. A
 * boolean would attach once on the first open and let the second panel dismiss
 * itself.
 */
export function useDismissOnDeadSpace(openKey: string | null, onDismiss: () => void): void {
  // The callback is read through a ref so an inline arrow at the call site
  // cannot re-arm the deferral on every render. Only openKey re-arms, and it
  // does so deliberately.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (openKey === null || openKey.length === 0) return

    const handler = (event: MouseEvent) => {
      if (shouldKeepPanelsOpen(event)) return
      onDismissRef.current()
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handler)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handler)
    }
  }, [openKey])
}
