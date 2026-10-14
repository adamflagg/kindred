import type { DefinitionNote } from '../components/camperships/kit/DefinitionNotes'

/**
 * Decision 45 (owner, 2026-10-14): a registration phase's opening "day" is its date plus the next
 * day, because in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day. The
 * server counts it (camp_calendar.PRIORITY_DAY_DAYS); these pages say so in one numbered note.
 */
export const PRIORITY_DAY_NOTE =
  'Counts the opening day and the next day: in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day.'

/** The note as the kit's DefinitionNotes list takes it: the page's only note, so number 1. */
export const PRIORITY_DAY_NOTES: readonly DefinitionNote[] = [{ n: 1, text: PRIORITY_DAY_NOTE }]

/**
 * True when a same-point compare is read on the priority date itself (registration day 0), the
 * one offset where the server reads the prior year through the next day.
 */
export function isPriorityDayOffset(dayOffset: number | null | undefined): boolean {
  return dayOffset === 0
}
