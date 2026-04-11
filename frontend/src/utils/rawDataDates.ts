/**
 * Utility for formatting sync/processed date display in RawDataPanel.
 *
 * Rules:
 * - If both dates are the same day, show one combined date
 * - If different days, show both separately
 */

export type DateDisplayMode = 'none' | 'synced-only' | 'same-day' | 'different-days'

export interface DateDisplayResult {
  mode: DateDisplayMode
  syncedDisplay: string | null
  processedDisplay: string | null
}

function toLocaleDateString(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

function isSameDay(a: string, b: string): boolean {
  const dateA = new Date(a)
  const dateB = new Date(b)
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

/**
 * Determine how to display synced/processed dates for a raw data field.
 *
 * @param updatedAt - The sync timestamp (ISO string or undefined)
 * @param processedAt - The processed timestamp (ISO string or undefined/empty)
 */
export function formatSyncDates(
  updatedAt: string | undefined,
  processedAt: string | undefined
): DateDisplayResult {
  if (!updatedAt) {
    return { mode: 'none', syncedDisplay: null, processedDisplay: null }
  }

  const syncedDisplay = toLocaleDateString(updatedAt)

  if (!processedAt) {
    return { mode: 'synced-only', syncedDisplay, processedDisplay: null }
  }

  const processedDisplay = toLocaleDateString(processedAt)

  if (isSameDay(updatedAt, processedAt)) {
    return { mode: 'same-day', syncedDisplay, processedDisplay }
  }

  return { mode: 'different-days', syncedDisplay, processedDisplay }
}
