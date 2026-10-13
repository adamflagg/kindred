export const GITHUB_REPO_URL = 'https://github.com/adamflagg/kindred'

// Git describe format: v0.7.0-5-gabc1234 (tag-commitsAhead-gSHA)
const DESCRIBE_RE = /^(v\d+\.\d+(?:\.\d+)?)-(\d+)-g([0-9a-f]+)$/

// Clean version tag: v0.8.0 or v1.0
const TAG_RE = /^v\d+\.\d+(?:\.\d+)?$/

// Bare short SHA (fallback when no tags exist)
const SHA_RE = /^[0-9a-f]{7,40}$/

export interface VersionAhead {
  display: string
  sha: string
  url: string
}

export interface ParsedVersion {
  display: string
  url: string
  ahead?: VersionAhead
}

/**
 * Parse a version string from the CD pipeline into display text and GitHub URL.
 *
 * Formats:
 * - Clean tag "v0.8.0" → links to release page
 * - Git describe "v0.7.0-5-gabc1234" → tag links to release, "+5" links to diff
 * - Bare SHA "abc1234" → links to commit
 * - "dev" / empty / undefined → null (hidden)
 */
export function parseVersion(version: string): ParsedVersion | null {
  if (!version || version === 'dev' || version === 'undefined') {
    return null
  }

  // Git describe: v0.7.0-5-gabc1234
  const describeMatch = version.match(DESCRIBE_RE)
  if (describeMatch) {
    const tag = describeMatch[1]!
    const aheadCount = describeMatch[2]!
    const sha = describeMatch[3]!
    return {
      display: tag,
      url: `${GITHUB_REPO_URL}/releases/tag/${tag}`,
      ahead: {
        display: `+${aheadCount}`,
        sha,
        url: `${GITHUB_REPO_URL}/compare/${tag}...${sha}`,
      },
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

/** A version's place in release order: tag parts, then commits ahead of it. */
type VersionKey = readonly [major: number, minor: number, patch: number, ahead: number]

// Tag (with optional describe suffix), captured for ordering.
const ORDER_RE = /^v(\d+)\.(\d+)(?:\.(\d+))?(?:-(\d+)-g[0-9a-f]+)?$/

function versionKey(version: string | undefined): VersionKey | null {
  const m = version?.match(ORDER_RE)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)]
}

/**
 * Order two versions by (tag semver, commits ahead): a newer tag wins whatever
 * the other's commits-ahead count, and on the same tag more commits ahead is
 * newer. Returns null when either side cannot be ordered (a bare sha, "dev",
 * empty).
 */
export function compareVersions(a: string | undefined, b: string | undefined): number | null {
  const ka = versionKey(a)
  const kb = versionKey(b)
  if (!ka || !kb) return null
  const [majorA, minorA, patchA, aheadA] = ka
  const [majorB, minorB, patchB, aheadB] = kb
  return majorA - majorB || minorA - minorB || patchA - patchB || aheadA - aheadB
}

/**
 * The newest of the frontend's version and the servers' (CD rebuilds only the
 * images whose files changed, so the three can differ). A bare sha or "dev"
 * cannot be ordered and is ignored beside one that can. With nothing orderable
 * it is the frontend's version if that displays, else the first server version
 * that does, else the frontend's. A tie keeps the earlier one, so the
 * frontend's.
 */
export function newestVersion(frontend: string, others: ReadonlyArray<string | undefined>): string {
  const all = [frontend, ...others]
  let newest: string | undefined
  for (const v of all) {
    if (!versionKey(v)) continue
    if (newest === undefined || (compareVersions(v, newest) ?? 0) > 0) newest = v
  }
  if (newest !== undefined) return newest
  return all.find((v): v is string => v !== undefined && parseVersion(v) !== null) ?? frontend
}
