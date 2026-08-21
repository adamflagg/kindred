/**
 * Predicate used by the boards' global click-outside handlers to decide
 * whether a click should dismiss the side panels (CamperDetailsPanel /
 * LockGroupPanel on the summer board, FamilyDetailsPanel on the weekend
 * lodging board). Returns true iff the click should NOT trigger dismiss.
 *
 * Shared between the live handlers and its unit test so they cannot drift.
 */
export function shouldKeepPanelsOpen(e: {
  ctrlKey: boolean
  metaKey: boolean
  target: EventTarget | null
}): boolean {
  // Ctrl/Meta-modified clicks are reserved for the friend-group selection
  // workflow and must never dismiss panels.
  if (e.ctrlKey || e.metaKey) return true

  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false

  // A target that is no longer in the document was removed by this very
  // click's own handling, and every check below is `closest()`, which walks
  // ancestors an orphan no longer has — so it would match nothing and the
  // click would read as dead space.
  //
  // This is not a corner case: a toggle that swaps one icon component for
  // another (`ChevronDown` -> `ChevronRight`) unmounts the clicked node
  // rather than mutating it, and React flushes that re-render synchronously
  // for a discrete event at its root-container listener — which sits below
  // `document`, where the dead-space listener lives. Clicking the fold
  // chevron in `ShareRequestPanel` therefore dismissed `FamilyDetailsPanel`
  // (#2476) while clicking the label a few pixels right did not, because
  // only the icon was replaced.
  //
  // Detachment means the app handled the click, so keep the panels open.
  if (!target.isConnected) return true

  const isOnPanel = target.closest(
    '[data-panel="camper-details"], [data-panel="family-details"], [data-panel="lock-group"], [data-panel="lock-action-bar"], [data-panel="lock-group-picker"]'
  )
  const isOnFloatingBadge = target.closest('[data-floating-badge]')
  const isInteractive = target.closest(
    'button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"]'
  )
  const isContextMenu = target.closest('[data-context-menu]')
  const isModal = target.closest('[role="dialog"]')
  const isCard = target.closest('[data-camper-card], [data-bunk-card], [data-family-card]')

  return Boolean(
    isOnPanel ?? isOnFloatingBadge ?? isInteractive ?? isContextMenu ?? isModal ?? isCard
  )
}
