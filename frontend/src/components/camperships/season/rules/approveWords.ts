/** What the Approve panel and the Season notice say (spec §4). Pure. */
import type { ApiAidFieldChange } from '../../../../types/api-types'
import type { Approved } from './ApproveForm'
import { changeWords, type RulesNames } from './rulesModel'

/**
 * What an approval says follows (moved verbatim from RulesTab: the product's reviewed wording, interim S8-⚠1). The
 * season is priced by the newest version in which every pricing section is approved or locked, so approving some
 * sections re-prices nothing. A posted amount stands either way (S1 Q1).
 */
export function approvedNotice({ pricing, warnings }: Approved): string {
  return [
    pricing === 'moved'
      ? 'Approved. Requests not yet posted are priced on the new rules; a posted amount stands.'
      : pricing === 'already'
        ? 'Approved. The sections that price the season were already approved: nothing is re-priced.'
        : 'Approved. Nothing is re-priced until every section that prices the season is approved. A posted amount stands.',
  ]
    .concat(warnings.length === 0 ? [] : ['', ...warnings])
    .join('\n')
}

/** A section's changes on one line beside its checkbox ("Share: 87.5% → 86.5% · …"). */
export function sectionChangeWords(
  changes: readonly ApiAidFieldChange[],
  names?: RulesNames
): string {
  return changes.map((change) => changeWords(change, names)).join(' · ')
}
