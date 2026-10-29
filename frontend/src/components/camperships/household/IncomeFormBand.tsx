import type { ReactNode } from 'react'

import { CS_BAND, CS_BAND_EDGE } from '../kit/kitStyles'
import { FormSourceMark } from '../kit/Pills'
import { answerSetHead, type AnswerSet } from './answerSets'
import { HH_TD } from './householdStyles'

/**
 * The band row that opens one answer set in the household's Income table (adult aid form design GF-2 B; mock v2 step
 * 22): it reads like a group row (one green band, design-language rule 8), its chip the same `FormSourceMark` Form
 * intake uses, so a form is named the same way on both pages. A correction names the set it changes, so the set's
 * own Income Correction… sits in the band. Only a household where an adult filed the adult aid form shows two sets.
 */
export function IncomeFormBand({
  set,
  programs,
  span,
  correct,
}: {
  set: AnswerSet
  programs: Readonly<Record<string, string>>
  /** The columns the words span; the correction slot takes the last. */
  span: number
  correct?: ReactNode
}) {
  const head = answerSetHead(set, programs)
  const band = `${HH_TD} ${CS_BAND} ${CS_BAND_EDGE} font-semibold`
  return (
    <tr data-answer-set={set.source}>
      <td colSpan={span} className={band}>
        <span className="mr-1.5 align-[1px]">
          <FormSourceMark source={set.source} />
        </span>
        {head.name}
        <span className="text-muted-foreground ml-2 text-[12.5px] font-normal">{head.meta}</span>
      </td>
      <td className={band}>{correct}</td>
    </tr>
  )
}
