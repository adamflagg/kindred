import { describe, it, expect } from 'vitest'

describe('solver types', () => {
  it('should include ag key in capacity_breakdown type', async () => {
    const sourceContent = await import('./solver?raw')
    const source = sourceContent.default

    // The capacity_breakdown type should include boys, girls, AND ag keys
    expect(source).toContain('capacity_breakdown')
    expect(source).toContain('ag: CapacityBreakdownItem')
  })
})
