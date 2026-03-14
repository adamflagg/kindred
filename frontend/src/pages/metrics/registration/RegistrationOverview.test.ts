import { describe, it, expect } from 'vitest'

describe('RegistrationOverview', () => {
  it('should not duplicate gender-by-grade mapping inline', async () => {
    const sourceContent = await import('./RegistrationOverview?raw')
    const source = sourceContent.default

    // Ensure no inline .map() calls on by_gender_grade exist (should use transformGenderByGrade helper)
    const inlineMapCount = (source.match(/by_gender_grade.*?\.map\(\(g\) => \(\{/g) ?? []).length
    expect(inlineMapCount).toBeLessThanOrEqual(0)
  })
})
