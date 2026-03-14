/**
 * Hook for RBAC permission checks.
 *
 * Reads `is_admin` and `cached_permissions` from the PocketBase user record
 * in AuthContext. Bypass mode grants full access (isAdmin: true, all checks
 * return true). No user = no permissions.
 *
 * Usage:
 *   const { hasPermission, hasAnyPermission, isAdmin } = usePermissions()
 *   if (hasPermission('bunking.manage')) { ... }
 */
import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface UsePermissionsResult {
  permissions: string[]
  isAdmin: boolean
  hasPermission: (permission: string) => boolean
  hasAnyPermission: (...permissions: string[]) => boolean
}

export function usePermissions(): UsePermissionsResult {
  const { user, isBypassMode } = useAuth()

  return useMemo(() => {
    // Bypass mode = full access
    if (isBypassMode) {
      return {
        permissions: [],
        isAdmin: true,
        hasPermission: () => true,
        hasAnyPermission: () => true,
      }
    }

    const isAdmin = Boolean(user?.['is_admin'])
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime fallback: `as string[]` cast may be undefined at runtime
    const permissions: string[] = (user?.['cached_permissions'] as string[]) ?? []
    const permSet = new Set(permissions)

    return {
      permissions,
      isAdmin,
      hasPermission: (perm: string) => isAdmin || permSet.has(perm),
      hasAnyPermission: (...perms: string[]) => isAdmin || perms.some((p) => permSet.has(p)),
    }
  }, [user, isBypassMode])
}
