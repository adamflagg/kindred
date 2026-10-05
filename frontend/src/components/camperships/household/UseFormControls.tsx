import type {
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidIncome,
} from '../../../types/api-types'
import { disagreeWords, formChoices, type FormChoice } from './formsModel'
import {
  HH_AMBER_NOTE,
  HH_BUTTON,
  HH_FORMS_DONE,
  HH_FORMS_REASON,
  HH_FORMS_REASON_LABEL,
  HH_FORMS_STRIP,
  HH_FORMS_STRIP_ROW,
} from './householdStyles'
import type { FormsControl, Outcome, Where } from './useFormsControl'

function OutcomeLines({ outcome }: { outcome: Outcome }) {
  return (
    <div className={outcome.refused ? HH_AMBER_NOTE : HH_FORMS_DONE}>
      {outcome.words.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}

function FormButtons({
  income,
  choices,
  control,
  from,
}: {
  income: ApiAidIncome
  choices: readonly FormChoice[]
  control: FormsControl
  from: Where
}) {
  return (
    <>
      {choices.map((choice) => (
        <button
          key={choice.personCmId}
          type="button"
          className={HH_BUTTON}
          disabled={control.busy}
          onClick={() => control.send(income, choice, from)}
        >
          {`Use ${choice.name}'s Form`}
        </button>
      ))}
    </>
  )
}

/**
 * The income-conflict banner's "Use X's Form" buttons, ahead of "Enter the Income ↓": one per form
 * the request's household's open conflicts name, sending the strip's reason when one is typed. What
 * a click from here did shows beside them.
 */
export function UseFormButtons({
  page,
  request,
  control,
}: {
  page: ApiAidHouseholdPage
  request: ApiAidHouseholdRequest
  control: FormsControl
}) {
  const income = page.incomes.find((i) => i.household_cm_id === request.row.household_cm_id)
  if (income === undefined) return null
  const choices = formChoices(page, income)
  const outcome = control.outcomeOf(income.household_cm_id)
  const said = outcome !== null && outcome.from === 'banner' ? outcome : null
  if (choices.length === 0 && said === null) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {said !== null && <OutcomeLines outcome={said} />}
      <FormButtons income={income} choices={choices} control={control} from="banner" />
    </span>
  )
}

/**
 * The strip above a household's disagreeing answers: "4 answers disagree between Emma's form and
 * Noah's form.", an optional reason, and one "Use X's Form" per form. Shown only while a conflict
 * flag is open; what the last Use X's Form did stays under it once the conflict is gone.
 */
export function UseFormStrip({
  page,
  income,
  control,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  control: FormsControl
}) {
  const choices = formChoices(page, income)
  const words = disagreeWords(page, income)
  const outcome = control.outcomeOf(income.household_cm_id)
  if (choices.length === 0) {
    return outcome === null ? null : (
      <div className="mb-2">
        <OutcomeLines outcome={outcome} />
      </div>
    )
  }
  const id = income.household_cm_id
  return (
    <div data-testid="forms-strip" className={HH_FORMS_STRIP}>
      {words !== null && (
        <p>
          <b>{words.count}</b>
          {words.rest}
        </p>
      )}
      <div className={HH_FORMS_STRIP_ROW}>
        <label className={HH_FORMS_REASON_LABEL}>
          Reason (optional)
          <input
            type="text"
            value={control.reasonOf(id)}
            maxLength={2000}
            onChange={(event) => control.setReason(id, event.target.value)}
            className={HH_FORMS_REASON}
          />
        </label>
        <FormButtons income={income} choices={choices} control={control} from="strip" />
      </div>
      {outcome !== null && (
        <div className="mt-1.5">
          <OutcomeLines outcome={outcome} />
        </div>
      )}
    </div>
  )
}
