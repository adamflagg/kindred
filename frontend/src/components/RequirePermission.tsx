import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { Loader2 } from 'lucide-react'
import ProgramLandingPage from '../pages/ProgramLandingPage'

interface RequirePermissionProps {
  permission: string
  anyOf?: string[]
  children: React.ReactNode
}

export const RequirePermission = ({
  permission,
  anyOf,
  children,
}: RequirePermissionProps) => {
  const { isLoading } = useAuth()
  const { hasPermission, hasAnyPermission } = usePermissions()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="text-primary h-12 w-12 animate-spin" />
      </div>
    )
  }

  const allowed = anyOf ? hasAnyPermission(...anyOf) : hasPermission(permission)

  if (!allowed) {
    return <ProgramLandingPage restricted />
  }

  return <>{children}</>
}
