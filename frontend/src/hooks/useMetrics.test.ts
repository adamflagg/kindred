import { describe, it, expect } from 'vitest'

describe('useMetrics hooks', () => {
  it('should guard all queries with isAuthLoading', async () => {
    const sourceContent = await import('./useMetrics?raw')
    const source = sourceContent.default

    // All 6 hooks should use isAuthLoading
    const matches = source.match(/isAuthLoading/g)
    // 6 destructuring + 6 enabled = at least 12 occurrences
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(12)
  })

  it.each([
    'useRetentionMetrics',
    'useRegistrationMetrics',
    'useComparisonMetrics',
    'useHistoricalTrends',
    'useWaitlistMetrics',
    'useCancellationMetrics',
  ])('%s should include isAuthLoading in enabled condition', async (hookName) => {
    const sourceContent = await import('./useMetrics?raw')
    const source = sourceContent.default

    // Find the function body for this hook
    const funcStart = source.indexOf(`function ${hookName}`)
    expect(funcStart).toBeGreaterThan(-1)

    // Find the next function or end of file
    const nextFunc = source.indexOf('\nexport function', funcStart + 1)
    const funcBody = nextFunc > -1 ? source.slice(funcStart, nextFunc) : source.slice(funcStart)

    expect(funcBody).toContain('isAuthLoading')
  })
})
