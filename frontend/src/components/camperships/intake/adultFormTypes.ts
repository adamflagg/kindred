/**
 * The adult aid form's shapes on Form intake (adult aid form design §10; PR 3), held here as the page's own view types
 * until PR 2's schema lands in the generated types. Each mirrors a field PR 2 sends (or is asked to send): Phase B
 * swaps these for aliases of `types/api-generated`, as `intakeTypes.ts` does for the rest of the read.
 *
 * Never here, by design: POC, race/ethnicity and gender identity (stored in the locked mirror, returned nowhere), and
 * the respondent email, which only Link…'s own read carries (`LinkCandidatesView`).
 */
import type { FormSource } from '../kit/words'
import type { BecameOut, FormAnswerOut } from './intakeTypes'

export type { FormSource }

/** How a response found (or did not find) its person (design §5, GF-1 A). */
export type ResponseMatchStatus =
  | 'auto'
  | 'staff'
  | 'suggested'
  | 'registered_elsewhere'
  | 'not_registered'
  | 'unmatched'
  | 'ignored'
  | 'superseded'

/** The three clues a response is matched on. */
export type MatchSignal = 'name' | 'birthdate' | 'email'

/** Why staff ignored a response (Ignore…'s Why). */
export type IgnoreKind = 'test' | 'duplicate' | 'not_asking' | 'other'

/** One parsed figure (design §7): `value` null is unknown, never 0; `note` says how a figure not read cleanly was read. */
export interface ResponseFigureView {
  readonly field: string
  readonly value: number | null
  readonly typed?: string | undefined
  /** The parse note: "read 'approx 85k' as $85,000", "a range: not read". */
  readonly note?: string | undefined
  /** What the rules make of it: "above $5,000: $1,400 is subtracted". */
  readonly rule_note?: string | undefined
}

/** A person a response may be: the candidates GF-1 found, or the person it is linked to. */
export interface ResponseCandidateView {
  readonly person_cm_id: number
  readonly household_cm_id: number
  readonly camper_name?: string | undefined
  readonly household_label?: string | undefined
  readonly signals: readonly MatchSignal[]
  /** The 2027 sessions they are registered in, inside the weekend set searched (or, registered elsewhere, outside). */
  readonly session_cm_ids?: readonly number[] | undefined
  readonly registration_status?: 'enrolled' | 'applied' | 'waitlisted' | 'incomplete' | undefined
  /** A tie-break or near miss: "birthdate: day and month swapped", "the typed email is Sam Lee's, in her household". */
  readonly note?: string | undefined
}

/** An earlier response this one replaced, or (after a decision) a later one flagged and not applied. */
export interface OtherResponseView {
  readonly response_id: string
  readonly submitted_at: string
  readonly replaced_at?: string | undefined
  readonly ask?: number | null | undefined
  readonly total_gross_income?: number | null | undefined
}

/** One adult aid form response, as Form intake lists it (PR 2's `form_responses`). */
export interface FormResponseView {
  /** The mirror record's id: the Link… / Ignore… routes take it. */
  readonly id: string
  readonly response_id: string
  readonly match_status: ResponseMatchStatus
  /** Suggested, registered elsewhere, not registered or unmatched: the Responses to link segment. */
  readonly to_link: boolean
  /** The Form intake row it belongs to ("<household>:<person>"); "" while no person holds it. */
  readonly row_key: string
  readonly form_status: 'live' | 'deleted'
  readonly deleted_at?: string | undefined
  readonly name_typed: string
  readonly program_key: string
  /** The choice as typed on the form: "Family Camp 4: Labor Day (Sep 3-6)". */
  readonly program_choice: string
  /** The choice's weekend; 0 while the choice is unclear. */
  readonly weekend_session_cm_id: number
  readonly ask: number | null
  readonly submitted_at: string
  readonly figures: readonly ResponseFigureView[]
  readonly unemployment?: boolean | null | undefined
  readonly special_circumstances: string
  readonly signature_typed: string
  readonly agreement_date: string
  readonly superseded: readonly OtherResponseView[]
  /** GF-4 C (owner Q6): responses that came after a decision, flagged and never applied. */
  readonly flagged?: readonly OtherResponseView[] | undefined
  readonly candidates: readonly ResponseCandidateView[]
  readonly linked_by?: string | undefined
  readonly linked_at?: string | undefined
  readonly ignored_kind?: IgnoreKind | undefined
  readonly ignored_reason?: string | undefined
  readonly ignored_by?: string | undefined
  readonly ignored_at?: string | undefined
  readonly look_reasons: readonly string[]
  /** When the hourly read last tried to match it. */
  readonly checked_at?: string | undefined
}

/** The season's form and its last read (PR 2's `google_form`; null in a season with no adult aid form). */
export interface GoogleFormStatusView {
  readonly last_pulled_at: string
  readonly refused: boolean
  /** A refused read: how many responses Google returned, of how many the dashboard holds, and the last good read. */
  readonly returned?: number | undefined
  readonly expected?: number | undefined
  readonly last_good_at?: string | undefined
  /** The raw status, for a refusal the fields above do not cover ("choice … matches no 2027 session"). */
  readonly last_pull_status?: string | undefined
}

/** Pull Now's answer: the read's counts when it ran in the call, or only that it started. */
export interface PullResultView {
  readonly status: 'done' | 'started' | 'refused'
  readonly responses?: number | undefined
  readonly new?: number | undefined
  readonly at?: string | undefined
}

/** Link…'s own read (GET …/form-responses/{id}/candidates): the only payload that carries the respondent email. */
export interface LinkCandidatesView {
  readonly id: string
  readonly name_typed: string
  readonly birthdate_typed: string
  readonly respondent_email: string
  readonly program_choice: string
  readonly candidates: readonly LinkCandidateView[]
}

/** One person Link… offers, with the evidence its row shows. */
export interface LinkCandidateView extends ResponseCandidateView {
  readonly birthdate?: string | undefined
  readonly email?: string | undefined
}

/** A form-made request's flags from the adult aid form (PR 2): what the Became cell adds after its session. */
export interface BecameFormView extends BecameOut {
  readonly form_source?: FormSource | undefined
  /** GF-4 C: the response was deleted in Google, or a second one came after a decision. Mark Reviewed clears it. */
  readonly form_change?:
    | {
        readonly kind: 'deleted' | 'changed_after_decision'
        readonly at: string
        readonly reviewed: boolean
      }
    | null
    | undefined
  /** No price can be set yet (no 2027 rates or tuition entered): "no price yet". */
  readonly price_missing?: boolean | undefined
}

export interface FormAnswerView extends FormAnswerOut {
  readonly form_source?: FormSource | undefined
}
