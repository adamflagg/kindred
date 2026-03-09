import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { parseVersion } from '../utils/versionParser'
import { VersionInfo } from './VersionInfo'

/**
 * Tests for version parsing and VersionInfo display.
 *
 * Version formats from CD pipeline:
 * - Clean tag: "v0.8.0" (release build)
 * - Git describe: "v0.7.0-5-gabc1234" (5 commits after v0.7.0)
 * - Bare SHA: "abc1234" (no tags exist yet)
 * - "dev": local development fallback
 */

describe('parseVersion', () => {
  describe('clean release tags', () => {
    it('should parse a semver tag', () => {
      const result = parseVersion('v0.8.0')
      expect(result).toEqual({
        display: 'v0.8.0',
        url: 'https://github.com/adamflagg/kindred/releases/tag/v0.8.0',
      })
    })

    it('should parse a major.minor tag', () => {
      const result = parseVersion('v1.0')
      expect(result).toEqual({
        display: 'v1.0',
        url: 'https://github.com/adamflagg/kindred/releases/tag/v1.0',
      })
    })
  })

  describe('git describe format (between releases)', () => {
    it('should parse describe with commits ahead', () => {
      const result = parseVersion('v0.7.0-5-gabc1234')
      expect(result).toEqual({
        display: 'v0.7.0+5',
        url: 'https://github.com/adamflagg/kindred/commit/abc1234',
      })
    })

    it('should parse describe with many commits ahead', () => {
      const result = parseVersion('v1.2.3-42-gdeadbeef')
      expect(result).toEqual({
        display: 'v1.2.3+42',
        url: 'https://github.com/adamflagg/kindred/commit/deadbeef',
      })
    })

    it('should parse describe from a major.minor tag', () => {
      const result = parseVersion('v1.0-3-g1234567')
      expect(result).toEqual({
        display: 'v1.0+3',
        url: 'https://github.com/adamflagg/kindred/commit/1234567',
      })
    })
  })

  describe('bare SHA (no tags)', () => {
    it('should parse a short commit hash', () => {
      const result = parseVersion('abc1234')
      expect(result).toEqual({
        display: 'abc1234',
        url: 'https://github.com/adamflagg/kindred/commit/abc1234',
      })
    })
  })

  describe('hidden versions', () => {
    it('should return null for "dev"', () => {
      expect(parseVersion('dev')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseVersion('')).toBeNull()
    })

    it('should return null for undefined', () => {
      expect(parseVersion(undefined as unknown as string)).toBeNull()
    })

    it('should return null for "undefined" string', () => {
      expect(parseVersion('undefined')).toBeNull()
    })
  })
})

// Mock VITE_APP_VERSION for component tests
const mockVersion = (version: string) => {
  vi.stubEnv('VITE_APP_VERSION', version)
}

describe('VersionInfo', () => {
  it('should render release version with link to release page', () => {
    mockVersion('v0.8.0')
    render(<VersionInfo />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('Kindred v0.8.0')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/adamflagg/kindred/releases/tag/v0.8.0',
    )
  })

  it('should render describe version with +N suffix and link to commit', () => {
    mockVersion('v0.7.0-5-gabc1234')
    render(<VersionInfo />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('Kindred v0.7.0+5')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/adamflagg/kindred/commit/abc1234',
    )
  })

  it('should render nothing for "dev"', () => {
    mockVersion('dev')
    const { container } = render(<VersionInfo />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // Container div still renders but is empty
    expect(container.firstChild).toBeEmptyDOMElement()
  })

  it('should render nothing for empty version', () => {
    mockVersion('')
    const { container } = render(<VersionInfo />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
