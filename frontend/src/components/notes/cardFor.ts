/**
 * The card a corner belongs to, whichever real component drew it.
 *
 * Its own module, not exported alongside `SubjectNotePopover`: a `.tsx` file
 * that exports both a component and a plain function trips
 * `react-refresh/only-export-components` (see `components/ui/modalStack.ts`
 * for the same reasoning behind an earlier split).
 */
export function cardFor(anchor: HTMLElement | null): HTMLElement | null {
  if (!anchor) return null
  return (
    anchor.closest<HTMLElement>('[data-family-card]') ??
    anchor.closest<HTMLElement>('[data-camper-card]') ??
    anchor.parentElement?.querySelector<HTMLElement>('[data-camper-card]') ??
    anchor
  )
}
