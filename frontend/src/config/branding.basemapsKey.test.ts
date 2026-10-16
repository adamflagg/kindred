import { describe, expect, it } from 'vitest'
import { getBasemapsKey } from './branding'

describe('getBasemapsKey', () => {
  it('is null when no local branding supplies a basemaps_key, so the public repo never carries one', () => {
    expect(getBasemapsKey()).toBeNull()
  })
})
