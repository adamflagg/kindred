import { describe, it, expect } from 'vitest'

describe('useWeekOptions', () => {
  it('should guard query with isAuthLoading', async () => {
    const sourceContent = await import('./useWeekOptions?raw')
    const source = sourceContent.default
    expect(source).toContain('isAuthLoading')
    expect(source).toMatch(/enabled:.*!isAuthLoading/)
  })
})
