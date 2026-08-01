/**
 * The illegal-merge repair queue.
 *
 * A cabin string can resolve to units through a real alias and still be
 * unplaceable: `JudgeMerge` (pocketbase/sync/lodging_merge_rules.go) only
 * accepts a member set that is the COMPLETE child set of some container. A
 * partial set — two rooms of a three-room suite — is queued here as
 * `illegal_merge` rather than silently placed wrong or silently dropped.
 *
 * Task 6's `groupIllegalMerges` collapses the queue's per-party dedup (one
 * broken set blocking twelve households is twelve rows) into one row per
 * member set. This panel renders that row and names, where the registry
 * allows it, which container the set nearly matches and which sibling unit
 * is absent — turning "go figure out why this is broken" into "go add this
 * one room to that alias".
 *
 * ACCEPT ANYWAY IS CUT. The spec's third affordance (§3.5) would tick a row
 * whose blocker is still real, which is a false→true transition — the same
 * one `replayOnResolve` gates on. Replay re-runs the placement, re-hits the
 * same illegal set, and `reopenRecorded` flips the row straight back to
 * unresolved: the row bounces open the instant staff confirm, and nothing is
 * written. Making an override actually work needs a persistent marker that
 * `PlacementIsLegal` itself respects — a migration and a Go change, not a UI
 * one — so only the two affordances that work ship here: send staff to fix
 * the alias, or fix the registry.
 *
 * SCOPE: reads `lodging_ingest_issues` filtered to `kind = "illegal_merge"`,
 * same pattern as `UnresolvedAliasQueue` filtering to `unresolved_alias`. The
 * other kinds are real ingest problems but not this shape of fix.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import {
  listIllegalMergeIssues,
  listLodgingAliases,
  listLodgingUnits,
} from '../../../services/lodgingCrud'
import type {
  LodgingAliasRecord,
  LodgingIngestIssueRecord,
  LodgingUnitRecord,
} from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { ACTION_LINK } from './lodgingStyles'
import { groupIllegalMerges, type MergeRepairGroup } from './mergeRepairGroups'

const EMPTY_MESSAGE =
  'No merge repairs outstanding. Other kinds of ingest issue are not shown here.'

/** Matches `aliasLookupKey` in pocketbase/sync/lodging_alias_resolver.go: outer whitespace and case only. */
function aliasLookupKey(value: string): string {
  return value.trim().toLowerCase()
}

/** Mirrors `aliasRow.covers` in the Go resolver: 0 means unbounded, never a real year. */
function aliasCovers(alias: LodgingAliasRecord, year: number): boolean {
  if (alias.valid_from_year > 0 && year < alias.valid_from_year) return false
  if (alias.valid_to_year > 0 && year > alias.valid_to_year) return false
  return true
}

function findAlias(
  row: LodgingIngestIssueRecord,
  aliases: LodgingAliasRecord[]
): LodgingAliasRecord | undefined {
  const key = aliasLookupKey(row.raw_value)
  return aliases.find(
    (alias) => aliasLookupKey(alias.alias_string) === key && aliasCovers(alias, row.year)
  )
}

/**
 * What the verdict area shows, from "still figuring it out" through the
 * repair hint itself. A discriminated union rather than one string: the
 * fallback text differs by WHY the hint is unavailable, and collapsing that
 * to "missing: " with nothing after it is the exact failure a `?? []` on
 * either secondary query would produce.
 */
type MergeDiagnosis =
  | { kind: 'loading' }
  | { kind: 'error' }
  /** No alias covers this string for this year, so there is no member set to judge. */
  | { kind: 'unmapped' }
  /** Members do not share one parent, or that parent is not a registered container. */
  | { kind: 'no_shared_container' }
  /** Our own read says the set is complete. Should be rare: a legal set replays and drains itself. */
  | { kind: 'now_legal' }
  | {
      kind: 'missing_siblings'
      containerName: string
      missingUnitIds: string[]
      missingUnitNames: string[]
    }

