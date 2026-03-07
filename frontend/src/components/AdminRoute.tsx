import { useAuth } from '../contexts/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { Loader2 } from 'lucide-react'
import ProgramLandingPage from '../pages/ProgramLandingPage'

interface AdminRouteProps {
  children: React.ReactNode
}

export const AdminRoute = ({ children }: AdminRouteProps) => {
  const { isLoading } = useAuth()
  const isAdmin = useIsAdmin()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="text-primary h-12 w-12 animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return <ProgramLandingPage restricted />
  }

  return <>{children}</>
}
