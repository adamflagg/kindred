/**
 * Layout helpers for the bunk board.
 *
 * The camper detail panel is a plain `fixed right-0` slide-in overlay: opening
 * it never moves the board (no reflow, no column drop), so staff keep the bunk
 * they're working on in place. The only board-layout concern left here is
 * clearing the fixed friend-groups hub / action bar overlays (#1630).
 */

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
