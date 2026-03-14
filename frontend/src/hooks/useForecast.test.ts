/**
 * TDD Tests for useForecast hook.
 *
 * Tests verify the hook uses authenticated fetch to prevent OIDC redirect loops
 * in production. The hook previously used pb.send() which triggers pb.afterSend
 * auth clearing on 401, causing an infinite OIDC redirect loop.
 */
import { describe, it, expect } from 'vitest'

describe('useForecast', () => {
  describe('hook export', () => {
    it('should export useForecast hook', async () => {
      const module = await import('./useForecast')
      expect(typeof module.useForecast).toBe('function')
    })
  })

  describe('authentication', () => {
    it('should import useApiWithAuth for authenticated requests', async () => {
      const sourceContent = await import('./useForecast?raw')
      const source = sourceContent.default

      expect(source).toContain('useApiWithAuth')
      expect(source).toContain('fetchWithAuth')
    })

    it('should NOT use pb.send() for API calls', async () => {
      const sourceContent = await import('./useForecast?raw')
      const source = sourceContent.default

      const hasPbSend = /pb\.send\s*[<(]/.test(source)
      expect(hasPbSend).toBe(false)
    })

    it('should NOT use plain fetch() for API calls', async () => {
      const sourceContent = await import('./useForecast?raw')
      const source = sourceContent.default

      expect(source).toContain('fetchWithAuth')

      const hasPlainFetchApiCall = /await\s+fetch\s*\(`\/api/.test(source)
      expect(hasPlainFetchApiCall).toBe(false)
    })
  })

  it('should guard query with isAuthLoading', async () => {
    const sourceContent = await import('./useForecast?raw')
    const source = sourceContent.default
    expect(source).toContain('isAuthLoading')
    expect(source).toMatch(/enabled:.*!isAuthLoading/)
  })
})
