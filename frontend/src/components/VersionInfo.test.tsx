import { afterEach, beforeEach, describe, it, expect, vi, type MockInstance } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { pb } from '../lib/pocketbase'
import { parseVersion } from '../utils/versionParser'
import { VersionMenuRow } from './VersionInfo'

vi.mock('../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() }, send: vi.fn() },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

/**
 * Tests for version parsing and the Help-menu version row.
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
    it('should parse describe with tag release link and ahead diff link', () => {
      const result = parseVersion('v0.7.0-5-gabc1234')
      expect(result).toEqual({
        display: 'v0.7.0',
        url: 'https://github.com/adamflagg/kindred/releases/tag/v0.7.0',
        ahead: {
          display: '+5',
          sha: 'abc1234',
          url: 'https://github.com/adamflagg/kindred/compare/v0.7.0...abc1234',
        },
      })
    })

    it('should parse describe with many commits ahead', () => {
      const result = parseVersion('v1.2.3-42-gdeadbeef')
      expect(result).toEqual({
        display: 'v1.2.3',
        url: 'https://github.com/adamflagg/kindred/releases/tag/v1.2.3',
        ahead: {
          display: '+42',
          sha: 'deadbeef',
          url: 'https://github.com/adamflagg/kindred/compare/v1.2.3...deadbeef',
        },
      })
    })

    it('should parse describe from a major.minor tag', () => {
      const result = parseVersion('v1.0-3-g1234567')
      expect(result).toEqual({
        display: 'v1.0',
        url: 'https://github.com/adamflagg/kindred/releases/tag/v1.0',
        ahead: {
          display: '+3',
          sha: '1234567',
          url: 'https://github.com/adamflagg/kindred/compare/v1.0...1234567',
        },
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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('VersionMenuRow', () => {
  const REPO = 'https://github.com/adamflagg/kindred'
  let fetchSpy: MockInstance<typeof fetch>

  // The servers' versions. Unset = that server is unreachable, which is also
  // the default, so the frontend's own version is what the row shows.
  const serverVersions = (api?: string, pocketbase?: string) => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        api
          ? new Response(JSON.stringify({ api }), { status: 200 })
          : new Response('{}', { status: 502 })
      )
    )
    vi.mocked(pb.send).mockImplementation(() =>
      pocketbase ? Promise.resolve({ pocketbase }) : Promise.reject(new Error('unreachable'))
    )
  }

  const renderRow = (ui: ReactElement) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    serverVersions()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders a divider and a row for a build ahead of a tag: tag, +N and sha as separate links', () => {
    mockVersion('v6.4.0-248-gc35904c')
    const { container } = renderRow(<VersionMenuRow />)
    const tag = screen.getByRole('link', { name: 'v6.4.0' })
    expect(tag).toHaveAttribute('href', `${REPO}/releases/tag/v6.4.0`)
    const compare = screen.getByRole('link', { name: /\+248/ })
    expect(compare).toHaveAttribute('href', `${REPO}/compare/v6.4.0...c35904c`)
    expect(compare).toHaveTextContent('+248 · c35904c')
    expect(compare.querySelector('.font-mono')).toHaveTextContent('c35904c')
    for (const a of [tag, compare]) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(container.querySelector('.bg-border.my-2.h-px')).not.toBeNull()
    expect(screen.queryByText(/Kindred/)).toBeNull()
  })

  it('makes the whole row clickable: the tag link fills the row up to the compare link', () => {
    mockVersion('v6.4.0-248-gc35904c')
    renderRow(<VersionMenuRow />)
    const tag = screen.getByRole('link', { name: 'v6.4.0' })
    const compare = screen.getByRole('link', { name: /\+248/ })
    expect(tag).toHaveClass('flex-1')
    expect(compare).not.toHaveClass('flex-1')
    // The hover background is on the row, so the tag link must span it.
    expect(tag.parentElement).toHaveClass('hover:bg-muted/50')
    expect(tag.parentElement).toContainElement(compare)
  })

  it('shows "release" on a clean tag, with only the release link', () => {
    mockVersion('v6.5.0')
    renderRow(<VersionMenuRow />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    const tag = screen.getByRole('link', { name: /v6\.5\.0/ })
    expect(tag).toHaveAttribute('href', `${REPO}/releases/tag/v6.5.0`)
    expect(screen.getByText('release')).toBeInTheDocument()
  })

  it('shows the short sha, linked to the commit, on a bare-sha build', () => {
    mockVersion('abc1234')
    renderRow(<VersionMenuRow />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /abc1234/ })).toHaveAttribute(
      'href',
      `${REPO}/commit/abc1234`
    )
    expect(screen.queryByText('release')).toBeNull()
  })

  it('renders no divider and no row for a dev build', () => {
    mockVersion('dev')
    const { container } = renderRow(<VersionMenuRow />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onNavigate when either link is clicked', () => {
    mockVersion('v6.4.0-248-gc35904c')
    const onNavigate = vi.fn()
    renderRow(<VersionMenuRow onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('link', { name: 'v6.4.0' }))
    fireEvent.click(screen.getByRole('link', { name: /\+248/ }))
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('shows the api version when it is newer than the frontend', async () => {
    mockVersion('v6.4.0-240-gaaaaaaa')
    serverVersions('v6.4.0-248-gc35904c', 'v6.4.0-245-gbbbbbbb')
    renderRow(<VersionMenuRow />)
    const compare = await screen.findByRole('link', { name: /\+248/ })
    expect(compare).toHaveAttribute('href', `${REPO}/compare/v6.4.0...c35904c`)
    expect(compare).toHaveTextContent('+248 · c35904c')
    expect(screen.queryByText(/\+240/)).toBeNull()
  })

  it('shows a newer release tag from PocketBase over a build ahead of an older tag', async () => {
    mockVersion('v6.4.0-248-gc35904c')
    serverVersions('v6.4.0-250-gddddddd', 'v6.5.0')
    renderRow(<VersionMenuRow />)
    expect(await screen.findByText('release')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /v6\.5\.0/ })).toHaveAttribute(
      'href',
      `${REPO}/releases/tag/v6.5.0`
    )
    expect(screen.queryByText(/\+250/)).toBeNull()
  })

  it('keeps showing the frontend version when both servers fail', async () => {
    mockVersion('v6.4.0-240-gaaaaaaa')
    renderRow(<VersionMenuRow />)
    await waitFor(() => expect(pb.send).toHaveBeenCalled())
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: /\+240/ })).toHaveTextContent('+240 · aaaaaaa')
  })
})
