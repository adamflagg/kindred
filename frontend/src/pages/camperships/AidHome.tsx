import { Navigate } from 'react-router'

import { aidHomePath } from '../../config/aidNav'
import { usePermissions } from '../../hooks/usePermissions'
import AidSectionPage from './AidSectionPage'

/** `/aid`: Today for view holders; a summary-only user lands on Reports › Development (D65). */
export default function AidHome() {
  const { hasPermission } = usePermissions()
  const home = aidHomePath({ hasPermission })
  if (home !== '/aid') return <Navigate to={home} replace />
  return <AidSectionPage section="today" />
}
