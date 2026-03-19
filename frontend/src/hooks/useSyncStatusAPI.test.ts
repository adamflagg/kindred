/**
 * Tests for useSyncStatusAPI - verifies centralized queryKeys usage
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('useSyncStatusAPI', () => {
  const sourceCode = readFileSync(resolve(__dirname, 'useSyncStatusAPI.ts'), 'utf-8')

  it('should import queryKeys from centralized utils', () => {
    expect(sourceCode).toMatch(/import.*queryKeys.*from.*['"]\.\.\/utils\/queryKeys['"]/)
  })

  it('should NOT use hardcoded sync-status-api query key', () => {
    expect(sourceCode).not.toContain("'sync-status-api'")
    expect(sourceCode).not.toContain('"sync-status-api"')
  })

  it('should use queryKeys.syncStatus() for the query key', () => {
    expect(sourceCode).toContain('queryKeys.syncStatus()')
  })
})
