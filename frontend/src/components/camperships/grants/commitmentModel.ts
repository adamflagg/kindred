/**
 * A hand-entered commitment (spec §8.2; D55, D116; P-16): a grant committed but not yet posted. Pure:
 * the camper choices, the form's draft, and the whole body the routes take (create and save are alike).
 */
import type { ApiAidCommitmentIn, ApiAidGrantRow, ApiAidGridRow } from '../../../types/api-types'
import { parseIsoDay } from '../kit/dates'
import { parseMoneyInput } from '../kit/editor'
import { toCents } from '../kit/money'
import { exactAmount } from '../money/toPlaceModel'

/** A camper a commitment can be for: one of this season's requests (P-16). */
export interface CamperChoice {
  readonly key: string
  readonly householdCmId: number
  readonly personCmId: number
  readonly sessionCmId: number
  readonly label: string
}

const choiceKey = (personCmId: number, sessionCmId: number) =>
  `${String(personCmId)}:${String(sessionCmId)}`

const choiceLabel = (camper: string, session: string, family: string) =>
  [camper, session, family].filter((part) => part !== '').join(' · ')

/**
 * Every camper on a request, once per camper and session: "Emma Johnson · Session 2 · The Johnson
 * Family". A household's own request (person 0, a household program) can't hold a commitment: the
 * route needs a camper. A cancelled request still offers its camper (a commitment may come first).
 */
export function camperChoices(rows: readonly ApiAidGridRow[]): CamperChoice[] {
  const seen = new Map<string, CamperChoice>()
  for (const row of rows) {
    if (row.person_cm_id <= 0) continue
    const key = choiceKey(row.person_cm_id, row.session_cm_id)
    if (seen.has(key)) continue
    seen.set(key, {
      key,
      householdCmId: row.household_cm_id,
      personCmId: row.person_cm_id,
      sessionCmId: row.session_cm_id,
      label: choiceLabel(row.camper_name, row.session_name, row.family_name),
    })
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** The commitment a Register row holds, as a choice, so an edit always offers its own camper. */
export function choiceOf(row: ApiAidGrantRow): CamperChoice {
  return {
    key: choiceKey(row.person_cm_id, row.session_cm_id),
    householdCmId: row.household_cm_id,
    personCmId: row.person_cm_id,
    sessionCmId: row.session_cm_id,
    label: choiceLabel(row.camper_name, row.session_name, row.family_name),
  }
}

/**
 * The household page's "Add a Commitment…" (rulings:340): the form opens on that page's requests
 * instead of the season's, so its campers are the household's.
 */
export interface CommitmentHousehold {
  readonly rows: readonly ApiAidGridRow[]
}

export interface CommitmentDraft {
  readonly grantorKey: string
  readonly camperKey: string
  readonly amount: string
  readonly committedOn: string
  readonly note: string
}

/** A new commitment: today's date; the one camper picked when there is only one to pick. */
export function emptyDraft(today: string, choices: readonly CamperChoice[] = []): CommitmentDraft {
  const [only] = choices
  return {
    grantorKey: '',
    camperKey: choices.length === 1 && only !== undefined ? only.key : '',
    amount: '',
    committedOn: today,
    note: '',
  }
}

/**
 * An open commitment's draft from its Register row (review item 21): the stored note and date are
 * read and kept unless the person changes them (#2975 sends both on the row).
 */
export function draftOf(row: ApiAidGrantRow): CommitmentDraft {
  const committedOn = row.committed_on ?? ''
  return {
    grantorKey: row.grantor_key,
    camperKey: choiceKey(row.person_cm_id, row.session_cm_id),
    amount: exactAmount(row.amount).replace(/\.00$/, ''),
    committedOn: committedOn === '' ? row.recorded_on : committedOn,
    note: row.commitment_note ?? '',
  }
}

export type CommitmentRead =
  | { readonly ok: true; readonly body: ApiAidCommitmentIn }
  | { readonly ok: false; readonly problem: string }

/** The whole commitment the routes take, or what is missing first. The server checks the rest. */
export function readCommitment(
  draft: CommitmentDraft,
  choices: readonly CamperChoice[]
): CommitmentRead {
  if (draft.grantorKey === '') return { ok: false, problem: 'Pick the grantor' }
  const camper = choices.find((c) => c.key === draft.camperKey)
  if (camper === undefined) return { ok: false, problem: 'Pick the camper' }
  const amount = parseMoneyInput(draft.amount)
  if (amount.kind === 'empty') return { ok: false, problem: 'Type the amount' }
  if (amount.kind === 'invalid') return { ok: false, problem: amount.reason }
  if (toCents(amount.amount) <= 0) return { ok: false, problem: 'More than $0' }
  if (parseIsoDay(draft.committedOn) === null) {
    return { ok: false, problem: 'The date it was committed' }
  }
  return {
    ok: true,
    body: {
      grantor_key: draft.grantorKey,
      household_cm_id: camper.householdCmId,
      person_cm_id: camper.personCmId,
      session_cm_id: camper.sessionCmId > 0 ? camper.sessionCmId : null,
      amount: exactAmount(amount.amount),
      committed_on: draft.committedOn,
      note: draft.note.trim(),
    },
  }
}

/** What an edit watches between opening and saving (P-9): the stored note and date included. */
export const COMMITMENT_WATCHED: ReadonlyArray<readonly [keyof ApiAidGrantRow, string]> = [
  ['grantor_key', 'Grantor'],
  ['person_cm_id', 'Camper'],
  ['session_cm_id', 'Session'],
  ['amount', 'Amount'],
  ['committed_on', 'Committed on'],
  ['commitment_note', 'Note'],
]
