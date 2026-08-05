/**
 * Cabin-name aliases.
 *
 * TEMPORAL by design: buildings were renamed mid-history, and the same string
 * can mean different buildings on either side of a rename. A wrong year window
 * does not error — it silently files a family's history into the wrong
 * building. So the window is shown on every row, and "no end year" reads as
 * "onwards" rather than as the stored 0.
 *
 * member_units is multi-valued: one member is an atomic room, two or more
 * denote a merge.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import {
  deleteLodgingAlias,
  listLodgingAliases,
  listLodgingUnits,
} from '../../../services/lodgingCrud'
import type { LodgingAliasRecord } from '../../../types/lodging'
import {
  invalidateLodgingRegistryQueries,
  queryKeys,
  userDataOptions,
} from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { ACTION_LINK, BUTTON_PRIMARY, HEADER_ROW } from './lodgingStyles'
import { LodgingAliasForm } from './LodgingAliasForm'

/** Stored 0 means "unbounded" — PocketBase never stores NULL in a number. */
function yearWindow(alias: LodgingAliasRecord): string {
  const from = alias.valid_from_year > 0 ? alias.valid_from_year : null
  const to = alias.valid_to_year > 0 ? alias.valid_to_year : null
  if (from === null && to === null) return 'All years'
  if (from !== null && to === null) return `${String(from)} onwards`
  if (from === null && to !== null) return `Up to ${String(to)}`
  return `${String(from)}–${String(to)}`
}

export function LodgingAliasesPanel() {
  const queryClient = useQueryClient()
  const { currentYear } = useCurrentYear()
  const [editing, setEditing] = useState<LodgingAliasRecord | 'new' | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  /**
   * Move attention to the editor whenever it opens — including switching
   * straight from editing one alias to another, since the form never
   * unmounts in between (see the `key` below). Without this, opening the
   * form on a 90-row table produces no visible change below the fold, and
   * the natural response — clicking Edit again, or on a different row — is
   * exactly how a stale-record write would go unnoticed.
   */
  useEffect(() => {
    if (editing === null) return
    formRef.current?.scrollIntoView({ block: 'nearest' })
    formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [editing])

  const aliasesQuery = useQuery({
    queryKey: queryKeys.lodgingAliases(),
    ...userDataOptions,
    queryFn: listLodgingAliases,
  })
  // The member-unit picker offers THIS season's units — a staffer mapping a
  // cabin string today is mapping it to a building that exists now, not to
  // whichever season the alias was originally seeded against (see the
  // `expand: member_units` display in the table below, which is a label from
  // the seed year and deliberately left alone — Task 5 resolves through code).
  // CurrentYearContext returns the literal 0 until the backend supplies the
  // configured year. PocketBase answers `year = 0` with a successful `200
  // []` rather than an error, so without this gate the picker would render
  // as if there were genuinely no units to map an alias to.
  // ONE constant for the fetch gate and the render guard, because gating only
  // the fetch does not fix what the gate is for. A disabled TanStack query is
  // `isLoading === false` (pending but idle -- nothing is fetching) with `data
  // === undefined`, which is indistinguishable from a settled empty result to
  // every consumer below. Derive both from this and they cannot drift apart.
  const yearReady = currentYear > 0

  const unitsQuery = useQuery({
    queryKey: queryKeys.lodgingUnits(currentYear),
    ...userDataOptions,
    queryFn: () => listLodgingUnits(currentYear),
    enabled: yearReady,
  })

  const refresh = () => {
    setEditing(null)
    invalidateLodgingRegistryQueries(queryClient)
  }

  /**
   * Deleting an alias un-resolves every cabin string it covered.
   *
   * `deleteLodgingAlias` reopens the work-queue items that pointed at it, so
   * the strings come back as something staff can see and fix — which is why
   * the ingest queue is invalidated here as well as the alias list.
   */
  const handleDelete = async (alias: LodgingAliasRecord) => {
    if (
      !window.confirm(
        `Delete the alias “${alias.alias_string}”? Any cabin name it resolved ` +
          `returns to the unresolved queue.`
      )
    ) {
      return
    }
    try {
      await deleteLodgingAlias(alias.id)
      toast.success('Alias deleted')
      invalidateLodgingRegistryQueries(queryClient)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete the alias')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          A wrong string, unit, or year window here silently misfiles a family&apos;s history into
          the wrong building — the work queue only catches names it does not recognise at all.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing('new')
          }}
          className={`${BUTTON_PRIMARY} flex-shrink-0`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New alias
        </button>
      </div>

      {editing !== null && (
        <div ref={formRef} className="card-lodge p-4">
          {/* The member checkboxes ARE this form's payload, so opening it
              against an unloaded units list is not a degraded editor but a
              destructive one: saving would strip the alias of its members.
              Hence a state check rather than the usual `?? []`. */}
          {unitsQuery.isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              The units could not be loaded, so an alias cannot be edited right now.
            </p>
          ) : unitsQuery.isLoading || !yearReady ? (
            <p className="text-muted-foreground text-sm">Loading units…</p>
          ) : (
            /* Keyed on the record so React remounts rather than reusing the
               same instance — otherwise the form's useState initialisers
               never re-run when `alias` changes, and a submit after switching
               records writes the PREVIOUS alias's fields to the new one. */
            <LodgingAliasForm
              key={editing === 'new' ? 'new' : editing.id}
              units={unitsQuery.data ?? []}
              alias={editing === 'new' ? undefined : editing}
              onSaved={refresh}
              onCancel={() => {
                setEditing(null)
              }}
            />
          )}
        </div>
      )}

      <QueryGuard
        isLoading={aliasesQuery.isLoading}
        error={aliasesQuery.error}
        data={aliasesQuery.data}
        label="cabin name aliases"
        emptyMessage="No aliases yet."
      >
        {(aliases) =>
          aliases.length === 0 ? (
            // See UnresolvedAliasQueue: QueryGuard's emptyMessage never fires for
            // an empty array, only for absent data.
            <p className="text-muted-foreground py-12 text-center text-sm">No aliases yet.</p>
          ) : (
            <div className="card-lodge overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className={HEADER_ROW}>
                    <th className="pb-2">Cabin string</th>
                    <th className="pb-2">Resolves to</th>
                    <th className="pb-2">Years</th>
                    <th className="pb-2">Source field</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((alias) => {
                    const members = alias.expand?.member_units ?? []
                    return (
                      <tr key={alias.id} className="border-border/50 border-b">
                        <td className="py-1.5 font-mono text-xs">{alias.alias_string}</td>
                        <td className="py-1.5">
                          <p>{members.map((unit) => unit.name).join(', ')}</p>
                          <p className="text-muted-foreground text-xs">
                            {members.length > 1
                              ? `Merge of ${String(members.length)} units`
                              : 'Single unit'}
                          </p>
                        </td>
                        <td className="py-1.5">{yearWindow(alias)}</td>
                        <td className="text-muted-foreground py-1.5 text-xs">
                          {alias.source_field}
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(alias)
                            }}
                            aria-label={`Edit ${alias.alias_string}`}
                            className={`text-primary mr-3 ${ACTION_LINK}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(alias)}
                            aria-label={`Delete ${alias.alias_string}`}
                            className={`text-muted-foreground hover:text-foreground ${ACTION_LINK}`}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryGuard>
    </div>
  )
}
