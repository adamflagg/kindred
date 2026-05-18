/**
 * Predicate used by BunkingBoardByArea's global click-outside handler to decide
 * whether a click should dismiss the side panels (CamperDetailsPanel /
 * LockGroupPanel). Returns true iff the click should NOT trigger dismiss.
 *
 * Shared between the live handler and its unit test so the two cannot drift.
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
    '[data-panel="camper-details"], [data-panel="lock-group"], [data-panel="lock-action-bar"], [data-panel="lock-group-picker"]'
  )
  const isOnFloatingBadge = target.closest('[data-floating-badge]')
  const isInteractive = target.closest(
    'button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"]'
  )
  const isContextMenu = target.closest('[data-context-menu]')
  const isModal = target.closest('[role="dialog"]')
  const isCard = target.closest('[data-camper-card], [data-bunk-card]')

  return Boolean(
    isOnPanel ?? isOnFloatingBadge ?? isInteractive ?? isContextMenu ?? isModal ?? isCard
  )
}