/**
 * SOURCE OF TRUTH: `pocketbase/sync/lodging_merge_rules.go` — `JudgeMerge` and
 * `PlacementIsLegal`. This is a deliberate CLIENT-SIDE MIRROR of that Go rule,
 * not an independent second implementation: no endpoint exposes the verdict
 * `JudgeMerge` computes, so this exists purely to name the missing sibling
 * for staff. It is a HINT, not an authority — the server is still what
 * decides legality on replay. Any change to the Go rule (what counts as a
 * container, how a shared parent is determined, the single-unit special case
 * below) MUST be reflected here, or this panel renders a verdict the server
 * disagrees with.
 */
function diagnoseMerge(memberUnitIds: string[], units: LodgingUnitRecord[]): MergeDiagnosis {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (memberUnitIds.length === 0 || memberUnitIds.some((id) => !byId.has(id))) {
    return { kind: 'unmapped' }
  }

  // Mirrors `PlacementIsLegal`, not `JudgeMerge` directly: a resolution
  // naming exactly one unit is a direct placement, not a merge, so it is
  // unconditionally legal (`!res.IsMerge() || ...` short-circuits before
  // `JudgeMerge` ever runs). `JudgeMerge` itself would call this "needs at
  // least two member units" and report it illegal, which is right for
  // `JudgeMerge`'s own job but wrong here — a narrowed alias (the repair path
  // this panel exists for) lands exactly here, and must never render as
  // "every other room in the building is missing".
  if (memberUnitIds.length === 1) {
    return { kind: 'now_legal' }
  }

  const parentIds = new Set(memberUnitIds.map((id) => byId.get(id)?.parent_unit ?? ''))
  const containerId = parentIds.size === 1 ? [...parentIds][0] : undefined
  const container = containerId ? byId.get(containerId) : undefined
  if (!containerId || !container?.is_container) {
    return { kind: 'no_shared_container' }
  }

  const members = new Set(memberUnitIds)
  const missing = units.filter((unit) => unit.parent_unit === containerId && !members.has(unit.id))
  if (missing.length === 0) {
    return { kind: 'now_legal' }
  }

  return {
    kind: 'missing_siblings',
    containerName: container.name,
    missingUnitIds: missing.map((unit) => unit.id),
    missingUnitNames: missing.map((unit) => unit.name),
  }
}

interface EnrichedGroup extends MergeRepairGroup {
  sourceField: string
  diagnosis: MergeDiagnosis
}

/**
 * The two secondary queries as one tri-state, so `enrichGroup` never has to
 * touch `.data` on either directly — an errored fetch and an empty-but-ready
 * one must never collapse onto the same branch.
 */
type RegistryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; units: LodgingUnitRecord[]; aliases: LodgingAliasRecord[] }

function enrichGroup(
  group: MergeRepairGroup,
  representativeRow: LodgingIngestIssueRecord | undefined,
  registry: RegistryState
): EnrichedGroup {
  const sourceField = representativeRow?.source_field ?? ''

  if (registry.status !== 'ready') {
    return { ...group, sourceField, diagnosis: { kind: registry.status } }
  }
  if (!representativeRow) {
    return { ...group, sourceField, diagnosis: { kind: 'unmapped' } }
  }

  const alias = findAlias(representativeRow, registry.aliases)
  if (!alias) {
    return { ...group, sourceField, diagnosis: { kind: 'unmapped' } }
  }

  const memberUnitIds = alias.member_units
  const diagnosis = diagnoseMerge(memberUnitIds, registry.units)
  const missingUnitIds = diagnosis.kind === 'missing_siblings' ? diagnosis.missingUnitIds : []

  return { ...group, memberUnitIds, missingUnitIds, sourceField, diagnosis }
}

function partyLabel(count: number): string {
  return `${count} ${count === 1 ? 'party' : 'parties'}`
}

