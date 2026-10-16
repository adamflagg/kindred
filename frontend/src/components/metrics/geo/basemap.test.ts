import { describe, expect, it } from 'vitest'
import { basemapTileUrl } from './basemap'

const KEYLESS = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

describe('basemapTileUrl', () => {
  it('signs every tile request with the CARTO key, since keyless tiles come back watermarked "API key required"', () => {
    expect(basemapTileUrl('cb1_example')).toBe(`${KEYLESS}?key=cb1_example`)
  })

  it('escapes the key so it cannot break out of the query string', () => {
    expect(basemapTileUrl('a&b c')).toBe(`${KEYLESS}?key=a%26b%20c`)
  })

  it('falls back to the keyless URL when the build has no key', () => {
    expect(basemapTileUrl(null)).toBe(KEYLESS)
    expect(basemapTileUrl('')).toBe(KEYLESS)
  })
})
