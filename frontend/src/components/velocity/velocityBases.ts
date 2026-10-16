/**
 * K13 (#3207). Velocity draws a line from one of two bases, point by point (`data_source`):
 * - "snapshot": the count Kindred stored that night (main, embedded and All-Gender sessions,
 *   from the first nightly snapshot on);
 * - "reconstructed": rebuilt from registration dates, campers registered by that day and not
 *   cancelled by it (every season before the snapshots began, the weeks before a season's first
 *   snapshot, and Quests and teen programs always);
 * - "mixed": a day that adds up sessions of both kinds.
 * Owner, 2026-10-15: "label it but note 2025 and prior, not just 2025, if that is the case." So
 * when the lines on screen do not share one basis, a numbered note says which is which.
 */

export interface BasisPoint {
  /** YYYY-MM-DD */
  date: string
  data_source: 'snapshot' | 'reconstructed' | 'mixed'
}

export interface BasisLine {
  year: number
  points: readonly BasisPoint[]
}

export interface VelocityBases {
  /** The lines the note describes, in the order given: each gets the note's mark. */
  years: number[]
  text: string
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDay(isoDate: string): string {
  return LONG_DATE.format(new Date(`${isoDate}T00:00:00Z`))
}

function joinYears(years: readonly number[]): string {
  if (years.length <= 1) return years.join('')
  return `${years.slice(0, -1).join(', ')} and ${years.at(-1)}`
}

const isStored = (p: BasisPoint) => p.data_source !== 'reconstructed'
const isRebuilt = (p: BasisPoint) => p.data_source !== 'snapshot'

/**
 * The note for the lines on screen (current season first), or null when they share one basis or
 * there is nothing to compare. `snapshotsStart` is the first nightly snapshot of any year: a fully
 * rebuilt season that ended before it is "N and earlier", since every season before it is rebuilt.
 */
export function describeVelocityBases({
  lines,
  snapshotsStart,
  includesRebuiltPrograms,
}: {
  lines: readonly BasisLine[]
  snapshotsStart: string | null
  includesRebuiltPrograms: boolean
}): VelocityBases | null {
  const shown = lines.filter((line) => line.points.length > 0)
  if (shown.length < 2) return null
  const stored = shown.filter((line) => line.points.some(isStored))
  if (stored.length === 0) return null
  const rebuiltOnly = shown.filter((line) => !line.points.some(isStored))
  if (rebuiltOnly.length === 0 && !stored.some((line) => line.points.some(isRebuilt))) return null

  const sentences: string[] = []
  for (const line of stored) {
    const first = line.points.find(isStored)
    const since = first ? ` from ${formatDay(first.date)}` : ''
    const before = line.points[0] && !isStored(line.points[0]) ? ', and is rebuilt before then' : ''
    sentences.push(`${line.year} is the count Kindred stored each night${since}${before}.`)
  }

  // A rebuilt season that ended before the first snapshot speaks for every season before it
  const endedBefore = (line: BasisLine) =>
    snapshotsStart != null && (line.points.at(-1)?.date ?? '') < snapshotsStart
  const older = rebuiltOnly.filter(endedBefore).map((line) => line.year)
  const newer = rebuiltOnly.filter((line) => !endedBefore(line)).map((line) => line.year)
  const rebuiltParts: string[] = []
  if (newer.length)
    rebuiltParts.push(`${joinYears(newer)} ${newer.length === 1 ? 'is' : 'are'} rebuilt`)
  if (older.length) rebuiltParts.push(`${Math.max(...older)} and earlier seasons are rebuilt`)
  const rebuiltWhat =
    'from each camper’s registration date: campers registered by that day and not cancelled by it'
  if (rebuiltParts.length) {
    sentences.push(`${rebuiltParts.join('; ')}, ${rebuiltWhat}.`)
  } else {
    sentences.push(`Rebuilt means counted ${rebuiltWhat}.`)
  }

  if (includesRebuiltPrograms) {
    sentences.push('Quests and teen programs are always rebuilt, in every season.')
  }
  sentences.push(
    'In spring a rebuilt line can run a few campers above the stored count, so a stored line can look a little further behind.'
  )

  return { years: shown.map((line) => line.year), text: sentences.join(' ') }
}