function verdictText(diagnosis: MergeDiagnosis): string {
  switch (diagnosis.kind) {
    case 'loading':
      return 'Checking the registry for the missing unit…'
    case 'error':
      return (
        'Could not load the registry, so the missing unit cannot be named here. ' +
        'Check the aliases and units sections directly.'
      )
    case 'unmapped':
      return 'No alias covers this cabin string for this year — check the aliases section.'
    case 'no_shared_container':
      return 'These units do not share one container, so no repair can be named automatically — check the registry.'
    case 'now_legal':
      return 'This set now looks complete. If the row is still open, it should clear on the next sync.'
    case 'missing_siblings': {
      const noun = diagnosis.missingUnitNames.length === 1 ? 'sibling' : 'siblings'
      return `Nearly ${diagnosis.containerName} — missing ${noun}: ${diagnosis.missingUnitNames.join(', ')}.`
    }
  }
}

/** Deep-links to the one unit the merge is missing, when the verdict knows it. */
function registryHref(diagnosis: MergeDiagnosis): string {
  const missingId = diagnosis.kind === 'missing_siblings' ? diagnosis.missingUnitIds[0] : undefined
  return missingId ? `/manage/lodging/units?highlight=${missingId}` : '/manage/lodging/units'
}

function representativeRow(
  group: MergeRepairGroup,
  rowsById: Map<string, LodgingIngestIssueRecord>
): LodgingIngestIssueRecord | undefined {
  for (const id of group.issueIds) {
    const row = rowsById.get(id)
    if (row) return row
  }
  return undefined
}

export function MergeRepairPanel() {
  const queueQuery = useQuery({
    queryKey: queryKeys.lodgingIllegalMergeIssues(),
    ...userDataOptions,
    queryFn: listIllegalMergeIssues,
  })
  const unitsQuery = useQuery({
    queryKey: queryKeys.lodgingUnits(),
    ...userDataOptions,
    queryFn: listLodgingUnits,
  })
  const aliasesQuery = useQuery({
    queryKey: queryKeys.lodgingAliases(),
    ...userDataOptions,
    queryFn: listLodgingAliases,
  })

  // Neither secondary query is coerced with `?? []` anywhere below: an
  // errored fetch must read as "could not load", never as "found nothing".
  const registryState: RegistryState =
    unitsQuery.isError || aliasesQuery.isError
      ? { status: 'error' }
      : unitsQuery.data && aliasesQuery.data
        ? { status: 'ready', units: unitsQuery.data, aliases: aliasesQuery.data }
        : { status: 'loading' }

  return (
    <QueryGuard
      isLoading={queueQuery.isLoading}
      error={queueQuery.error}
      data={queueQuery.data}
      label="merge repairs"
      emptyMessage={EMPTY_MESSAGE}
    >
      {(rows) => {
        const groups = groupIllegalMerges(rows)
        if (groups.length === 0) {
          // QueryGuard's emptyMessage only fires on `!data`, and an empty
          // array is truthy — without this the settled-empty case renders a
          // blank page, which reads as a broken feature rather than a clean
          // queue.
          return <p className="text-muted-foreground py-12 text-center text-sm">{EMPTY_MESSAGE}</p>
        }

        const rowsById = new Map(rows.map((row) => [row.id, row]))

        return (
          <ul className="flex flex-col gap-4">
            {groups.map((group) => {
              const row = representativeRow(group, rowsById)
              const enriched = enrichGroup(group, row, registryState)

              return (
                <li key={group.key} className="card-lodge flex flex-col gap-3 p-4">
                  <div>
                    <p className="text-foreground font-mono text-sm font-semibold">
                      {group.rawValues.join(', ')}
                    </p>
                    <p className="text-muted-foreground text-xs">{enriched.sourceField}</p>
                    <p className="text-sm">
                      {partyLabel(group.partyCount)} blocked on this cabin string
                    </p>
                  </div>

                  <p className="text-muted-foreground text-sm">{verdictText(enriched.diagnosis)}</p>

                  <div className="flex gap-4">
                    <Link to="/manage/lodging/aliases" className={ACTION_LINK}>
                      Edit the alias
                    </Link>
                    <Link to={registryHref(enriched.diagnosis)} className={ACTION_LINK}>
                      Edit the registry
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      }}
    </QueryGuard>
  )
}
