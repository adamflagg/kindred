/**
 * Utility for formatting sync/processed date display in RawDataPanel.
 *
 * Rules:
 * - If `processed` is empty/null, show "Not yet processed" (when field has value)
 *   or just show synced date (when field is empty)
 * - If both dates are the same day, combine into a single display
 * - If different days, show both separately
 */

export type DateDisplayMode = 'none' | 'synced-only' | 'unprocessed' | 'same-day' | 'different-days'

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
 * @param hasValue - Whether the field has content (determines "Not yet processed" vs no indicator)
 */
export function formatSyncDates(
  updatedAt: string | undefined,
  processedAt: string | undefined,
  hasValue: boolean
): DateDisplayResult {
  // No synced date at all
  if (!updatedAt) {
    return { mode: 'none', syncedDisplay: null, processedDisplay: null }
  }

  const syncedDisplay = toLocaleDateString(updatedAt)

  // Processed is missing/empty
  if (!processedAt) {
    if (hasValue) {
      // Field has data but hasn't been processed yet
      return { mode: 'unprocessed', syncedDisplay, processedDisplay: null }
    }
    // Field is empty, just show synced date
    return { mode: 'synced-only', syncedDisplay, processedDisplay: null }
  }

  const processedDisplay = toLocaleDateString(processedAt)

  // Both dates exist - check if same day
  if (isSameDay(updatedAt, processedAt)) {
    return { mode: 'same-day', syncedDisplay, processedDisplay }
  }

  // Different days
  return { mode: 'different-days', syncedDisplay, processedDisplay }
}
