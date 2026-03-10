import { describe, it, expect } from 'vitest'
import { sourceBadgeClasses, formatLocation } from '../geoConstants'

describe('formatLocation', () => {
  it('returns "City, ST" for US entries', () => {
    expect(formatLocation('Oakland', 'CA', 'US')).toBe('Oakland, CA')
  })

  it('returns "City, ST" when country is USA', () => {
    expect(formatLocation('Oakland', 'CA', 'USA')).toBe('Oakland, CA')
  })

  it('returns "City, ST" when country is empty string', () => {
    expect(formatLocation('Oakland', 'CA', '')).toBe('Oakland, CA')
  })

  it('returns "City, ST" when country is undefined', () => {
    expect(formatLocation('Oakland', 'CA', undefined)).toBe('Oakland, CA')
  })

  it('returns "City, Country" for non-US entries', () => {
    expect(formatLocation('London', '', 'GB')).toBe('London, GB')
  })

  it('returns "City, Country" for non-US with state', () => {
    expect(formatLocation('Toronto', 'ON', 'CA')).toBe('Toronto, CA')
  })

  it('uses fallbackName when city is missing for non-US', () => {
    expect(formatLocation('', '', 'GB', 'Westminster Academy')).toBe('Westminster Academy, GB')
  })

  it('returns just country when city and fallback are both empty for non-US', () => {
    expect(formatLocation('', '', 'GB')).toBe('GB')
  })

  it('returns city alone when only city provided', () => {
    expect(formatLocation('Oakland', '', '')).toBe('Oakland')
  })

  it('returns state alone when only state provided', () => {
    expect(formatLocation('', 'CA', '')).toBe('CA')
  })

  it('returns empty string when nothing provided', () => {
    expect(formatLocation('', '', '')).toBe('')
  })
})

describe('sourceBadgeClasses', () => {
  it('returns purple classes for curated source', () => {
    const classes = sourceBadgeClasses('curated')
    expect(classes).toContain('purple')
    expect(classes).not.toContain('stone')
  })

  it('returns stone classes for manual source', () => {
    const classes = sourceBadgeClasses('manual')
    expect(classes).toContain('stone')
    expect(classes).not.toContain('purple')
  })

  it('curated and manual have different classes', () => {
    expect(sourceBadgeClasses('curated')).not.toBe(sourceBadgeClasses('manual'))
  })
})
