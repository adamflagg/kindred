/**
 * The tables inside a Rules card (design-language §8; the mock's `.cf-rcard table`): a card-white table card, the
 * header fill, a light rule on every column (the first cell drops it), 14px cells. A first column of a column group
 * takes the firmer rule. Built from the kit's own TH/TD so the rule and fill never drift from the report tables.
 */
import { CS_RULE, CS_RULE_GROUP } from '../../kit/csType'
import { TABLE_CARD, TD, TH } from '../../kit/kitStyles'

/** The table's card: white, rounded, bordered, scrolling sideways rather than breaking the card. */
export const RG_WRAP = `${TABLE_CARD} mt-1.5`
export const RG_TABLE = 'w-full border-separate border-spacing-0 text-sm'
/** A table the mock draws at its content width (fit(): the equity weights, the checks): the card hugs the table. */
export const RG_WRAP_FIT = `${RG_WRAP} inline-block max-w-full align-top`
export const RG_TABLE_FIT = RG_TABLE.replace('w-full', 'w-auto')
// One text-align per class string: the kit's TH carries text-left, so the others swap it rather than add a second.
export const RG_TH = TH
export const RG_TH_NUM = TH.replace('text-left', 'text-right')
export const RG_TH_MID = TH.replace('text-left', 'text-center')
/** The same headers, as the first column of a column group (the firmer rule). */
export const RG_TH_GROUP = TH.replace(CS_RULE, CS_RULE_GROUP)
export const RG_TH_GROUP_NUM = RG_TH_GROUP.replace('text-left', 'text-right')
export const RG_TH_GROUP_MID = RG_TH_GROUP.replace('text-left', 'text-center')
const CELL = TD.replace('align-top', 'align-middle').replace('overflow-hidden ', '')
export const RG_TD = `${CELL} whitespace-nowrap`
export const RG_TD_NUM = `${RG_TD} text-right tabular-nums`
export const RG_TD_MID = `${RG_TD} text-center`
export const RG_TD_NAME = `${RG_TD} font-bold`
export const RG_TD_GROUP_NUM = RG_TD_NUM.replace(CS_RULE, CS_RULE_GROUP)
