import { describe, it, expect } from 'vitest'

describe('useClickOutside', () => {
  it('should export useClickOutside hook', async () => {
    const module = await import('./useClickOutside')
    expect(typeof module.useClickOutside).toBe('function')
  })
})
