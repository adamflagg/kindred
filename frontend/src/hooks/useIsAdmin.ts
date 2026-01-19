/**
 * Hook to check if current user is an admin
 *
 * Admin access logic:
 * - Bypass mode = full access (dev environment)
 * - No admin configured = everyone is admin (default)
 * - User ID matches configured admin = admin
 * - Otherwise = not admin
 */
import { useAuth } from '../contexts/AuthContext';

export function useIsAdmin(): boolean {
  const { user, isBypassMode } = useAuth();

  // Bypass mode = full access (dev environment)
  if (isBypassMode) return true;

  // No admin configured = everyone is admin
  const adminUserId = import.meta.env['ADMIN_USER'] as string | undefined;
  if (!adminUserId) return true;

  // Check if current user matches configured admin
  return user?.id === adminUserId;
}
