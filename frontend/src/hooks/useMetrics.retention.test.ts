/**
 * TDD: queryKeys.retention includeTeenPipeline (Task 8)
 *
 * Pin that the cache key distinguishes on the 6th includeTeenPipeline arg.
 */
import { describe, it, expect } from 'vitest'
import { queryKeys } from '../utils/queryKeys'

describe('queryKeys.retention includeTeenPipeline', () => {
  it('distinguishes the cache key by the flag', () => {
    const off = queryKeys.retention(2025, 2026, 'main', undefined, undefined, false)
    const on = queryKeys.retention(2025, 2026, 'main', undefined, undefined, true)
    expect(off).not.toEqual(on)
    expect(on[on.length - 1]).toBe(true)
  })
})
