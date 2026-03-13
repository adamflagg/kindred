/**
 * TDD Tests for useSessionAvailability hook.
 *
 * Tests verify the hook uses authenticated fetch to prevent 401 errors in production.
 * The hook previously used raw fetch() without the "Bearer " prefix, causing silent
 * auth failures when AUTH_MODE=production.
 */
import { describe, it, expect } from 'vitest'

describe('useSessionAvailability', () => {
  describe('hook export', () => {
    it('should export useSessionAvailability hook', async () => {
      const module = await import('./useSessionAvailability')
      expect(typeof module.useSessionAvailability).toBe('function')
    })
  })

  describe('authentication', () => {
    it('should import useApiWithAuth for authenticated requests', async () => {
      const sourceContent = await import('./useSessionAvailability?raw')
      const source = sourceContent.default

      expect(source).toContain('useApiWithAuth')
      expect(source).toContain('fetchWithAuth')
    })

    it('should NOT use plain fetch() for API calls', async () => {
      const sourceContent = await import('./useSessionAvailability?raw')
      const source = sourceContent.default

      expect(source).toContain('fetchWithAuth')

      // Should NOT have plain fetch() call to the API endpoint
      const hasPlainFetchApiCall = /await\s+fetch\s*\(`\/api/.test(source)
      expect(hasPlainFetchApiCall).toBe(false)
    })

    it('should NOT use pb.send() for API calls', async () => {
      const sourceContent = await import('./useSessionAvailability?raw')
      const source = sourceContent.default

      const hasPbSend = /pb\.send\s*[<(]/.test(source)
      expect(hasPbSend).toBe(false)
    })
  })

  it('should guard query with isAuthLoading', async () => {
    const sourceContent = await import('./useSessionAvailability?raw')
    const source = sourceContent.default
    expect(source).toContain('isAuthLoading')
    expect(source).toMatch(/enabled:.*!isAuthLoading/)
  })
})
