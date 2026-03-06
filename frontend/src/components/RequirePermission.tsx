import { Navigate } from 'react-router'
import { usePermissions } from '../hooks/usePermissions'

interface RequirePermissionProps {
  permission: string
  anyOf?: string[]
  children: React.ReactNode
  fallback?: string
}

/**
 * Route wrapper that only allows users with the required permission.
 * Users without the permission are silently redirected to the fallback path.
 *
 * Follows the same pattern as AdminRoute.tsx.
 *
 * Usage:
 *   <RequirePermission permission="bunking.view">
 *     <SessionList />
 *   </RequirePermission>
 *
 *   <RequirePermission anyOf={['bunking.view', 'metrics.view']}>
 *     <DashboardPage />
 *   </RequirePermission>
 */
export const RequirePermission = ({
  permission,
  anyOf,
  children,
  fallback = '/',
}: RequirePermissionProps) => {
  const { hasPermission, hasAnyPermission } = usePermissions()

  const allowed = anyOf ? hasAnyPermission(...anyOf) : hasPermission(permission)

  if (!allowed) {
    return <Navigate to={fallback} replace />
  }

  return <>{children}</>
}
