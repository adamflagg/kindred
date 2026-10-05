/**
 * The Income tab's answers in columns (household-v4 section 3, owner ruling 10-05): one column per
 * form, then "Using". Pure, and read off the payload only: every figure is the server's.
 *
 * What "Using" holds on an answer the forms disagree on is api/services/financial_aid_household.py
 * `choose_household_answers`, as the payload already carries it: the answer's `effective` figure and
 * the conflict's variants. An INCOME answer is None (no income is used; the request holds). Any other
 * number is the figure the most forms give, a tie going to the figure whose lowest person id is
 * lowest. Both are read back here, never re-decided: a figure that matches no variant gets no note.
 */
import type { ApiAidAnswer, ApiAidHouseholdPage, ApiAidIncome } from '../../../types/api-types'
import { formOwner } from './formsModel'
import { answerValue } from './householdModel'
import { conflictsOf, type FieldConflict, type Variant } from './incomeModel'

const HOLD_CODE = 'household_income_conflict'
const OVERRIDE_FIELD = 'income_override'

/** One form's column: whose form, and its header ("Emma's form"). */
export interface FormColumn {
  readonly personCmId: number
  readonly head: string
}

/**
 * The household's forms, by person id: everyone `form_people` names (its members and every conflict
 * holder with a persons row) and every holder the conflicts name, settled or not. None or one means
 * the one-form table ("Family's answer").
 */
export function formColumns(page: ApiAidHouseholdPage, income: ApiAidIncome): FormColumn[] {
  const ids = new Set(income.form_people.map((person) => person.person_cm_id))
  for (const conflict of conflictsOf(income))
    for (const variant of conflict.variants) for (const id of variant.personCmIds) ids.add(id)
  return [...ids]
    .filter((id) => id > 0)
    .sort((a, b) => a - b)
    .map((personCmId) => ({ personCmId, head: `${formOwner(page, personCmId)}'s form` }))
}

/**
 * open: the forms disagree and nothing settled it (amber, the why, Choose Which Form…). settled: a
 * correction, or the flag's own resolution (an income override). plain: no disagreement.
 */
export type AnswerState = 'open' | 'settled' | 'plain'

export function answerState(
  answer: ApiAidAnswer,
  conflict: FieldConflict | undefined
): AnswerState {
  if (conflict === undefined) return 'plain'
  return conflict.resolved || answer.corrected ? 'settled' : 'open'
}

/** A form's figure in its column; `struck`: one the settling correction did not use. */
export interface FormFigure {
  readonly text: string
  readonly struck: boolean
}

/**
 * One form's figure for an answer the forms disagree on: its variant's figure (a dash for a form that
 * gave none), struck once a correction used another. An answer nobody disputes has no per-form figure
 * in the payload, so it has no form cells: the table shows it once across them (main's ruling 10-05).
 */
export function formFigure(
  answer: ApiAidAnswer,
  conflict: FieldConflict,
  personCmId: number
): FormFigure {
  const variant = conflict.variants.find((v) => v.personCmIds.includes(personCmId))
  if (variant === undefined) return { text: '—', struck: false }
  return {
    text: answerValue(answer.field, String(variant.value)),
    struck: answer.corrected && variant.value !== Number(answer.effective),
  }
}

type Chosen =
  | { readonly kind: 'most'; readonly count: number; readonly of: number }
  | { readonly kind: 'tie'; readonly personCmId: number }

/** How the server chose a disagreeing number, read back from the figure used; null when unreadable. */
function chosenOf(answer: ApiAidAnswer, conflict: FieldConflict): Chosen | null {
  if (answer.effective.trim() === '') return null
  const chosen = conflict.variants.find((v: Variant) => v.value === Number(answer.effective))
  if (chosen === undefined || chosen.personCmIds.length === 0) return null
  const count = chosen.personCmIds.length
  const others = conflict.variants.filter((v) => v !== chosen)
  // A figure fewer forms give than another's is not the server's choice: say nothing.
  if (others.some((v) => v.personCmIds.length > count)) return null
  if (others.some((v) => v.personCmIds.length === count)) {
    return { kind: 'tie', personCmId: Math.min(...chosen.personCmIds) }
  }
  const of = conflict.variants.reduce((n, v) => n + v.personCmIds.length, 0)
  return { kind: 'most', count, of }
}

/**
 * The muted note under "Using" on an unsettled disagreeing answer: "on hold" for income, else "2 of 3
 * forms" (out of the forms that gave a figure) or "tie: Emma's form". Null otherwise.
 */
export function usingNote(
  page: ApiAidHouseholdPage,
  answer: ApiAidAnswer,
  conflict: FieldConflict | undefined
): string | null {
  if (conflict === undefined || answerState(answer, conflict) !== 'open') return null
  if (conflict.code === 'income_conflict') return 'on hold'
  const chosen = chosenOf(answer, conflict)
  if (chosen === null) return null
  return chosen.kind === 'tie'
    ? `tie: ${formOwner(page, chosen.personCmId)}'s form`
    : `${String(chosen.count)} of ${String(chosen.of)} forms`
}

/** The rounds the household's income conflict holds, from its held requests' stages. */
function heldRounds(page: ApiAidHouseholdPage, income: ApiAidIncome): number[] {
  const rounds = page.requests
    .filter(
      (r) =>
        r.row.household_cm_id === income.household_cm_id &&
        r.row.holds.some((hold) => hold.code === HOLD_CODE)
    )
    .flatMap((r) => (r.row.stage?.round == null ? [] : [r.row.stage.round]))
  return [...new Set(rounds)].sort((a, b) => a - b)
}

function holdClause(rounds: readonly number[]): string {
  if (rounds.length === 0) return ''
  if (rounds.length === 1) return `, so Round ${String(rounds[0])} waits on hold`
  const last = rounds.at(-1) ?? 0
  return `, so Rounds ${rounds.slice(0, -1).join(', ')} and ${String(last)} wait on hold`
}

/**
 * The amber line under an unsettled disagreeing answer: only the why, since the columns show each
 * form's figure. Once a correction settles it the line goes (the struck figures and the "corrected"
 * pill say it); an income override, which strikes nothing, still says it settled it.
 */
export function whyWords(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome,
  answer: ApiAidAnswer,
  conflict: FieldConflict | undefined
): string | null {
  const state = answerState(answer, conflict)
  if (conflict === undefined || state === 'plain') return null
  if (state === 'settled') {
    const overridden =
      !answer.corrected &&
      (income.answers.find((a) => a.field === OVERRIDE_FIELD)?.effective.trim() ?? '') !== ''
    return overridden ? 'The income override settles it.' : null
  }
  if (conflict.code === 'income_conflict') {
    return `The forms disagree. No income is used until one is picked${holdClause(heldRounds(page, income))}.`
  }
  const chosen = chosenOf(answer, conflict)
  if (chosen === null) return 'The forms disagree.'
  return chosen.kind === 'tie'
    ? 'The forms disagree. Until one is picked, a tie uses the form with the lower CampMinder id.'
    : 'The forms disagree. Until one is picked, the figure most forms give is used.'
}
