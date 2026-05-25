/**
 * Auto-pan utility: when the camper detail panel opens, scroll the bunk board
 * so the selected camper's own bunk card is visible.
 *
 * Extracted so the logic can be unit-tested independently of the DOM layout.
 */

/**
 * Returns the scroll target element for a given bunk CM ID within a scroll
 * container. Returns null if no matching element is found.
 *
 * Elements are expected to carry `data-bunk-cm-id="<cm_id>"` on the bunk card
 * root (set by BunkCard).
 */
export function findBunkElement(bunkCmId: number, container: ParentNode): Element | null {
  return container.querySelector(`[data-bunk-cm-id="${bunkCmId}"]`)
}

/**
 * Scrolls `bunkEl` into view within `scrollContainer` using smooth behaviour.
 *
 * The element is scrolled to be visible near the top of the container,
 * with a small top offset so it isn't flush against the sticky header.
 */
export function scrollBunkIntoView(bunkEl: Element, scrollContainer: Element): void {
  const containerRect = scrollContainer.getBoundingClientRect()
  const elRect = bunkEl.getBoundingClientRect()
  const TOP_OFFSET = 16 // px buffer from top edge of scroll container

  const isAbove = elRect.top < containerRect.top + TOP_OFFSET
  const isBelow = elRect.bottom > containerRect.bottom

  if (isAbove || isBelow) {
    const scrollTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - TOP_OFFSET
    if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' })
    } else {
      // Fallback for environments (JSDOM) that don't implement scrollTo
      scrollContainer.scrollTop = scrollTop
    }
  }
}

/**
 * High-level convenience: find the bunk element by CM ID and scroll it into
 * view. No-ops gracefully if either the element or container is missing.
 *
 * @param bunkCmId - The CampMinder bunk CM ID to locate
 * @param scrollContainer - The scroll container that wraps the bunk board
 */
export function autoPanToBunk(
  bunkCmId: number | null | undefined,
  scrollContainer: Element | null
): void {
  if (bunkCmId == null || !scrollContainer) return
  const el = findBunkElement(bunkCmId, scrollContainer)
  if (!el) return
  scrollBunkIntoView(el, scrollContainer)
}
