import { Navigate, useLocation, useParams } from 'react-router'

import { grantsRedirectTarget } from '../../components/camperships/money/moneyTabs'
import { Permission } from '../../constants/permissions'
import { usePermissions } from '../../hooks/usePermissions'

/** The old `/aid/grants/*` links, now in Money (owner 10-08). Keeps the query string whole. */
export default function AidGrantsRedirect() {
  const { '*': rest = '' } = useParams()
  const { search } = useLocation()
  const { hasPermission } = usePermissions()
  const canView = hasPermission(Permission.FINANCIAL_AID_VIEW)
  return <Navigate to={grantsRedirectTarget(rest, search, canView)} replace />
}
