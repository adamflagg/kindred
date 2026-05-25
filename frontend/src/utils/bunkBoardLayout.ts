/**
 * Layout helper for the bunk board / camper-detail panel reflow.
 *
 * When the camper detail panel is open the bunk board must shrink to avoid
 * being occluded. We do this by giving the board container a right-margin
 * equal to the panel width, letting the board use the remaining space while
 * the panel renders as a `fixed` right-side column at the same width.
 *
 * Extracted from BunkingBoardByArea so the class-name logic can be tested
 * without mounting the full DnD/PocketBase-dependent component tree.
 */

/** Width of the CamperDetailsPanel (matches the `w-[28rem]` Tailwind class). */
export const PANEL_WIDTH_CLASS = 'w-[28rem]'

/**
 * Returns the CSS class(es) that should be applied to the bunk board outer
 * wrapper based on whether the camper detail panel is currently open.
 *
 * When open:  adds a right margin that matches the panel width so the board
 *             content stays visible and the panel doesn't occlude it.
 * When closed: no extra margin — board uses full available width.
 */
export function getBoardWrapperClass(isPanelOpen: boolean): string {
  return isPanelOpen ? 'mr-[28rem] transition-[margin] duration-200 ease-out' : ''
}

/**
 * Returns the bottom-padding class for the bunk board scroll container so
 * that fixed overlays (friend-groups hub button, lock-group action bar) never
 * occlude the last bunk's bottom row (#1630).
 *
 * LockGroupsHub: fixed left-4, ~40px tall, sits at `bottom-4` normally or
 *   `bottom-16` when the action bar is also present.
 * LockGroupActionBar: fixed bottom-0, full-width, ~56px tall.
 *
 * When the action bar is visible the hub shifts up to bottom-16 (4rem=64px),
 * so the combined clearance needed is ~64 + 40 = ~104px → use pb-32 (8rem).
 * When only the hub is visible the needed clearance is ~40 + 16 = ~56px →
 * use pb-20 (5rem) for comfortable headroom.
 *
 * @param isHubVisible  - true when LockGroupsHub is rendered (draft mode + manage)
 * @param isActionBarVisible - true when LockGroupActionBar has pending campers
 */
export function getBoardBottomPaddingClass(
  isHubVisible: boolean,
  isActionBarVisible: boolean
): string {
  if (isActionBarVisible) {
    // Action bar at bottom-0 plus hub shifted to bottom-16: need ~128px clearance.
    return 'pb-32'
  }
  if (isHubVisible) {
    // Hub button at bottom-4: need ~80px clearance.
    return 'pb-20'
  }
  return ''
}

/**
 * Returns the responsive grid-column classes for the bunk board.
 *
 * When the camper detail panel is open the board loses ~28rem of width to the
 * fixed panel (see {@link getBoardWrapperClass}). Rather than squish the same
 * column count into the narrower space — which makes the bunk cards too thin —
 * we drop one column per breakpoint so each card keeps roughly its closed-state
 * width and the board simply reflows to one more row.
 *
 * @param isPanelOpen - true when the camper detail panel is open
 */
export function getBunkGridClass(isPanelOpen: boolean): string {
  return isPanelOpen
    ? 'grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3'
    : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}
