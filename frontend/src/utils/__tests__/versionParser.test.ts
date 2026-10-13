import { describe, expect, it } from 'vitest'
import { parseVersion, GITHUB_REPO_URL, compareVersions, newestVersion } from '../versionParser'

describe('parseVersion', () => {
  it('returns null for dev', () => {
    expect(parseVersion('dev')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseVersion('')).toBeNull()
  })

  it('returns null for undefined string', () => {
    expect(parseVersion('undefined')).toBeNull()
  })

  it('parses clean release tag', () => {
    expect(parseVersion('v3.4.0')).toEqual({
      display: 'v3.4.0',
      url: `${GITHUB_REPO_URL}/releases/tag/v3.4.0`,
    })
  })

  it('parses two-segment release tag', () => {
    expect(parseVersion('v1.0')).toEqual({
      display: 'v1.0',
      url: `${GITHUB_REPO_URL}/releases/tag/v1.0`,
    })
  })

  it('parses git describe with tag linking to release and ahead linking to diff', () => {
    expect(parseVersion('v3.3.0-6-gabc1234')).toEqual({
      display: 'v3.3.0',
      url: `${GITHUB_REPO_URL}/releases/tag/v3.3.0`,
      ahead: {
        display: '+6',
        sha: 'abc1234',
        url: `${GITHUB_REPO_URL}/compare/v3.3.0...abc1234`,
      },
    })
  })

  it('parses git describe with large commit count', () => {
    expect(parseVersion('v0.7.0-25-g1234567')).toEqual({
      display: 'v0.7.0',
      url: `${GITHUB_REPO_URL}/releases/tag/v0.7.0`,
      ahead: {
        display: '+25',
        sha: '1234567',
        url: `${GITHUB_REPO_URL}/compare/v0.7.0...1234567`,
      },
    })
  })

  it('parses bare SHA', () => {
    expect(parseVersion('abc1234')).toEqual({
      display: 'abc1234',
      url: `${GITHUB_REPO_URL}/commit/abc1234`,
    })
  })

  it('parses full SHA', () => {
    const fullSha = 'abc1234def5678901234567890abcdef12345678'
    expect(parseVersion(fullSha)).toEqual({
      display: fullSha,
      url: `${GITHUB_REPO_URL}/commit/${fullSha}`,
    })
  })
})

describe('compareVersions', () => {
  it('orders by tag first, whatever the commits-ahead count', () => {
    expect(compareVersions('v6.5.0', 'v6.4.0-248-gc35904c')).toBeGreaterThan(0)
    expect(compareVersions('v6.4.0-248-gc35904c', 'v6.5.0-1-gaaaaaaa')).toBeLessThan(0)
  })

  it('compares tag parts numerically, not as text', () => {
    expect(compareVersions('v6.10.0', 'v6.9.0')).toBeGreaterThan(0)
  })

  it('orders by commits ahead on the same tag', () => {
    expect(compareVersions('v6.4.0-248-gc35904c', 'v6.4.0-240-gaaaaaaa')).toBeGreaterThan(0)
  })

  it('puts the clean tag before any build ahead of it', () => {
    expect(compareVersions('v6.4.0', 'v6.4.0-3-gaaaaaaa')).toBeLessThan(0)
  })

  it('reads a major.minor tag as patch 0', () => {
    expect(compareVersions('v1.0', 'v1.0.0')).toBe(0)
  })

  it('returns null when either side cannot be ordered', () => {
    expect(compareVersions('abc1234', 'v6.4.0')).toBeNull()
    expect(compareVersions('v6.4.0', 'dev')).toBeNull()
    expect(compareVersions(undefined, 'v6.4.0')).toBeNull()
  })
})

describe('newestVersion', () => {
  it('picks the newest of the components', () => {
    expect(
      newestVersion('v6.4.0-240-gaaaaaaa', ['v6.4.0-248-gc35904c', 'v6.4.0-245-gbbbbbbb'])
    ).toBe('v6.4.0-248-gc35904c')
  })

  it('prefers a newer tag over more commits ahead of an older one', () => {
    expect(newestVersion('v6.4.0-248-gc35904c', ['v6.5.0', undefined])).toBe('v6.5.0')
  })

  it('keeps the frontend version when it is the newest', () => {
    expect(newestVersion('v6.5.0-2-gaaaaaaa', ['v6.5.0', 'v6.4.0-248-gc35904c'])).toBe(
      'v6.5.0-2-gaaaaaaa'
    )
  })

  it('keeps the frontend version on a tie', () => {
    expect(newestVersion('v6.4.0-248-gaaaaaaa', ['v6.4.0-248-gbbbbbbb'])).toBe(
      'v6.4.0-248-gaaaaaaa'
    )
  })

  it('ignores a bare sha or dev beside an orderable version', () => {
    expect(newestVersion('v6.4.0-240-gaaaaaaa', ['abc1234', 'dev'])).toBe('v6.4.0-240-gaaaaaaa')
    expect(newestVersion('abc1234', ['v6.4.0-240-gaaaaaaa', 'dev'])).toBe('v6.4.0-240-gaaaaaaa')
    expect(newestVersion('dev', ['v6.4.0', undefined])).toBe('v6.4.0')
  })

  it('falls back to the frontend version when nothing can be ordered', () => {
    expect(newestVersion('abc1234', ['def5678', 'dev'])).toBe('abc1234')
    expect(newestVersion('dev', [undefined, undefined])).toBe('dev')
  })

  it('shows a component bare sha when the frontend has nothing to show', () => {
    expect(newestVersion('dev', ['def5678', undefined])).toBe('def5678')
  })
})
