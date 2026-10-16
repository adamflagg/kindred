import type { DefinitionNote } from '../components/camperships/kit/DefinitionNotes'

/**
 * Decision 45 (owner, 2026-10-14): a registration phase's opening "day" is its date plus the next
 * day, because in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day. The
 * server counts it (camp_calendar.PRIORITY_DAY_DAYS); these pages say so in one numbered note.
 */
export const PRIORITY_DAY_NOTE =
  'Counts the opening day and the next day: in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day.'

/**
 * The note as the kit's DefinitionNotes list takes it. Number 1: on every page that lists it, it
 * comes first (Velocity's bases note follows it as 2).
 */
export const PRIORITY_DAY_NOTES: readonly DefinitionNote[] = [{ n: 1, text: PRIORITY_DAY_NOTE }]

/**
 * True when a same-point compare is read on the priority date itself (registration day 0), the
 * one offset where the server reads the prior year through the next day.
 */
export function isPriorityDayOffset(dayOffset: number | null | undefined): boolean {
  return dayOffset === 0
}

/**
 * Ruling 9 (owner, 2026-10-14): on the priority date itself, this year's data holds only day 0
 * until the next morning's sync, so a same-point delta would read behind. The delta cell shows
 * this instead, on that one day only; the numbered note stays.
 */
export const PRIORITY_DAY_PENDING = 'updates tomorrow'

/** Compact muted text, sized to sit in a delta cell or a card value. */
export const PRIORITY_DAY_PENDING_CLASS =
  'text-muted-foreground text-xs font-normal whitespace-nowrap'
