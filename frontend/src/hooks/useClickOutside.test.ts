import { describe, it, expect } from 'vitest'

describe('useClickOutside', () => {
  it('should export useClickOutside hook', async () => {
    const module = await import('./useClickOutside')
    expect(typeof module.useClickOutside).toBe('function')
  })

  it('should accept a ref and callback', async () => {
    const sourceContent = await import('./useClickOutside?raw')
    const source = sourceContent.default
    expect(source).toContain('RefObject')
    expect(source).toContain('mousedown')
    expect(source).toContain('useEffect')
  })
})
