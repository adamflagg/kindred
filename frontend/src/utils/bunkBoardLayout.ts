/**
 * Layout helpers for the bunk board / camper-detail panel reflow.
 *
 * When the camper detail panel opens it renders as a `fixed right-0` column.
 * The board sits in a centered `max-w-7xl` (1280px) container, so on wide
 * screens it does NOT span the viewport — background gutters appear on both
 * sides. We therefore reflow the board only by the panel's *actual overlap*
 * onto it (measured at runtime), never a flat panel-width margin: wide screens
 * stay untouched, narrow screens compress and reflow. See {@link computeBoardReflow}.
 *
 * Extracted from BunkingBoardByArea so the math can be unit-tested without
 * mounting the full DnD/PocketBase-dependent component tree.
 */

/** Width of the CamperDetailsPanel in px (its `w-[28rem]` = 28 × 16px = 448px). */
export const PANEL_WIDTH_PX = 448

/** Minimum comfortable bunk-card width (px) before we drop a grid column. */
const MIN_CARD_WIDTH_PX = 256

/** Inter-card grid gap (px) — matches the `gap-3` (0.75rem) used by the grid. */
const GRID_GAP_PX = 12

export interface BoardReflowInput {
  /** Board content's left edge in viewport px, with no trim applied. */
  boardNaturalLeft: number
  /** Board content's right edge in viewport px, with no trim applied. */
  boardNaturalRight: number
  /** Viewport width in px (window.innerWidth). */
  viewportWidth: number
  /** Panel width in px. Defaults to {@link PANEL_WIDTH_PX}. */
  panelWidth?: number
  /** Min comfortable card width in px. Defaults to MIN_CARD_WIDTH_PX. */
  minCardWidth?: number
  /** Grid gap in px. Defaults to GRID_GAP_PX. */
  gap?: number
}

export interface BoardReflowResult {
  /** Right margin (px) to apply to the board wrapper so it clears the panel. 0 = no trim. */
  marginRightPx: number
  /** True when the trim leaves too little width for the base column count. */
  dropColumn: boolean
  /** True when a column actually reflowed — the only case where auto-pan should fire. */
  didReflow: boolean
}

/**
 * Tailwind column count for the *closed* board at a given viewport width,
 * mirroring getBunkGridClass's breakpoints (grid-cols-1 / sm:2 / lg:3 / xl:4).
 */
function baseColumnsForViewport(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 4 // xl
  if (viewportWidth >= 1024) return 3 // lg
  if (viewportWidth >= 640) return 2 // sm
  return 1
}

/**
 * Decide how much (if at all) to reflow the bunk board when the camper-detail
 * panel opens.
 *
 * The left gutter is reserved for friend-group popouts, so width can only be
 * reclaimed from the right. We trim the board by exactly the panel's overlap
 * onto it (clamped ≥ 0), never the flat panel width:
 *
 *  - Wide screens (≥ ~2176px): the right gutter already swallows the panel →
 *    zero overlap → no trim, no column drop, no pan (board looks pre-reflow).
 *  - Mid screens (~1920): a small overlap is trimmed; the board keeps its
 *    column count, so nothing reflows vertically and we must NOT pan.
 *  - Narrow screens (~1500 and below): the trim is large enough that the base
 *    column count no longer fits → drop a column, and pan so the selected
 *    bunk stays visible after the rows reflow.
 */
export function computeBoardReflow({
  boardNaturalLeft,
  boardNaturalRight,
  viewportWidth,
  panelWidth = PANEL_WIDTH_PX,
  minCardWidth = MIN_CARD_WIDTH_PX,
  gap = GRID_GAP_PX,
}: BoardReflowInput): BoardReflowResult {
  const panelLeft = viewportWidth - panelWidth
  const overlap = boardNaturalRight - panelLeft
  const marginRightPx = Math.max(0, Math.ceil(overlap))

  const trimmedWidth = boardNaturalRight - boardNaturalLeft - marginRightPx
  const maxColumns = Math.floor((trimmedWidth + gap) / (minCardWidth + gap))
  const dropColumn = maxColumns < baseColumnsForViewport(viewportWidth)

  return { marginRightPx, dropColumn, didReflow: dropColumn }
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
 * When the panel's trim is large enough to over-narrow the board
 * ({@link computeBoardReflow} returns `dropColumn: true`), we drop one column
 * per breakpoint so each card keeps roughly its closed-state width and the
 * board reflows to one more row. On wide screens the trim is small (or zero),
 * `dropColumn` is false, and the board keeps its full column count.
 *
 * @param compress - true when the board should drop a column (dropColumn)
 */
export function getBunkGridClass(compress: boolean): string {
  return compress
    ? 'grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3'
    : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}
