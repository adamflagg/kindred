import { describe, it, expect } from 'vitest'

describe('useSocialGraphData', () => {
  it('should guard query with isAuthLoading', async () => {
    const sourceContent = await import('./useSocialGraphData?raw')
    const source = sourceContent.default
    expect(source).toContain('isAuthLoading')
    expect(source).toMatch(/enabled:.*!isAuthLoading/)
  })
})
