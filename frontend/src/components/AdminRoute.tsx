import { Navigate } from 'react-router'
import { useIsAdmin } from '../hooks/useIsAdmin'

interface AdminRouteProps {
  children: React.ReactNode
  fallback?: string
}

/**
 * Route wrapper that only allows admin users to access.
 * Non-admins are silently redirected to the fallback path (default: /).
 */
export const AdminRoute = ({ children, fallback = '/' }: AdminRouteProps) => {
  const isAdmin = useIsAdmin()

  if (!isAdmin) {
    return <Navigate to={fallback} replace />
  }

  return <>{children}</>
}
