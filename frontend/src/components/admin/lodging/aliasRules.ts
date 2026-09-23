/**
 * When two cabin-name aliases collide, stated once for every admin screen.
 *
 * The sync resolver (`AliasResolver.Resolve`, pocketbase/sync) matches a raw
 * cabin string on `AliasLookupKey`, which ignores outer whitespace and case.
 * When two aliases with that key both cover a year, it marks the year
 * AMBIGUOUS and resolves NEITHER, so every family written with that name drops
 * into the unresolved queue with nothing saying why. The database's unique
 * index compares raw text, so it does not catch this; `guardAliasOverlap`
 * (pocketbase/lodging/hooks.go) refuses the same pair on the server, and the
 * screens use this module to say so before anyone presses Save.
 *
 * Two aliases for one name with SEPARATE windows are legitimate: that is how a
 * building rename is recorded.
 *
 * PocketBase stores an unset number as 0, which on either end of a window
 * means "unbounded".
 */
import type { LodgingAliasRecord } from '../../../types/lodging'

export interface AliasYears {
  from: number
  to: number
}

export interface AliasDraft {
  alias_string: string
  valid_from_year: number
  valid_to_year: number
}

export interface AliasConflicts {
  /** Same name, overlapping years: saving would make the name resolve to neither. */
  blocking: LodgingAliasRecord[]
  /** Same name, separate years: legal (a rename), but worth showing. */
  separateYears: LodgingAliasRecord[]
}

/** Mirrors `sync.AliasLookupKey`: outer whitespace and case only. Inner spacing stays significant. */
export function aliasLookupKey(raw: string): string {
  return raw.trim().toLowerCase()
}

const lower = (year: number) => (year > 0 ? year : -Infinity)
const upper = (year: number) => (year > 0 ? year : Infinity)
const stored = (bound: number) => (Number.isFinite(bound) ? bound : 0)

export function windowsOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return lower(aFrom) <= upper(bTo) && lower(bFrom) <= upper(aTo)
}

const covers = (alias: LodgingAliasRecord, year: number) =>
  lower(alias.valid_from_year) <= year && year <= upper(alias.valid_to_year)

/** A window as staff read it — the aliases table's "Years" column. */
export function formatAliasYears(from: number, to: number): string {
  if (from <= 0 && to <= 0) return 'All years'
  if (to <= 0) return `${String(from)} onwards`
  if (from <= 0) return `Up to ${String(to)}`
  return `${String(from)}–${String(to)}`
}

function sameName(aliases: readonly LodgingAliasRecord[], aliasString: string, selfId?: string) {
  const key = aliasLookupKey(aliasString)
  if (key === '') return []
  return aliases.filter((a) => a.id !== selfId && aliasLookupKey(a.alias_string) === key)
}

export function findAliasConflicts(
  aliases: readonly LodgingAliasRecord[],
  draft: AliasDraft,
  selfId?: string
): AliasConflicts {
  const blocking: LodgingAliasRecord[] = []
  const separateYears: LodgingAliasRecord[] = []
  for (const other of sameName(aliases, draft.alias_string, selfId)) {
    const clash = windowsOverlap(
      draft.valid_from_year,
      draft.valid_to_year,
      other.valid_from_year,
      other.valid_to_year
    )
    ;(clash ? blocking : separateYears).push(other)
  }
  return { blocking, separateYears }
}

/**
 * The widest window around `year` that no alias for this name touches, or
 * null when one already covers `year` — then no new window can include it.
 */
export function freeWindowAround(
  aliases: readonly LodgingAliasRecord[],
  aliasString: string,
  year: number,
  selfId?: string
): AliasYears | null {
  let from = -Infinity
  let to = Infinity
  for (const other of sameName(aliases, aliasString, selfId)) {
    if (covers(other, year)) return null
    if (upper(other.valid_to_year) < year) from = Math.max(from, upper(other.valid_to_year) + 1)
    if (lower(other.valid_from_year) > year) to = Math.min(to, lower(other.valid_from_year) - 1)
  }
  return { from: stored(from), to: stored(to) }
}

/**
 * The window `alias` needs to also cover `year`: only the end facing `year`
 * moves, out to the edge of the free gap around it, so it cannot run into
 * another alias for the same name. Null when another alias already covers
 * `year`, or sits between `alias` and `year` — widening would run through it.
 */
export function extendWindowToCover(
  alias: LodgingAliasRecord,
  aliases: readonly LodgingAliasRecord[],
  year: number
): AliasYears | null {
  const gap = freeWindowAround(aliases, alias.alias_string, year, alias.id)
  if (gap === null) return null
  const from = lower(alias.valid_from_year)
  const to = upper(alias.valid_to_year)
  if (year > to) {
    return to + 1 < lower(gap.from) ? null : { from: stored(from), to: gap.to }
  }
  if (year < from) {
    return upper(gap.to) + 1 < from ? null : { from: gap.from, to: stored(to) }
  }
  return { from: stored(from), to: stored(to) }
}
