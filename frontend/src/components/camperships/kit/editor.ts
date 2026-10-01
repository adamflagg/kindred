/**
 * The shared request editor's rules (§4.6; D22): reading a typed amount, and which edits need a
 * reason. The editor shows and keys; the server computes the award and refuses what is wrong.
 */
import type { CancellationIn } from '../../../types/api-generated'
import { formatShortDate } from './dates'

export type MoneyInput =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ok'; readonly amount: number }
  | { readonly kind: 'invalid'; readonly reason: string }

/** The server's text limits (`_Note`/`_Reason` 2000, `_Statement` 4000). */
const NOTE_MAX = 2000
const STATEMENT_MAX = 4000

/** The server's limit on an aid amount (api/schemas/financial_aid_decisions.py `_Amount`). */
const MAX_AMOUNT = 1_000_000

/** "1,200", "$1,200.50", " 900 " → a non-negative amount, at most two places of cents. */
export function parseMoneyInput(raw: string): MoneyInput {
  const text = raw.trim().replace(/^\$\s*/, '')
  if (text === '') return { kind: 'empty' }
  // Commas are thousands groups only: "12,50" is not twelve-fifty, and "1,2,3" is not 123.
  const grouped = /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(text)
  const plain = /^\d+(\.\d+)?$/.test(text)
  if (!grouped && !plain) return { kind: 'invalid', reason: 'Not an amount' }
  const digits = text.replaceAll(',', '')
  if (!/^\d+(\.\d{1,2})?$/.test(digits))
    return { kind: 'invalid', reason: 'Cents go to two places' }
  const amount = Number(digits)
  if (amount > MAX_AMOUNT) return { kind: 'invalid', reason: 'More than $1,000,000' }
  return { kind: 'ok', amount }
}

/** D141's nine reasons, as the server's `CancellationIn` types them. */
export type CancelReason = NonNullable<CancellationIn['reason']>

/**
 * Worded as spec §6.3 shows them. `satisfies` makes `tsc` fail if the server's list gains, loses
 * or renames a reason (Ruling 2026-10-01 (plan review), finding 5).
 */
const CANCEL_REASON_LABELS = {
  aid_not_enough: 'declined: aid not enough / financial constraints',
  medical: 'medical',
  schedule: 'schedule',
  not_ready: 'not ready',
  did_not_want_to_appeal: 'did not want to appeal',
  not_financially_related: 'not financially related',
  early_cancel: 'early cancel',
  another_reason: 'another reason',
  not_known: 'not known',
} as const satisfies Record<CancelReason, string>

export const CANCEL_REASON_OPTIONS: ReadonlyArray<{
  readonly value: CancelReason
  readonly label: string
}> = (Object.keys(CANCEL_REASON_LABELS) as CancelReason[]).map((value) => ({
  value,
  label: CANCEL_REASON_LABELS[value],
}))

/** Edits with a settled reason rule. Cost overrides and headcounts wait for slice 1 (finding 5). */
export type EditKind =
  | 'appeal_ask'
  | 'round3_ask'
  | 'round3_amount'
  | 'include_override'
  | 'income_correction'
  | 'hold'
  | 'cancel'
  | 'stage_move'
  | 'tick'

/** A typed reason: what the request editor takes. */
export type TextReasonPolicy =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'optional'
      readonly label: string
      readonly prefill: (today: string) => string
      readonly maxLength: number
    }
  | { readonly kind: 'required'; readonly label: string; readonly maxLength: number }

/** A reason picked from a fixed list, with a note where one needs it (the cancel form, slice 1). */
export interface ChoiceReasonPolicy {
  readonly kind: 'choice'
  readonly label: string
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  readonly noteRequiredFor: readonly string[]
}

export type ReasonPolicy = TextReasonPolicy | ChoiceReasonPolicy

/**
 * D22's reason policy (main spec §14.4):
 * - an appeal's note is optional, pre-filled "Family emailed (date)";
 * - Round 3 needs its statement of need;
 * - Include overrides, income corrections and holds need a reason;
 * - a cancellation needs one of D141's reasons, with a note only for "another reason";
 * - stage moves and ticks need none.
 */
export const REASON_POLICY = {
  appeal_ask: {
    kind: 'optional',
    label: 'Note',
    prefill: (today: string) => `Family emailed (${formatShortDate(today)})`,
    maxLength: NOTE_MAX,
  },
  round3_ask: { kind: 'required', label: 'Statement of need', maxLength: STATEMENT_MAX },
  round3_amount: { kind: 'optional', label: 'Note', prefill: () => '', maxLength: NOTE_MAX },
  include_override: { kind: 'required', label: 'Reason', maxLength: NOTE_MAX },
  income_correction: { kind: 'required', label: 'Reason', maxLength: NOTE_MAX },
  hold: { kind: 'required', label: 'Reason', maxLength: NOTE_MAX },
  cancel: {
    kind: 'choice',
    label: 'Cancel reason',
    options: CANCEL_REASON_OPTIONS,
    noteRequiredFor: ['another_reason'],
  },
  stage_move: { kind: 'none' },
  tick: { kind: 'none' },
} as const satisfies Record<EditKind, ReasonPolicy>

export function initialReason(policy: TextReasonPolicy, today: string): string {
  return policy.kind === 'optional' ? policy.prefill(today) : ''
}

export function reasonMissing(policy: TextReasonPolicy, reason: string): boolean {
  return policy.kind === 'required' && reason.trim() === ''
}

/** A choice's problem, or null: a listed reason picked, and a note where that reason needs one. */
export function choiceProblem(
  policy: ChoiceReasonPolicy,
  value: string | null,
  note: string
): string | null {
  const option = policy.options.find((o) => o.value === value)
  if (option === undefined) return `Pick a ${policy.label.toLowerCase()}`
  if (policy.noteRequiredFor.includes(option.value) && note.trim() === '')
    return `"${option.label}" needs a note`
  return null
}
