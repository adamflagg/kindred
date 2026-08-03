import { useEffect, useRef } from 'react'

import { shouldKeepPanelsOpen } from '../utils/clickoutsidePredicate'

/**
 * Dismiss open side panels when the user clicks dead space — the nav, the page
 * margins, the gaps between cards. Shared by the summer bunking board and both
 * weekend lodging surfaces so the three cannot drift.
 *
 * NOT `useClickOutside`, which is ref-containment on `mousedown` with no
 * deferral. This one is predicate-based (`shouldKeepPanelsOpen`, itself shared
 * with its own unit test), listens on `click`, and attaches the listener a
 * macrotask after `isOpen` becomes true — matching the original summer
 * behaviour byte-for-byte. (React's own passive-effect scheduling already
 * defers this past the click that flips `isOpen`, so the extra macrotask
 * cannot be shown to change outcomes for that specific click via a unit test;
 * it is kept for behaviour parity with summer, not because a test proves it
 * necessary.)
 *
 * `onDismiss` is read through a ref so an inline arrow at the call site
 * doesn't churn the effect on every render — only `isOpen` flipping attaches
 * or tears down the listener.
 */
export function useDismissOnDeadSpace(isOpen: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!isOpen) return

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
  }, [isOpen])
}
