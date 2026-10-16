/**
 * Form intake's wire shapes (api/schemas/financial_aid_form_intake.py), from the generated types. types/api-types.ts
 * is the backend's to extend; these names are the page's own.
 */
import type {
  AdditionCreate,
  AddedRequestOut,
  AidOnNoRequestLineOut,
  AidOnNoRequestResponse,
  BecameOut,
  FormIntakeResponse,
  FormIntakeRowOut,
  FormIntakeSummaryOut,
  GapSessionOut,
  IntakeSessionOut,
  RegistrationAskOut,
  UnlistedResponse,
} from '../../../types/api-generated'

export type {
  AddedRequestOut,
  AidOnNoRequestLineOut,
  AidOnNoRequestResponse,
  BecameOut,
  FormIntakeResponse,
  FormIntakeRowOut,
  FormIntakeSummaryOut,
  GapSessionOut,
  IntakeSessionOut,
  RegistrationAskOut,
  UnlistedResponse,
}

export type BecameStatus = BecameOut['status']
/** POST /requests/{year}/additions, with Q5's optional Round 1. */
export type AdditionCreateIn = AdditionCreate
