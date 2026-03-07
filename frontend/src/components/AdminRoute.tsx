import { useAuth } from '../contexts/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { FullPageSpinner } from './FullPageSpinner'
import ProgramLandingPage from '../pages/ProgramLandingPage'

interface AdminRouteProps {
  children: React.ReactNode
}

export const AdminRoute = ({ children }: AdminRouteProps) => {
  const { isLoading } = useAuth()
  const isAdmin = useIsAdmin()

  if (isLoading) {
    return <FullPageSpinner />
  }

  if (!isAdmin) {
    return <ProgramLandingPage restricted />
  }

  return <>{children}</>
}
