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
