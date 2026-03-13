import { describe, it, expect } from 'vitest'

describe('RegistrationOverview', () => {
  it('should not duplicate gender-by-grade mapping inline', async () => {
    const sourceContent = await import('./RegistrationOverview?raw')
    const source = sourceContent.default

    // The mapping pattern (by_gender_grade inline with tooltipLabel) should appear
    // at most once as a function definition, not repeated inline in JSX
    const inlineMapCount = (source.match(/by_gender_grade.*?\.map\(\(g\) => \(\{/g) || []).length
    expect(inlineMapCount).toBeLessThanOrEqual(0)
  })
})
