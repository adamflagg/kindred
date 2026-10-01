import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from './usePermissions'

/**
 * The one gate for every admin "View as" entry point (the bar's amber pill and the
 * user menu's "View as…" item). It reads `realIsAdmin`, never the effective
 * `isAdmin`, so the way back is never hidden while previewing as a non-admin.
 */
export function useCanViewAs(): boolean {
  const { isBypassMode } = useAuth()
  const { realIsAdmin } = usePermissions()
  return realIsAdmin && !isBypassMode
}
