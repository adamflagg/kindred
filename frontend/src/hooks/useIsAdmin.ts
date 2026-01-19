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

  // TODO: Implement - this is a stub that will fail tests
  void user;
  void isBypassMode;
  return false;
}
