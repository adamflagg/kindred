/**
 * Form intake's wire shapes (api/schemas/financial_aid_form_intake.py), from the generated types. types/api-types.ts
 * is the backend's to extend; these names are the page's own.
 *
 * The adult aid Google Form's shapes (adult aid form design §10; PR 2's read, PR 3's names) never carry POC,
 * race/ethnicity or gender identity, and only Link…'s own read (`LinkCandidatesOut`) carries the respondent email.
 */
import type {
  AdditionCreate,
  AddedRequestOut,
  AidOnNoRequestLineOut,
  AidOnNoRequestResponse,
  BecameOut,
  FormAnswerOut,
  FormCandidateOut,
  FormChangeOut,
  FormChangeReviewedOut,
  FormFigureOut,
  FormIntakeResponse,
  FormIntakeRowOut,
  FormIntakeSummaryOut,
  FormResponseActionOut,
  FormResponseIgnore,
  FormResponseLink,
  FormResponseOut,
  GapSessionOut,
  GoogleFormStatusOut,
  IntakeSessionOut,
  LinkCandidateOut,
  LinkCandidatesOut,
  RegistrationAskOut,
  SupersededOut,
  UnlistedResponse,
} from '../../../types/api-generated'

export type {
  AddedRequestOut,
  AidOnNoRequestLineOut,
  AidOnNoRequestResponse,
  BecameOut,
  FormAnswerOut,
  FormCandidateOut,
  FormChangeOut,
  FormChangeReviewedOut,
  FormFigureOut,
  FormIntakeResponse,
  FormIntakeRowOut,
  FormIntakeSummaryOut,
  FormResponseActionOut,
  FormResponseIgnore,
  FormResponseLink,
  FormResponseOut,
  GapSessionOut,
  GoogleFormStatusOut,
  IntakeSessionOut,
  LinkCandidateOut,
  LinkCandidatesOut,
  RegistrationAskOut,
  SupersededOut,
  UnlistedResponse,
}

export type BecameStatus = BecameOut['status']
/** POST /requests/{year}/additions, with Q5's optional Round 1. */
export type AdditionCreateIn = AdditionCreate
/** How a response found (or did not find) its person (design §5, GF-1 A). */
export type ResponseMatchStatus = FormResponseOut['match_status']
/** Why staff ignored a response (Ignore…'s Why). */
export type IgnoreKind = FormResponseIgnore['kind']
/** The three clues a response is matched on (a candidate's `signals`). */
export type MatchSignal = 'name' | 'birthdate' | 'email'
