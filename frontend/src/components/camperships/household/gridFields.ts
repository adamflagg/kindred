/**
 * The fields inside an EditorGrid (conformance #g6; .cf-field). Kept apart from householdStyles on
 * purpose: the kit's csType aliases householdStyles, so householdStyles cannot import the kit.
 */
import { CS_FIELD } from '../kit/csType'

/** The kit grid's fields (conformance #g6; .cf-field): a typed reason or note fills its cell. */
export const HH_GRID_TEXT = `${CS_FIELD} w-full`
/** A count or a percentage: 72px, right-aligned (.cf-field.num). */
export const HH_GRID_NUMBER = `${CS_FIELD} w-[72px] text-right tabular-nums`
/** An amount in a grid: 96px, right-aligned. */
export const HH_GRID_MONEY = `${CS_FIELD} w-[96px] text-right tabular-nums`
/** Correct…'s Used figure: 120px, right-aligned. */
export const HH_GRID_USED = `${CS_FIELD} w-[120px] text-right tabular-nums`
/** A CampMinder id: 112px. */
export const HH_GRID_ID = `${CS_FIELD} w-[112px] tabular-nums`
/** The unit beside a figure ($ or %): muted, on the field's line. */
export const HH_GRID_UNIT = 'text-muted-foreground inline-flex items-center gap-1.5 text-[13.5px]'
