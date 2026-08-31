/**
 * Pure matching and staleness rules for the cabin-weekend attribution queue
 * (`lodging_ingest_issues`, `kind = "ambiguous_session"` — kindred#2648).
 *
 * Split out of `useSessionAttributionQueue` so both can be tested directly,
 * matching the `pushCounts.ts` / `verdictTone.ts` precedent for this
 * surface's shared derivation logic.
 */
import type { LodgingAliasRecord, LodgingIngestIssueRecord } from '../../types/lodging'

/**
 * `pocketbase/sync/lodging_alias_resolver.go:132-139` — trim + lowercase,
 * nothing else. No dash-stripping, no whitespace collapse. Mirrored exactly
 * here so a raw CampMinder value resolves to the SAME unit(s) staff would see
 * from the Go ingest, rather than a second, independently-drifting notion of
 * "the same string".
 */
export function aliasLookupKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Resolve a raw CampMinder cabin string to the real unit name(s) it denotes,
 * through the alias table — never through literal string comparison. Two of
 * the eight currently-open households carry an alias-ONLY match (an
 * area-prefixed CampMinder value whose alias_string differs from the unit
 * name it maps to), which is exactly the case naive equality gets wrong.
 *
 * Returns every member unit's name for a merge alias (2+ members), in the
 * alias row's own member order. Returns `[]` when nothing in the table
 * matches — the ingest that produced this row already ran the same resolver,
 * so an unmatched raw value here means the alias table changed since, not
 * that the row is malformed.
 */
export function resolveCabinAlias(rawValue: string, aliases: LodgingAliasRecord[]): string[] {
  const key = aliasLookupKey(rawValue)
  const match = aliases.find((a) => aliasLookupKey(a.alias_string) === key)
  if (!match) return []
  return (match.expand?.member_units ?? []).map((u) => u.name)
}

/**
 * Which rows in an open `ambiguous_session` batch are stale — CampMinder has
 * since re-keyed the party to a different cabin string (a fresher sibling row
 * exists) or cleared the field entirely (no sibling at all).
 *
 * There is no sync-run timestamp exposed to the frontend to compare against,
 * so this uses the batch's own freshest `last_seen` as a proxy for "the most
 * recent ingest pass that touched this kind" — any row NOT touched by that
 * pass, i.e. strictly older, was not re-observed and so no longer describes
 * what CampMinder currently holds for that party. A tie at the freshest
 * `last_seen` is never flagged: it describes the pass that just ran, not one
 * a later pass superseded.
 *
 * `last_seen` is `required: false` on `lodging_ingest_issues` (migration
 * 1500000122); PocketBase's zero value for an unset date is `''`, which
 * sorts below every real timestamp. A row with no `last_seen` at all is
 * skipped rather than compared -- there is nothing to judge its freshness
 * against, and treating "unknown" as "definitely stale" would silently drop
 * it from both the board chip's count and the admin queue's default view,
 * which is worse than showing an unflagged row nobody can vouch for.
 */
export function computeStaleQueueIds(rows: readonly LodgingIngestIssueRecord[]): Set<string> {
  const stale = new Set<string>()
  if (rows.length === 0) return stale
  let maxLastSeen = ''
  for (const row of rows) {
    if (row.last_seen > maxLastSeen) maxLastSeen = row.last_seen
  }
  for (const row of rows) {
    if (row.last_seen !== '' && row.last_seen < maxLastSeen) stale.add(row.id)
  }
  return stale
}
