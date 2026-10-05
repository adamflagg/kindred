/**
 * Income corrections by form (round 3, household-v3.html section 3): which campers' forms the
 * household's open conflicts name (one "Use X's Form" each), the strip's and the Correct… row's
 * words, and what a Use X's Form did. Pure: every figure is the server's conflict flag, read through
 * incomeModel's `conflictsOf`; nothing here decides which form is right.
 */
import type {
  ApiAidAnswer,
  ApiAidHouseholdPage,
  ApiAidIncome,
  ApiAidUseFormOut,
} from '../../../types/api-types'
import { answerValue, answerWords } from './householdModel'
import { conflictsOf, type FieldConflict } from './incomeModel'

/** A form a "Use X's Form" button names: whose it is, and how the page says their name. */
export interface FormChoice {
  readonly personCmId: number
  readonly name: string
}

const firstName = (name: string) => name.split(' ')[0] ?? name

/**
 * A form's owner as staff read it (item 9): the first name the income's `form_people` gives (any
 * household's: a person id is one person), else the camper's first name, else "person N". The
 * server leaves out someone with no persons row, so the fallbacks stay.
 */
export function formOwner(page: ApiAidHouseholdPage, personCmId: number): string {
  const named = page.incomes
    .flatMap((income) => income.form_people)
    .find((person) => person.person_cm_id === personCmId && person.first_name.trim() !== '')
  if (named !== undefined) return named.first_name.trim()
  const row = page.requests.find((r) => r.row.person_cm_id === personCmId && personCmId > 0)?.row
  return row === undefined || row.camper_name === ''
    ? `person ${String(personCmId)}`
    : firstName(row.camper_name)
}

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  const last = items.at(-1) ?? ''
  return items.length <= 1 ? last : `${items.slice(0, -1).join(', ')} and ${last}`
}

const answerOf = (income: ApiAidIncome, field: string) =>
  income.answers.find((a) => a.field === field)

/** The conflicts still open: their flag not resolved, and the answer not corrected yet. */
function openConflicts(income: ApiAidIncome): FieldConflict[] {
  return conflictsOf(income).filter(
    (c) => !c.resolved && answerOf(income, c.field)?.corrected !== true
  )
}

/**
 * One choice per form the household's unresolved conflict flags name, in the order they first name
 * them. None once every flag is resolved: there is nothing left for a form to settle.
 */
export function formChoices(page: ApiAidHouseholdPage, income: ApiAidIncome): FormChoice[] {
  const ids: number[] = []
  for (const conflict of conflictsOf(income)) {
    if (conflict.resolved) continue
    for (const variant of conflict.variants)
      for (const id of variant.personCmIds) if (!ids.includes(id)) ids.push(id)
  }
  return ids.map((personCmId) => ({ personCmId, name: formOwner(page, personCmId) }))
}

/** "4 answers disagree" (bold) and " between Emma's form and Noah's form."; null with none open. */
export function disagreeWords(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome
): { count: string; rest: string } | null {
  const open = openConflicts(income)
  if (open.length === 0) return null
  const ids: number[] = []
  for (const conflict of open)
    for (const variant of conflict.variants)
      for (const id of variant.personCmIds) if (!ids.includes(id)) ids.push(id)
  const owners = ids.map((id) => `${formOwner(page, id)}'s`)
  const forms =
    owners.length === 2
      ? `${owners[0] ?? ''} form and ${owners[1] ?? ''} form`
      : `${listWords(owners)} forms`
  return {
    count: open.length === 1 ? '1 answer disagrees' : `${String(open.length)} answers disagree`,
    rest: ` between ${forms}.`,
  }
}

/**
 * The words beside the "Use X's Form" buttons (owner ruling 10-05): a form is used only for the
 * answers that disagree (#3021's use-form contract), never for every answer, so the count is the
 * strip's. Null with none open.
 */
export function formHint(income: ApiAidIncome): string | null {
  const n = openConflicts(income).length
  if (n === 0) return null
  return n === 1 ? 'for the 1 answer that disagrees' : `for the ${String(n)} answers that disagree`
}

