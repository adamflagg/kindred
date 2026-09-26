/**
 * Hook for RBAC permission checks — the frontend's single enforcement point.
 *
 * Reads `is_admin` and `cached_permissions` from the PocketBase user record
 * in AuthContext. Bypass mode grants full access (isAdmin: true, all checks
 * return true). No user = no permissions.
 *
 * `isAdmin` / `permissions` / `hasPermission` are EFFECTIVE: a real admin
 * previewing a view-as persona (auth/viewAs.ts) gets the persona's access,
 * exactly as PocketBase and FastAPI enforce it. `realIsAdmin` and `viewAs` are
 * for the View-as switcher ONLY — gating anything else on them would make the
 * preview lie.
 *
 * Usage:
 *   const { hasPermission, hasAnyPermission, isAdmin } = usePermissions()
 *   if (hasPermission('bunking.manage')) { ... }
 */
import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { readViewAs, type ViewAsPersona } from '../auth/viewAs'

interface UsePermissionsResult {
  permissions: string[]
  isAdmin: boolean
  /** The stored is_admin, ignoring any persona. View-as switcher only. */
  realIsAdmin: boolean
  /** This tab's persona, or null when not previewing. View-as switcher only. */
  viewAs: ViewAsPersona | null
  hasPermission: (permission: string) => boolean
  hasAnyPermission: (...permissions: string[]) => boolean
}

export function usePermissions(): UsePermissionsResult {
  const { user, isBypassMode } = useAuth()

  return useMemo(() => {
    // Bypass mode = full access; PocketBase runs as a superuser there, so a
    // persona could not be enforced and is ignored.
    if (isBypassMode) {
      return {
        permissions: [],
        isAdmin: true,
        realIsAdmin: true,
        viewAs: null,
        hasPermission: () => true,
        hasAnyPermission: () => true,
      }
    }

    const realIsAdmin = Boolean(user?.['is_admin'])
    const raw = user?.['cached_permissions']
    const realPermissions: string[] = Array.isArray(raw) ? raw : []
    // Only a real admin may preview -- the same gate the servers apply.
    const viewAs = realIsAdmin ? readViewAs() : null
    const isAdmin = viewAs === null ? realIsAdmin : false
    const permissions = viewAs === null ? realPermissions : viewAs.permissions
    const permSet = new Set(permissions)

    return {
      permissions,
      isAdmin,
      realIsAdmin,
      viewAs,
      hasPermission: (perm: string) => isAdmin || permSet.has(perm),
      hasAnyPermission: (...perms: string[]) => isAdmin || perms.some((p) => permSet.has(p)),
    }
  }, [user, isBypassMode])
}
