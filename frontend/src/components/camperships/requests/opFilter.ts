/** Requests' `?op=` (spec §9.8): the requests one History operation touched, from the operation read History opened. */
import type { ApiAidHistoryOperationDetail } from '../../../types/api-types'

const OPERATION_ID = /^[a-z0-9]{15}$/

export const OP_MISSING = "That History operation isn't in the log you can read"

export function parseOp(raw: string | null): string | null {
  return raw !== null && OPERATION_ID.test(raw) ? raw : null
}

/** The distinct request ids of the operation's rows; null until the read lands (the grid shows nothing extra yet). */
export function opRequestIds(
  detail: ApiAidHistoryOperationDetail | undefined
): ReadonlySet<string> | null {
  if (detail === undefined) return null
  return new Set(
    detail.rows
      .map((row) => row.request_id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
  )
}
