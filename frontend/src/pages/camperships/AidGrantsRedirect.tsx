import { Navigate, useLocation, useParams } from 'react-router'

import { grantsRedirectPath } from '../../components/camperships/money/moneyTabs'

/** The old `/aid/grants/*` links, now in Money (owner 10-08). Keeps the query string whole. */
export default function AidGrantsRedirect() {
  const { '*': rest = '' } = useParams()
  const { search } = useLocation()
  return <Navigate to={`${grantsRedirectPath(rest)}${search}`} replace />
}
