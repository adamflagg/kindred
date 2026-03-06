/**
 * Hook to check if current user is an admin.
 *
 * Delegates to usePermissions which checks:
 * - Bypass mode = full access (dev environment)
 * - User's is_admin field from PocketBase (synced from OIDC)
 */
import { usePermissions } from './usePermissions'

export function useIsAdmin(): boolean {
  const { isAdmin } = usePermissions()
  return isAdmin
}
