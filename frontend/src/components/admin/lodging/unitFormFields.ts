/**
 * Field styling and code derivation shared by the unit form's sections.
 *
 * The form is split into sections — identity, capacity, amenities, placement —
 * so no one file accumulates every field. The spec names `BunkingBoardByArea`
 * (849 lines) as the shape not to repeat.
 */

/** One text, number or select control. */
export const FIELD =
  'border-border bg-background focus:ring-primary/50 w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none'

/** The caption above a control. */
export const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

/**
 * A section heading. Same uppercase-xs grammar as the units table's area
 * headings and the roster's `UnitInventoryPanel` — the editor and the read
 * side are one product. `first:` clears the rule above the opening section,
 * which works because each section renders as a fragment, so the heading is a
 * direct child of the form grid.
 */
export const SECTION =
  'border-border/60 text-muted-foreground mt-1 border-t pt-3 text-xs font-semibold tracking-wide uppercase first:mt-0 first:border-t-0 first:pt-0 sm:col-span-2'

/**
 * Derive a stable slug from the display name.
 *
 * `code` is a real join key — `bathroom_group` membership matches on codes and
 * the roster keys on `unit_code` — so it is generated once on create and only
 * editable behind a disclosure. Renaming an existing code is not safe.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
