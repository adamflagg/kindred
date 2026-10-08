/**
 * A refused Money write in staff's words (slice 3): the UI's sentence leads and the server's is the
 * detail (slice 2 plan review M4). Every 4xx wrote nothing (the routes check before they commit, all
 * or nothing); anything else can't say, so the person is told to look.
 */
import { wroteNothing } from '../requests/ticks'

/** The server's "this now locks $X, not the $Y you confirmed" (to-place service, `expected_locked`). */
const MOVED_LOCK = 'this now locks '
/**
 * G6's race sentence. Every slice 3 write answers it as a 409 since #2973 (To place always did); it
 * is matched on any 4xx, cheaply, in case another route sends it as a 422. Other 409s are states:
 * a key taken, a grantor in use.
 */
const RACE = 'Someone else changed this'

/** The HTTP status, narrowed on `.status`, never `instanceof` (services/apiError.ts). */
function statusOf(error: unknown): number {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : 0
}

export function refusalWords(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Couldn't save"
  const status = statusOf(error)
  if (wroteNothing(status) && detail.startsWith(RACE)) {
    return `Someone else changed this while you looked; nothing was written. The page has reloaded: check it and try again. (${detail})`
  }
  if (detail.startsWith(MOVED_LOCK)) {
    return `What this would lock changed since the page loaded; nothing was written. The page has reloaded: check what Confirm does now. (${detail})`
  }
  if (wroteNothing(status)) return `Nothing was written: ${detail}`
  return `We can't tell whether this was saved. The page has reloaded: check it before trying again. (${detail})`
}

/**
 * A write whose refusal reads in staff's words, for slice 1's `ReasonForm` (it shows the thrown
 * error's message): Leave, Reopen, Withdraw, Retire and Unretire read like Confirm (plan review m9).
 */
export async function inStaffWords<T>(write: Promise<T>): Promise<T> {
  try {
    return await write
  } catch (caught) {
    throw new Error(refusalWords(caught), { cause: caught })
  }
}

/**
 * A refused placement preview (P-4) in staff's words, or null when the preview simply failed (a
 * dropped connection, a 5xx): then the read's own preview stands and Confirm stays, since the write
 * checks `expected_locked` itself. A 4xx means the write would be refused the same way.
 */
export function previewRefusalWords(error: unknown): string | null {
  if (error === null || error === undefined || !wroteNothing(statusOf(error))) return null
  const detail = error instanceof Error ? error.message : ''
  return `Confirm can't place this as suggested now: ${detail}`
}
