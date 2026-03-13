import { describe, it, expect } from 'vitest'

describe('MetricsSessionSelector', () => {
  it('should have accessible group labels with role and aria-labelledby', async () => {
    const sourceContent = await import('./MetricsSessionSelector?raw')
    const source = sourceContent.default

    // Should have role="group" for each section
    expect(source).toContain('role="group"')

    // Should have aria-labelledby linking to section headers
    expect(source).toContain('aria-labelledby')

    // Should have id attributes on section headers
    expect(source).toContain('id="duration-group-label"')
    expect(source).toContain('id="camp-sessions-group-label"')
    expect(source).toContain('id="quests-group-label"')
  })
})
