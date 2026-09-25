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
} from './api-generated'

export type JotformFormsList = JotformFormsResponse
export type JotformFormRowData = JotformFormRow
export type JotformFormWriteBody = JotformFormWrite
export type JotformQueue = JotformQueueResponse
export type JotformQueueEntry = JotformQueueItem
export type JotformSuggestionRow = JotformSuggestion
export type JotformGuestRow = JotformGuest
export type JotformDuplicateGroupRow = JotformDuplicateGroup
