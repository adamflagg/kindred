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
import toast from 'react-hot-toast'

import { deleteLodgingAlias, listLodgingAliases } from '../../../services/lodgingCrud'
import type { LodgingAliasRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'

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

  const aliasesQuery = useQuery({
    queryKey: queryKeys.lodgingAliases(),
    ...userDataOptions,
    queryFn: listLodgingAliases,
  })

  const handleDelete = async (alias: LodgingAliasRecord) => {
    try {
      await deleteLodgingAlias(alias.id)
      toast.success('Alias deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAliases() })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete the alias')
    }
  }

  return (
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
                <tr className="border-border text-muted-foreground border-b text-xs uppercase">
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
                      <td className="py-2 font-mono text-xs">{alias.alias_string}</td>
                      <td className="py-2">
                        <p>{members.map((unit) => unit.name).join(', ')}</p>
                        <p className="text-muted-foreground text-xs">
                          {members.length > 1
                            ? `Merge of ${String(members.length)} units`
                            : 'Single unit'}
                        </p>
                      </td>
                      <td className="py-2">{yearWindow(alias)}</td>
                      <td className="text-muted-foreground py-2 text-xs">{alias.source_field}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleDelete(alias)}
                          className="text-muted-foreground text-xs font-medium hover:underline"
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
  )
}
