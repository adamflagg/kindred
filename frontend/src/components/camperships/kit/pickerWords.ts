/** One choice; `group` heads a run of choices in the popover (programs under their pool). */
export interface AidPickerOption<V extends string | number> {
  readonly value: V
  readonly label: string
  readonly group?: string
  /** A pickable heading (bold) or a choice under one (indented), where a group heading is not itself a choice. */
  readonly level?: 'heading' | 'indent'
  readonly disabled?: boolean
  /** The full words behind a short label: the button's title when picked, and the option's hover title. */
  readonly title?: string
}

/** A multi picker names its picks while they fit in this many characters, and counts them past it. */
const MULTI_ROOM = 22

/**
 * What a multi picker's button reads (kit CF.multiLabel): the none words when nothing is picked;
 * the picks' names while they fit; past that, "N {noun}".
 */
export function multiPickerWords<V extends string | number>(
  values: readonly V[],
  options: ReadonlyArray<AidPickerOption<V>>,
  noun: string,
  none: string
): string {
  if (values.length === 0) return none
  const names = namesOf(values, options)
  if (values.length === 1 || names.length <= MULTI_ROOM) return names
  return `${String(values.length)} ${noun}`
}

export function namesOf<V extends string | number>(
  values: readonly V[],
  options: ReadonlyArray<AidPickerOption<V>>
): string {
  // In the options' order, so the words never depend on the order staff checked them.
  return options
    .filter((o) => values.includes(o.value))
    .map((o) => o.label)
    .join(', ')
}
