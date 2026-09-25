/** Jotform admin types (kindred#2759) — aliases over the generated FastAPI models. */
import type {
  JotformDuplicateGroup,
  JotformFormRow,
  JotformFormsResponse,
  JotformFormWrite,
  JotformGuest,
  JotformQueueItem,
  JotformQueueResponse,
  JotformSuggestion,
  JotformWriteInLinkSuggestion,
  JotformWriteInOption,
} from './api-generated'

export type JotformFormsList = JotformFormsResponse
export type JotformFormRowData = JotformFormRow
export type JotformFormWriteBody = JotformFormWrite
export type JotformQueue = JotformQueueResponse
export type JotformQueueEntry = JotformQueueItem
export type JotformSuggestionRow = JotformSuggestion
export type JotformGuestRow = JotformGuest
export type JotformDuplicateGroupRow = JotformDuplicateGroup
/** One board write-in a filing can be linked to (kindred#2759 follow-up). */
export type JotformWriteInChoice = JotformWriteInOption
/** An unlinked write-in the Requests tab suggests linking to a filing (kindred#2828). */
export type JotformWriteInLinkSuggestionRow = JotformWriteInLinkSuggestion
