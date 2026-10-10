import { Navigate } from 'react-router'

import { aidHref } from '../../components/camperships/kit/asOf'
import { aidHomePath } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'

const LIVE = { kind: 'live' } as const

/** `/aid`: Today, for everyone who can open Camperships; each role gets its own Today page. */
export default function AidHome() {
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const home = aidHomePath({ hasPermission })
  // Today is live only (D20): it carries the season, never a past date.
  return (
    <Navigate to={aidHref(home, { year, asOf: home === '/aid/today' ? LIVE : asOf })} replace />
  )
}
