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
