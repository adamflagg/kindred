/**
 * Money's class strings for To place (final UX): in the kit's grammar, every raw palette colour with
 * its `dark:` partner, `text-xs` the floor. The done note, the green "Marks Posted" text and the
 * blue grant rule are retired (design-language §9, §16): the green band, the ok tokens and `Does`
 * and `Effects` replace them.
 */

/**
 * A group's, or a section's, heading (design-language §19): bold DM Sans 13.5, never the display serif.
 * It is a span or a button, never an h3: bare headings are styled outside the cascade layers (csType.ts).
 */
export const GROUP_HEADING = 'text-foreground text-[13.5px] leading-normal font-bold'

/** The heading row: the heading, its muted count, and (right) the group's own bulk button. */
export const GROUP_HEADING_ROW = 'mt-3.5 mb-1 ml-0.5 flex items-baseline gap-2'

/** The fold caret before a group's heading. */
export const GROUP_CARET = 'mr-1 inline-block w-3'

/**
 * @deprecated To place no longer wears these (the status slot, the ok tokens and `Effects` replace
 * them). Money › Grants and Money › Funders still import them until their own screens land.
 */
export const MARK_TEXT = 'text-emerald-700 dark:text-emerald-400'
/** @deprecated See `MARK_TEXT`. */
export const DONE_NOTE =
  'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
