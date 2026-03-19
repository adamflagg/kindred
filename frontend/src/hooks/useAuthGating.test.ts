/**
 * Tests that authenticated query hooks gate on auth loading state (#623).
 *
 * Verifies that authenticated query hooks gate on auth loading state.
 * Pattern matches useBunkStaff.test.ts auth gating verification.
 */
import { describe, it, expect } from 'vitest'

const GATED_HOOKS = [
  ['useSolverConfig', './useSolverConfig'],
  ['useSyncStatusAPI', './useSyncStatusAPI'],
  ['useAdminSettings', './useAdminSettings'],
  ['useSavedScenarios', './useSavedScenarios'],
  ['useSessionHierarchy', './session/useSessionHierarchy'],
] as const

describe('auth gating: hooks must gate on isLoading or isAuthLoading (#623)', () => {
  it.each(GATED_HOOKS)(
    '%s should destructure isLoading and use it in enabled',
    async (_hookName, modulePath) => {
      const sourceContent = await import(`${modulePath}?raw`)
      const source: string = sourceContent.default
      expect(source).toMatch(/isLoading|isAuthLoading/)
      expect(source).toMatch(/enabled:.*!(isLoading|isAuthLoading)/)
    }
  )
})
