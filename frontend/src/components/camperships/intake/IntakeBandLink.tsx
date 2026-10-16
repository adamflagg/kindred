import { Link } from 'react-router'

import { useAidIntakeSummary } from '../../../hooks/camperships/useAidIntake'
import { useYear } from '../../../hooks/useCurrentYear'
import { aidHref } from '../kit/asOf'

const LIVE = { kind: 'live' } as const

/**
 * Requests' band link to Form intake (owner Q1-A): in the band's right slot (AidPageBand `stats`), so nothing under
 * the band moves and Requests keeps no tab row (design-language §12). "Form intake · 5 need a look ›", the count in
 * white as Season's band figures are; no count while Needs a look is empty or the count loads. Form intake is live.
 */
export function IntakeBandLink() {
  const year = useYear()
  const count = useAidIntakeSummary().data?.needs_look ?? 0
  return (
    <Link
      to={aidHref('/aid/requests/intake', { year, asOf: LIVE })}
      className="text-forest-200 text-sm whitespace-nowrap hover:underline"
      title="Requests › Form intake: every aid form and registration ask, and the request it became or why not"
    >
      Form intake
      {count > 0 && (
        <>
          {' · '}
          <b className="text-white">{count}</b> need a look
        </>
      )}{' '}
      ›
    </Link>
  )
}
