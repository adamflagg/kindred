import { Navigate } from 'react-router'

import { aidHref } from '../../components/camperships/kit/asOf'
import { aidHomePath } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import AidTodayPage from './AidTodayPage'

/** `/aid`: Today for view holders; a summary-only user lands on Reports › Development (D65). */
export default function AidHome() {
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const home = aidHomePath({ hasPermission })
  if (home !== '/aid') return <Navigate to={aidHref(home, { year, asOf })} replace />
  return <AidTodayPage />
}
