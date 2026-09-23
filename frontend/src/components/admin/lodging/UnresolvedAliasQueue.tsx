/**
 * The unresolved-cabin-name work queue.
 *
 * When ingest meets a cabin string with no alias it records it here rather
 * than dropping it or raising (spec §3.8). This surface turns each row into
 * one click: pick the unit(s) it means, and the real alias row is created.
 *
 * Picking two or more units denotes a MERGE — a string like "<building> 1and2"
 * means the two rooms bound into one bookable slot, not a third room.
 *
 * A row's name can already have an alias for OTHER years (a building renamed,
 * or a name reused). Mapping it then must not overlap that alias, or the
 * resolver resolves neither (aliasRules.ts, guardAliasOverlap). Such a row
 * shows editable years pre-filled to the free gap, and when the units picked
 * are the ones that alias already names, offers to extend it instead — one
 * alias per name rather than two with the same units.
 *
 * SCOPE: this reads `lodging_ingest_issues` filtered to `kind =
 * "unresolved_alias"`. The other six kinds (ambiguous session, unknown party,
 * write failure…) are real ingest problems but none is fixable by mapping a
 * name to a unit, so offering that action against them would be a dead end.
 * They are deliberately not shown here.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Info } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import toast from 'react-hot-toast'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useLodgingAliases } from '../../../hooks/useLodgingAliases'
import { useLodgingUnits } from '../../../hooks/useLodgingUnits'
import {
  extendAliasForIssue,
  ignoreIngestIssue,
  listUnresolvedAliasIssues,
  mapUnresolvedAlias,
} from '../../../services/lodgingCrud'
import type {
  LodgingAliasRecord,
  LodgingIngestIssueRecord,
  LodgingUnitRecord,
} from '../../../types/lodging'
import {
  invalidateLodgingRegistryQueries,
  queryKeys,
  userDataOptions,
} from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { AliasUnitPicker } from './AliasUnitPicker'
import {
  aliasLookupKey,
  extendWindowToCover,
  findAliasConflicts,
  formatAliasYears,
  freeWindowAround,
} from './aliasRules'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_INLINE, LABEL } from './lodgingStyles'

/** Recorded on the queue row so an ignored entry says why, not just that. */
const NOT_A_CABIN_NOTE = 'Marked by an admin as not a cabin name.'

export function UnresolvedAliasQueue() {
  const queryClient = useQueryClient()
  const { currentYear } = useCurrentYear()

  // CurrentYearContext returns the literal 0 until the backend supplies the
  // configured year. PocketBase answers `year = 0` with a successful `200
  // []` rather than an error, so without this gate a cold load would render
  // an empty queue as if there were genuinely nothing to resolve.
  // FETCH gate for queueQuery below (`enabled: yearReady`), and RENDER guard
  // for both queries — including unitsQuery, which gates its own fetch on
  // year-readiness internally (see useLodgingUnits.ts) and does not take
  // yearReady as an argument. A disabled TanStack query is `isLoading ===
  // false` (pending but idle -- nothing is fetching) with `data === undefined`,
  // which is indistinguishable from a settled empty result to every consumer
  // below, so the render guard is still needed here separately from the fetch
  // gate.
  const yearReady = currentYear > 0

  const queueQuery = useQuery({
    queryKey: queryKeys.lodgingIngestIssues(currentYear),
    ...userDataOptions,
    queryFn: () => listUnresolvedAliasIssues(currentYear),
    enabled: yearReady,
  })
  const unitsQuery = useLodgingUnits()
  const aliasesQuery = useLodgingAliases()

  const refresh = () => {
    invalidateLodgingRegistryQueries(queryClient)
  }

  const handleIgnore = async (row: LodgingIngestIssueRecord) => {
    try {
      await ignoreIngestIssue(row.id, NOT_A_CABIN_NOTE)
      toast.success('Marked as not a cabin name')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update the queue')
    }
  }

  const notACabin = (row: LodgingIngestIssueRecord) => (
    <button type="button" onClick={() => void handleIgnore(row)} className={BUTTON_SECONDARY}>
      Not a cabin
    </button>
  )

  return (
    <QueryGuard
      isLoading={queueQuery.isLoading || !yearReady}
      error={queueQuery.error}
      data={queueQuery.data}
      label="unresolved cabin names"
      emptyMessage="No unresolved cabin names. Other kinds of ingest issue are not shown here."
    >
      {(rows) =>
        rows.length === 0 ? (
          // QueryGuard's emptyMessage only fires on `!data`, and an empty array
          // is truthy — without this the settled-empty case renders a blank
          // page, which reads as a broken feature rather than a clean queue.
          <p className="text-muted-foreground py-12 text-center text-sm">
            No unresolved cabin names. Other kinds of ingest issue are not shown here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.id} className="card-lodge flex flex-col gap-3 p-4">
                <div>
                  <p className="text-foreground font-mono text-sm font-semibold">{row.raw_value}</p>
                  <p className="text-muted-foreground text-xs">{row.source_field}</p>
                  <p className="text-muted-foreground text-xs">
                    Seen {row.occurrences}× · {row.year}
                  </p>
                </div>

                {/* The picker is this screen's only mapping action, so a failed
                    fetch has to say so. Coerced to [], the row renders with
                    nothing to pick and a disabled button, which reads as the
                    queue being broken rather than as a fetch that failed. The
                    alias list is needed too: without it a mapping cannot be
                    checked against the name's other aliases. "Not a cabin"
                    still works — it needs neither. */}
                {unitsQuery.isError || aliasesQuery.isError ? (
                  <>
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {unitsQuery.isError
                        ? 'The units could not be loaded, so this name cannot be mapped right now.'
                        : 'The cabin-name aliases could not be loaded, so this name cannot be mapped right now.'}
                    </p>
                    <div>{notACabin(row)}</div>
                  </>
                ) : unitsQuery.isLoading || aliasesQuery.isLoading || !yearReady ? (
                  <>
                    <p className="text-muted-foreground text-sm">Loading units…</p>
                    <div>{notACabin(row)}</div>
                  </>
                ) : (
                  <MappingControls
                    row={row}
                    units={unitsQuery.items}
                    aliases={aliasesQuery.data ?? []}
                    onDone={refresh}
                    secondaryAction={notACabin(row)}
                  />
                )}
              </div>
            ))}
          </div>
        )
      }
    </QueryGuard>
  )
}

