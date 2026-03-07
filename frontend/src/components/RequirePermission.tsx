import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { FullPageSpinner } from './FullPageSpinner'
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
    return <FullPageSpinner />
  }

  const allowed = anyOf ? hasAnyPermission(...anyOf) : hasPermission(permission)

  if (!allowed) {
    return <ProgramLandingPage restricted />
  }

  return <>{children}</>
}
