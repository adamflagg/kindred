import { describe, expect, it } from 'vitest'
import { parseVersion, GITHUB_REPO_URL } from '../versionParser'

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
