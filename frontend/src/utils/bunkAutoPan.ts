/**
 * Auto-pan utility: when the camper detail panel opens, scroll the page so the
 * selected camper's own bunk card is visible.
 *
 * The bunk board has no inner overflow container — the page scrolls on the
 * document/window (the session header is `sticky top-0`). So we bring the bunk
 * element into the viewport with `scrollIntoView`, which walks up to the real
 * scroll root automatically. (An earlier version scrolled a wrapper div's
 * `scrollTop`, which is inert because that wrapper never scrolls.)
 *
 * Extracted so the logic can be unit-tested independently of the DOM layout.
 */

/**
 * Vertical buffer (px). A bunk whose top sits above this band counts as hidden
 * behind the sticky session header, so auto-pan re-centres it.
 */
const STICKY_HEADER_OFFSET = 80

/**
 * Returns the scroll target element for a given bunk CM ID within a root.
 * Returns null if no matching element is found.
 *
 * Elements are expected to carry `data-bunk-cm-id="<cm_id>"` on the bunk card
 * root (set by BunkCard).
 */
export function findBunkElement(bunkCmId: number, root: ParentNode): Element | null {
  return root.querySelector(`[data-bunk-cm-id="${bunkCmId}"]`)
}

/**
 * Returns true when `rect` is fully within the viewport and clear of the
 * sticky header band at the top.
 */
export function isBunkFullyVisible(rect: DOMRect, viewportHeight: number): boolean {
  return rect.top >= STICKY_HEADER_OFFSET && rect.bottom <= viewportHeight
}

/**
 * Scrolls `bunkEl` into the viewport (centred) when it is off-screen or hidden
 * behind the sticky header. No-ops when the bunk is already comfortably visible
 * or when `scrollIntoView` is unavailable.
 */
export function scrollBunkIntoView(bunkEl: Element): void {
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
  const rect = bunkEl.getBoundingClientRect()
  if (isBunkFullyVisible(rect, viewportHeight)) return
  if (typeof bunkEl.scrollIntoView === 'function') {
    bunkEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

/**
 * High-level convenience: find the bunk element by CM ID (scoped to `boardRoot`
 * when provided, else the whole document) and scroll it into view. No-ops
 * gracefully if the ID or matching element is missing.
 *
 * @param bunkCmId - The CampMinder bunk CM ID to locate
 * @param boardRoot - The board element to scope the lookup to (falls back to document)
 */
export function autoPanToBunk(
  bunkCmId: number | null | undefined,
  boardRoot: ParentNode | null
): void {
  if (bunkCmId == null) return
  const root: ParentNode = boardRoot ?? document
  const el = findBunkElement(bunkCmId, root)
  if (!el) return
  scrollBunkIntoView(el)
}
