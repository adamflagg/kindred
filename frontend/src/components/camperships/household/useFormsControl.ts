import { useRef, useState } from 'react'

import { useAidUseForm } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdPage, ApiAidIncome } from '../../../types/api-types'
import { formChoices, formOutcomeWords, type FormChoice } from './formsModel'

export type Where = 'banner' | 'strip'

/** What the last Use X's Form on a household did, or the server's refusal, and where it was clicked. */
export interface Outcome {
  readonly from: Where
  readonly words: readonly string[]
  readonly refused: boolean
}

/**
 * Use X's Form for the page (round 3, section 3): the strip's typed reason, per household, which the
 * hold banner's buttons send too; one POST at a time; and what the last one did. The household page
 * holds one, so the banner and the Income tab's strip share it.
 */
export interface FormsControl {
  readonly busy: boolean
  readonly reasonOf: (householdCmId: number) => string
  readonly setReason: (householdCmId: number, text: string) => void
  readonly outcomeOf: (householdCmId: number) => Outcome | null
  readonly send: (income: ApiAidIncome, choice: FormChoice, from: Where) => void
}

export function useFormsControl(page: ApiAidHouseholdPage): FormsControl {
  const write = useAidUseForm()
  const [reasons, setReasons] = useState<Readonly<Record<number, string>>>({})
  const [outcomes, setOutcomes] = useState<Readonly<Record<number, Outcome>>>({})
  const [busy, setBusy] = useState(false)
  // One click, one POST: a second click in the same tick, before `busy` disables the buttons, is ignored.
  const inFlight = useRef(false)
  // A new family (the queue walk's step) starts with no reason typed and nothing said.
  const [family, setFamily] = useState(page.household_cm_id)
  if (family !== page.household_cm_id) {
    setFamily(page.household_cm_id)
    setReasons({})
    setOutcomes({})
  }
  const said = (householdCmId: number, outcome: Outcome) =>
    setOutcomes((now) => ({ ...now, [householdCmId]: outcome }))
  return {
    busy,
    reasonOf: (householdCmId) => reasons[householdCmId] ?? '',
    setReason: (householdCmId, text) => setReasons((now) => ({ ...now, [householdCmId]: text })),
    outcomeOf: (householdCmId) => outcomes[householdCmId] ?? null,
    send: (income, choice, from) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      const householdCmId = income.household_cm_id
      // The other forms, named now: after the refetch the conflict may be gone.
      const others = formChoices(page, income)
        .filter((c) => c.personCmId !== choice.personCmId)
        .map((c) => c.name)
      write
        .mutateAsync({
          year: page.year,
          householdCmId,
          body: { person_cm_id: choice.personCmId, reason: (reasons[householdCmId] ?? '').trim() },
        })
        .then((out) => {
          said(householdCmId, {
            from,
            words: formOutcomeWords(choice.name, out, others),
            refused: false,
          })
          setReasons((now) => ({ ...now, [householdCmId]: '' }))
        })
        .catch((caught: unknown) => {
          const words = caught instanceof Error ? caught.message : "Couldn't use the form"
          said(householdCmId, { from, words: [words], refused: true })
        })
        .finally(() => {
          inFlight.current = false
          setBusy(false)
        })
    },
  }
}
