/**
 * Tests that authenticated query hooks gate on auth loading state (#623).
 *
 * Verifies that authenticated query hooks gate on auth loading state.
 * Pattern matches useBunkStaff.test.ts auth gating verification.
 */
import { describe, it, expect } from 'vitest'

describe('auth gating: hooks must gate on isLoading or isAuthLoading (#623)', () => {
  it.each([
    ['useSolverConfig', './useSolverConfig'],
    ['useSyncStatusAPI', './useSyncStatusAPI'],
    ['useAdminSettings', './useAdminSettings'],
    ['useSavedScenarios', './useSavedScenarios'],
  ])('%s should destructure isLoading from useAuth', async (_hookName, modulePath) => {
    const sourceContent = await import(`${modulePath}?raw`)
    const source: string = sourceContent.default
    expect(source).toMatch(/isLoading|isAuthLoading/)
  })

  it.each([
    ['useSolverConfig', './useSolverConfig'],
    ['useSyncStatusAPI', './useSyncStatusAPI'],
    ['useAdminSettings', './useAdminSettings'],
    ['useSavedScenarios', './useSavedScenarios'],
  ])('%s should include isLoading in enabled condition', async (_hookName, modulePath) => {
    const sourceContent = await import(`${modulePath}?raw`)
    const source: string = sourceContent.default
    expect(source).toMatch(/enabled:.*!(isLoading|isAuthLoading)/)
  })
})
