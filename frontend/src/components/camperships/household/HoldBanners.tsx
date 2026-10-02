import type { ReactNode } from 'react'

import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { StatusPill } from '../kit/Pills'
import { codeWords } from '../requests/attention'
import { camperOf } from './householdModel'

/**
 * The hold banners (§6.3 item 3; main spec §10.5): one per hold on the page's requests, with its
 * words, the camper and the server's message. They are page content, not chrome (§4.1). `actions`
 * puts each hold's actions in place (PR 8).
 */
export function HoldBanners({
  page,
  actions,
}: {
  page: ApiAidHouseholdPage
  actions?: ((request: ApiAidHouseholdRequest, code: string) => ReactNode) | undefined
}) {
  const holds = page.requests.flatMap((request) =>
    request.row.holds.map((hold) => ({ request, hold }))
  )
  if (holds.length === 0) return null
  return (
    <div className="space-y-2">
      {holds.map(({ request, hold }) => (
        <div
          key={`${request.row.request_id}:${hold.code}`}
          className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-900/20"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="red">{codeWords(hold.code)}</StatusPill>
            <b>{camperOf(request)}</b>
            <span>{hold.message}</span>
          </div>
          {actions?.(request, hold.code)}
        </div>
      ))}
    </div>
  )
}