/** Unit codes are the cross-season identity: an alias stores whichever season's ids it was written with. */
function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
}

/**
 * Pick units for one row, and the years to map them for.
 *
 * Mounted only once units AND aliases have loaded, so the pre-filled years
 * below are computed from the real alias list rather than an empty one.
 */
function MappingControls({
  row,
  units,
  aliases,
  onDone,
  secondaryAction,
}: {
  row: LodgingIngestIssueRecord
  units: LodgingUnitRecord[]
  aliases: LodgingAliasRecord[]
  onDone: () => void
  /** "Not a cabin" — sits beside the map button, as it always has. */
  secondaryAction: ReactNode
}) {
  const key = aliasLookupKey(row.raw_value)
  const sameName = aliases.filter((alias) => aliasLookupKey(alias.alias_string) === key)
  const covering = sameName.filter(
    (alias) =>
      (alias.valid_from_year <= 0 || alias.valid_from_year <= row.year) &&
      (alias.valid_to_year <= 0 || row.year <= alias.valid_to_year)
  )
  const free = freeWindowAround(aliases, row.raw_value, row.year)

  const [members, setMembers] = useState<string[]>([])
  // `year` is the camp year the string was seen in, and is the only year
  // dimension on the row: first_seen/last_seen are ingest-RUN timestamps, so
  // neither can open the alias's validity window. The end stops short of any
  // later alias for the same name.
  const [fromYear, setFromYear] = useState(String(row.year))
  const [toYear, setToYear] = useState(free && free.to > 0 ? String(free.to) : '')
  const [isSaving, setIsSaving] = useState(false)

  const codeOf = new Map(units.map((unit) => [unit.id, unit.code]))
  const pickedCodes = members.map((id) => codeOf.get(id) ?? id)
  const extendable =
    members.length === 0
      ? undefined
      : sameName.find(
          (alias) =>
            !covering.includes(alias) &&
            sameCodes(
              (alias.expand?.member_units ?? []).map((unit) => unit.code),
              pickedCodes
            )
        )
  const extendYears = extendable ? extendWindowToCover(extendable, aliases, row.year) : null

  const from = Number.parseInt(fromYear, 10) || 0
  const to = Number.parseInt(toYear, 10) || 0
  const clash = findAliasConflicts(aliases, {
    alias_string: row.raw_value,
    valid_from_year: from,
    valid_to_year: to,
  }).blocking[0]
  const inverted = from > 0 && to > 0 && from > to
  const missesRowYear = (from > 0 && from > row.year) || (to > 0 && to < row.year)
  const yearsInvalid = clash !== undefined || inverted
  const yearProblem = inverted
    ? 'The first year cannot be after the last.'
    : clash
      ? `Overlaps “${clash.alias_string}” (${formatAliasYears(clash.valid_from_year, clash.valid_to_year)}). Neither would resolve in the shared years.`
      : missesRowYear
        ? `These years leave out ${String(row.year)}, so this name would stay unresolved.`
        : ''

  const handleMap = async () => {
    setIsSaving(true)
    try {
      await mapUnresolvedAlias(row.id, row.raw_value, members, {
        validFromYear: sameName.length > 0 ? from : row.year,
        ...(sameName.length > 0 && to > 0 ? { validToYear: to } : {}),
        sourceField: row.source_field,
      })
      toast.success(`Mapped “${row.raw_value}”`)
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to map the cabin name')
    } finally {
      setIsSaving(false)
    }
  }

  const handleExtend = async (alias: LodgingAliasRecord, years: { from: number; to: number }) => {
    setIsSaving(true)
    try {
      await extendAliasForIssue(row.id, alias, years)
      toast.success(`Extended “${alias.alias_string}” to cover ${String(row.year)}`)
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to extend the alias')
    } finally {
      setIsSaving(false)
    }
  }

  const existingList = sameName.map((alias) => (
    <p key={alias.id} className="text-foreground mt-1">
      “<span className="font-mono">{alias.alias_string}</span>” →{' '}
      <b>{(alias.expand?.member_units ?? []).map((unit) => unit.name).join(', ') || '—'}</b> ·{' '}
      {formatAliasYears(alias.valid_from_year, alias.valid_to_year)}
    </p>
  ))

  // An alias already covers this year and the string is STILL unresolved —
  // typically its unit has no record this season. A second alias would make
  // the name ambiguous; the fix belongs on that alias.
  if (covering.length > 0) {
    return (
      <>
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <b>An alias for this name already covers {row.year}</b>, but it is not resolving —
            usually because its unit has no {row.year} record. Fix it in the Cabin name aliases tab
            rather than adding a second one.
            {existingList}
          </div>
        </div>
        <div className="text-sm">
          <span className={LABEL}>Maps to</span>
          <AliasUnitPicker units={units} selected={members} onChange={setMembers} />
        </div>
        <div className="flex gap-2">
          <button type="button" disabled className={BUTTON_PRIMARY}>
            Map to selected units
          </button>
          {secondaryAction}
        </div>
      </>
    )
  }

  return (
    <>
      {sameName.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <b>This name already has an alias for other years.</b>{' '}
            {extendable && extendYears
              ? 'These are the units it already maps to, so extending it keeps one alias for the name.'
              : 'The years below are pre-filled so the two don’t overlap.'}
            {existingList}
          </div>
        </div>
      )}

      <div className="text-sm">
        <span className={LABEL}>Maps to (pick two or more for a merge)</span>
        <AliasUnitPicker units={units} selected={members} onChange={setMembers} />
      </div>

      {sameName.length > 0 && !(extendable && extendYears) && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className={LABEL}>Valid from year</span>
            <input
              type="number"
              value={fromYear}
              placeholder="Any"
              aria-invalid={yearsInvalid}
              onChange={(e) => {
                setFromYear(e.target.value)
              }}
              className={`${FIELD_INLINE} w-28 ${yearsInvalid ? 'border-red-600 dark:border-red-400' : ''}`}
            />
          </label>
          <label className="text-sm">
            <span className={LABEL}>Valid to year</span>
            <input
              type="number"
              value={toYear}
              placeholder="Any"
              aria-invalid={yearsInvalid}
              onChange={(e) => {
                setToYear(e.target.value)
              }}
              className={`${FIELD_INLINE} w-28 ${yearsInvalid ? 'border-red-600 dark:border-red-400' : ''}`}
            />
          </label>
          {yearProblem && (
            <p
              className={`pb-2 text-xs ${
                yearsInvalid
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {yearProblem}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {extendable && extendYears ? (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleExtend(extendable, extendYears)}
            className={BUTTON_PRIMARY}
          >
            Extend that alias to cover {row.year}
          </button>
        ) : (
          <button
            type="button"
            disabled={isSaving || members.length === 0 || yearsInvalid || missesRowYear}
            onClick={() => void handleMap()}
            className={BUTTON_PRIMARY}
          >
            Map to selected units
          </button>
        )}
        {secondaryAction}
      </div>
    </>
  )
}
