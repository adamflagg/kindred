import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { FullPageSpinner } from './FullPageSpinner'
import PermissionDeniedPage from '../pages/PermissionDeniedPage'

type RequirePermissionProps = {
  children: React.ReactNode
  /** What a person without the permission sees instead of the denied page (a page that explains itself). */
  fallback?: React.ReactNode
} & ({ permission: string; anyOf?: never } | { permission?: never; anyOf: string[] })

export const RequirePermission = (props: RequirePermissionProps) => {
  const { children, fallback } = props
  const permission = 'permission' in props ? props.permission : undefined
  const anyOf = 'anyOf' in props ? props.anyOf : undefined
  const { isLoading } = useAuth()
  const { hasPermission, hasAnyPermission } = usePermissions()

  if (isLoading) {
    return <FullPageSpinner />
  }

  const allowed = anyOf
    ? hasAnyPermission(...anyOf)
    : permission
      ? hasPermission(permission)
      : false

  if (!allowed) {
    return fallback !== undefined ? <>{fallback}</> : <PermissionDeniedPage />
  }

  return <>{children}</>
}
