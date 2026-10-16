import { describe, expect, it } from 'vitest'
import { getDocsUrl } from './branding'

describe('getDocsUrl', () => {
  it('is null when no local branding supplies a docs_url, so the generic build hides the Staff Guide item', () => {
    expect(getDocsUrl()).toBeNull()
  })
})
