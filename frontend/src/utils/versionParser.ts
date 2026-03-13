export const GITHUB_REPO_URL = 'https://github.com/adamflagg/kindred'

// Git describe format: v0.7.0-5-gabc1234 (tag-commitsAhead-gSHA)
const DESCRIBE_RE = /^(v\d+\.\d+(?:\.\d+)?)-(\d+)-g([0-9a-f]+)$/

// Clean version tag: v0.8.0 or v1.0
const TAG_RE = /^v\d+\.\d+(?:\.\d+)?$/

// Bare short SHA (fallback when no tags exist)
const SHA_RE = /^[0-9a-f]{7,40}$/

/**
 * Parse a version string from the CD pipeline into display text and GitHub URL.
 *
 * Formats:
 * - Clean tag "v0.8.0" → links to release page
 * - Git describe "v0.7.0-5-gabc1234" → shows "v0.7.0+5", links to compare view
 * - Bare SHA "abc1234" → links to commit
 * - "dev" / empty / undefined → null (hidden)
 */
export function parseVersion(version: string): { display: string; url: string } | null {
  if (!version || version === 'dev' || version === 'undefined') {
    return null
  }

  // Git describe: v0.7.0-5-gabc1234
  const describeMatch = version.match(DESCRIBE_RE)
  if (describeMatch) {
    const [, tag, ahead, sha] = describeMatch
    return {
      display: `${tag}+${ahead}`,
      url: `${GITHUB_REPO_URL}/compare/${tag}...${sha}`,
    }
  }

  // Clean release tag: v0.8.0
  if (TAG_RE.test(version)) {
    return {
      display: version,
      url: `${GITHUB_REPO_URL}/releases/tag/${version}`,
    }
  }

  // Bare SHA (no tags exist yet)
  if (SHA_RE.test(version)) {
    return {
      display: version,
      url: `${GITHUB_REPO_URL}/commit/${version}`,
    }
  }

  return null
}
