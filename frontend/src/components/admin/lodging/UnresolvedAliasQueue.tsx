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
 * SCOPE: this reads `lodging_ingest_issues` filtered to `kind =
 * "unresolved_alias"`. The other six kinds (ambiguous session, unknown party,
 * write failure…) are real ingest problems but none is fixable by mapping a
 * name to a unit, so offering that action against them would be a dead end.
 * They are deliberately not shown here.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'

import {
  ignoreIngestIssue,
  listLodgingUnits,
  listUnresolvedAliasIssues,
  mapUnresolvedAlias,
} from '../../../services/lodgingCrud'
import type { LodgingIngestIssueRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'

/** Recorded on the queue row so an ignored entry says why, not just that. */
const NOT_A_CABIN_NOTE = 'Marked by an admin as not a cabin name.'

export function UnresolvedAliasQueue() {
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Record<string, string[]>>({})

  const queueQuery = useQuery({
    queryKey: queryKeys.lodgingIngestIssues(),
    ...userDataOptions,
    queryFn: listUnresolvedAliasIssues,
  })
  const unitsQuery = useQuery({
    queryKey: queryKeys.lodgingUnits(),
    ...userDataOptions,
    queryFn: listLodgingUnits,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingIngestIssues() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAliases() })
  }

  const toggleUnit = (queueId: string, unitId: string) => {
    setSelection((current) => {
      const chosen = current[queueId] ?? []
      return {
        ...current,
        [queueId]: chosen.includes(unitId)
          ? chosen.filter((id) => id !== unitId)
          : [...chosen, unitId],
      }
    })
  }

  const handleMap = async (row: LodgingIngestIssueRecord) => {
    const unitIds = selection[row.id] ?? []
    try {
      // `year` is the camp year the string was seen in, and is the only year
      // dimension on the row: first_seen/last_seen are ingest-RUN timestamps,
      // so neither can open the alias's validity window.
      await mapUnresolvedAlias(row.id, row.raw_value, unitIds, {
        validFromYear: row.year,
        sourceField: row.source_field,
      })
      toast.success(`Mapped “${row.raw_value}”`)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to map the cabin name')
    }
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

  return (
    <QueryGuard
      isLoading={queueQuery.isLoading}
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
            {rows.map((row) => {
              const chosen = selection[row.id] ?? []
              return (
                <div key={row.id} className="card-lodge flex flex-col gap-3 p-4">
                  <div>
                    <p className="text-foreground font-mono text-sm font-semibold">
                      {row.raw_value}
                    </p>
                    <p className="text-muted-foreground text-xs">{row.source_field}</p>
                    <p className="text-muted-foreground text-xs">
                      Seen {row.occurrences}× · {row.year}
                    </p>
                  </div>

                  <fieldset className="flex flex-wrap gap-3">
                    <legend className="text-muted-foreground mb-1 text-xs font-medium">
                      Maps to (pick two or more for a merge)
                    </legend>
                    {(unitsQuery.data ?? []).map((unit) => (
                      <label key={unit.id} className="inline-flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          aria-label={unit.name}
                          checked={chosen.includes(unit.id)}
                          onChange={() => {
                            toggleUnit(row.id, unit.id)
                          }}
                        />
                        {unit.name}
                      </label>
                    ))}
                  </fieldset>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={chosen.length === 0}
                      onClick={() => void handleMap(row)}
                      className="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Map to selected units
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleIgnore(row)}
                      className="border-border rounded-md border px-3 py-1.5 text-sm font-medium"
                    >
                      Not a cabin
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
    </QueryGuard>
  )
}
