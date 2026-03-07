import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { FullPageSpinner } from './FullPageSpinner'

export const ProtectedRoute = () => {
  const { user, isLoading, isBypassMode } = useAuth()
  const location = useLocation()

  // Always wait for auth to finish loading before rendering protected routes
  // This prevents race conditions where child components (e.g., SessionList)
  // render before user is set, causing queries with `enabled: !!user` to not run
  if (isLoading) {
    return <FullPageSpinner />
  }

  // In bypass mode, always allow access (AuthContext provides mock user)
  if (isBypassMode) {
    return <Outlet />
  }

  if (!user) {
    // Redirect them to the /login page, but save the current location they were
    // trying to go to. This allows us to send them along to that page after a
    // successful login.
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // If authenticated, render the child routes
  return <Outlet />
}
