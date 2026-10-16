import { campToday } from '../camperships/kit/dates'

export type RowsMode = 'campers' | 'enrollments'

/** "<season>-<view>[-enrollments]-<camp-time date>.csv", e.g. "2026-total-cancelled-2026-10-15.csv". */
export function csvFilename(
  year: number,
  label: string | undefined,
  mode: RowsMode = 'campers'
): string {
  const view =
    (label ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'campers'
  const rows = mode === 'enrollments' ? '-enrollments' : ''
  return `${String(year)}-${view}${rows}-${campToday()}.csv`
}
