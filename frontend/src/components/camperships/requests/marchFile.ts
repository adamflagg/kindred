/**
 * The March file (spec §8.3; D73; S3-7, ruled 2026-10-02; owner ruling E, 10-06): a CSV in the
 * registrar's 2025 layout, sent to CampMinder's staff. Five exact headers; one row per payer share of
 * each Round 1 offer, its Total Award that share's Round 1 decided amount, as the server sends it (it
 * owns the row rule, D21: no $0 row, no Round 1 CampMinder already holds, a Family Camp row naming the
 * oldest child attending). It changes nothing. No link line after the rows: the layout is exact.
 */
import type { ApiAidMarchFile } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { moneyCsv } from '../kit/money'

/** The registrar's 2025 layout, header for header. */
export const MARCH_HEADERS = [
  'Camper: (First)',
  'Camper: (Last)',
  'Total Award',
  'Primary Childhood ID',
  'Personal Id',
] as const

/**
 * ⚠ number meaning (S3-7): each row is one payer share's Round 1 amount, as the server sends it. A
 * Family Camp row with no qualifying child has no Personal Id (`null`): a blank cell, never "null".
 */
export function marchFileRows(file: ApiAidMarchFile): string[][] {
  return file.rows.map((row) => [
    row.camper_first,
    row.camper_last,
    moneyCsv(row.total_award),
    String(row.primary_childhood_id),
    row.personal_id === null ? '' : String(row.personal_id),
  ])
}

export function marchFileName(year: number): string {
  return aidCsvFilename({ surface: 'march file', season: year })
}

const counted = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** "412 rows · 398 requests" after a download, so the person can check it against the screen. */
export function marchFileWords(file: ApiAidMarchFile): string {
  const requests = new Set(file.rows.map((r) => r.request_id)).size
  return `${counted(file.rows.length, 'row', 'rows')} · ${counted(requests, 'request', 'requests')}`
}

/**
 * Ruling E's count in words, and where those offers stay: "3 Round 1 offers of $0 aren't in the
 * file; they stay in Needs an offer, for a letter and Mark Posted by hand." (one: "…isn't in the
 * file; it stays…", R5-13); null when none was left out.
 */
export function zeroLeftOutWords(file: ApiAidMarchFile): string | null {
  const n = file.zero_left_out ?? 0
  if (n <= 0) return null
  return n === 1
    ? "1 Round 1 offer of $0 isn't in the file; it stays in Needs an offer, for a letter and Mark Posted by hand."
    : `${String(n)} Round 1 offers of $0 aren't in the file; they stay in Needs an offer, for a letter and Mark Posted by hand.`
}

/** The menu item's hint (P-21): what the file covers, and the one warning. The rest lives in the spec. */
export const MARCH_FILE_HINT =
  'Every Round 1 offer, not only this list · send it once; twice double-posts'

/**
 * The result line after a download (owner, 10-08: the count shows when clicked): the $0 count and where
 * those offers stay when some were left out; otherwise what the file holds, for checking against the screen.
 */
export function marchFileResultLine(file: ApiAidMarchFile): string {
  const zero = zeroLeftOutWords(file)
  return zero === null
    ? `✓ March File downloaded: ${marchFileWords(file)}.`
    : `✓ March File downloaded. ${zero}`
}
