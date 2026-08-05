/**
 * The lodging admin surface's visual grammar, in one place.
 *
 * This is the summer session area's language, extended — not a second one.
 * Buttons take the pill radius and semibold weight `SessionTabs` uses, table
 * headers and group headings take the uppercase-xs treatment the roster's
 * `HouseholdRosterTable` uses, and pills match `LodgingUnitCard`'s badge
 * shape. Six files render this surface; without one definition they drift
 * into six dialects, which is how an admin screen stops looking like the
 * product it edits.
 *
 * Every colour here is either a semantic token (`bg-muted`, `text-primary`)
 * that already resolves per theme, or is paired with a `dark:` counterpart.
 * `text-xs` is the floor — nothing smaller.
 */

/**
 * One text, number or select control. `FIELD_INLINE` carries no width, so a
 * caller can size it (`${FIELD_INLINE} w-20`) without fighting `w-full`.
 */
export const FIELD_INLINE =
  'border-border bg-background focus:ring-primary/50 rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none'
export const FIELD = `${FIELD_INLINE} w-full`

/** The caption above a control. */
export const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

/**
 * A form section heading. `first:` clears the rule above the opening section,
 * which works because each section renders as a fragment, so the heading is a
 * direct child of the form grid.
 */
export const SECTION =
  'border-border/60 text-muted-foreground mt-1 border-t pt-3 text-xs font-semibold tracking-wide uppercase first:mt-0 first:border-t-0 first:pt-0 sm:col-span-2'

/** The one action that commits something. */
export const BUTTON_PRIMARY =
  'bg-primary text-primary-foreground shadow-lodge-sm inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50'

/** Everything alongside it. */
export const BUTTON_SECONDARY =
  'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50'

/** An inline row action — Edit, Delete, Confirm. */
export const ACTION_LINK = 'text-xs font-medium hover:underline'

/** A status badge, in the roster's badge shape. */
export const PILL = 'rounded-full px-2 py-0.5 text-xs font-medium'
export const MUTED_PILL = `bg-muted text-muted-foreground ${PILL}`

/** A table's header row, and the heading over a group of rows. */
export const HEADER_ROW =
  'border-border text-muted-foreground border-b text-xs font-semibold tracking-wide uppercase'
export const GROUP_HEADING = 'text-muted-foreground text-xs font-semibold tracking-wide uppercase'