/**
 * The answer's casework button (household-v4 section 3, owner ruling 10-05): "Choose Which Form…" on
 * an answer the forms still disagree on, nothing settled; "Correct…" on a corrected or matching one.
 * Both open the same Correct… row, with its quick picks.
 */
export function correctLabel(income: ApiAidIncome, answer: ApiAidAnswer): string {
  if (answer.corrected) return 'Correct…'
  return conflictsOf(income).some((c) => c.field === answer.field && !c.resolved)
    ? 'Choose Which Form…'
    : 'Correct…'
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]
const numberWords = (n: number) => NUMBER_WORDS[n] ?? String(n)

/**
 * What saving a correction on this answer settles (the Correct… row's line): one of its flag's
 * answers still open. Only an income conflict holds the request (`household_income_conflict`), so
 * only it names the hold. Null when the answer is in no open conflict, or is already corrected.
 */
export function settleWords(income: ApiAidIncome, answer: ApiAidAnswer): string | null {
  if (answer.corrected) return null
  const own = openConflicts(income).find((c) => c.field === answer.field)
  if (own === undefined) return null
  const n = openConflicts(income).filter((c) => c.code === own.code).length
  if (own.code === 'income_conflict') {
    return n === 1
      ? 'This settles the last one. The hold clears.'
      : `This settles 1 of the ${String(n)}. The hold clears when all ${numberWords(n)} agree.`
  }
  return n === 1
    ? 'This settles the last answer the forms disagree on.'
    : `This settles 1 of the ${String(n)}.`
}

/** The Correct… row's head aside: "the forms say $30,000 (Emma) and $36,000 (Noah)"; null with no disagreement. */
export function formsSayWords(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome,
  answer: ApiAidAnswer
): string | null {
  const conflict = conflictsOf(income).find((c) => c.field === answer.field)
  if (conflict === undefined || conflict.variants.length < 2) return null
  const each = conflict.variants.map(
    (v) =>
      `${answerValue(answer.field, String(v.value))} (${listWords(v.personCmIds.map((id) => formOwner(page, id)))})`
  )
  return `the forms say ${listWords(each)}`
}

/** A quick pick in the Correct… row: it fills the Used field. `revert`: the way back to the form's figure. */
export interface CorrectionPick {
  readonly label: string
  readonly value: string
  readonly revert: boolean
}

/**
 * The Correct… row's picks: each form's figure where the forms disagree ("Emma's $30,000"), open or
 * settled; with one form, "The form's $X" on a corrected answer, the way back. None on an answer as
 * sent with one form: the field already holds the form's figure.
 */
export function correctionPicks(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome,
  answer: ApiAidAnswer
): CorrectionPick[] {
  const conflict = conflictsOf(income).find((c) => c.field === answer.field)
  if (conflict !== undefined && conflict.variants.length > 1) {
    return conflict.variants.map((v) => ({
      label: `${listWords(v.personCmIds.map((id) => `${formOwner(page, id)}'s`))} ${answerValue(answer.field, String(v.value))}`,
      value: String(v.value),
      revert: false,
    }))
  }
  if (!answer.corrected) return []
  return [
    {
      label: `The form's ${answerValue(answer.field, answer.synced)}`,
      value: answer.synced,
      revert: true,
    },
  ]
}

/**
 * What a Use X's Form did, in words (`others`: the other forms' owners when it was clicked). The
 * hold's truth is the refetched flag, not `still_disagreeing`: these say only what was written.
 */
export function formOutcomeWords(
  name: string,
  out: ApiAidUseFormOut,
  others: readonly string[]
): string[] {
  const words: string[] = []
  if (out.operation_id === '') {
    words.push(`Nothing to change: every answer already matches ${name}'s form.`)
  } else {
    const n = out.applied.length
    words.push(`Used ${name}'s form for ${String(n)} ${n === 1 ? 'answer' : 'answers'}.`)
  }
  if (out.skipped_blank.length > 0) {
    const labels = listWords(out.skipped_blank.map(answerWords))
    const it = out.skipped_blank.length === 1 ? 'it' : 'them'
    const other = others.length === 1 ? `${others[0] ?? ''}'s` : 'another form'
    words.push(`${name}'s form left ${labels} blank: correct ${it} by hand or use ${other}.`)
  }
  return words
}
