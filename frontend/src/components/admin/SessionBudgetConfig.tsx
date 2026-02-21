import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DollarSign, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'

interface BudgetValue {
  participant_goal: number | null
  session_fee: number | null
}

interface SessionBudgetRow {
  cm_id: number
  name: string
  session_type: string
  configId: string | undefined
  participant_goal: number | null
  session_fee: number | null
}

const SUMMER_TYPES = ['main', 'embedded', 'ag', 'quest']

function useSessions(year: number) {
  return useQuery({
    queryKey: ['session-budget-sessions', year],
    queryFn: async () => {
      const typeFilter = SUMMER_TYPES.map((t) => `session_type = "${t}"`).join(' || ')
      return await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (${typeFilter})`,
        sort: 'start_date',
      })
    },
    enabled: year > 0,
    ...userDataOptions,
  })
}

function useBudgetConfig(year: number) {
  return useQuery({
    queryKey: queryKeys.sessionBudgetConfig(year),
    ...userDataOptions,
    queryFn: async () => {
      return await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "budget" && subcategory = "${year}"`,
        sort: 'config_key',
      })
    },
  })
}

export function SessionBudgetConfig() {
  const { currentYear } = useCurrentYear()
  const queryClient = useQueryClient()
  const { data: sessions, isLoading: sessionsLoading } = useSessions(currentYear)
  const { data: configRecords, isLoading: configLoading } = useBudgetConfig(currentYear)

  const [rows, setRows] = useState<SessionBudgetRow[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const buildRows = useCallback(
    (
      sessionData: typeof sessions,
      configData: typeof configRecords
    ): SessionBudgetRow[] => {
      if (!sessionData) return []

      const result: SessionBudgetRow[] = []

      for (const s of sessionData) {
        const rec = s as Record<string, unknown>
        const sType = rec['session_type'] as string

        // Skip AG sessions - their enrollment folds into parent main session
        if (sType === 'ag') continue

        const cmId = rec['cm_id'] as number
        const name = rec['name'] as string

        const existing = configData?.find((r) => r.config_key === `session_${cmId}`)
        const val = existing?.value as BudgetValue | null

        result.push({
          cm_id: cmId,
          name,
          session_type: sType,
          configId: existing?.id,
          participant_goal: val?.participant_goal ?? null,
          session_fee: val?.session_fee ?? null,
        })
      }

      return result
    },
    []
  )

  useEffect(() => {
    setRows(buildRows(sessions, configRecords))
  }, [sessions, configRecords, buildRows])

  const handleChange = (
    cmId: number,
    field: 'participant_goal' | 'session_fee',
    value: string
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.cm_id === cmId
          ? { ...r, [field]: value === '' ? null : Number(value) }
          : r
      )
    )
  }

  const hasChanges = (() => {
    const origRows = buildRows(sessions, configRecords)
    return rows.some((r) => {
      const orig = origRows.find((o) => o.cm_id === r.cm_id)
      return (
        r.participant_goal !== orig?.participant_goal ||
        r.session_fee !== orig?.session_fee
      )
    })
  })()

  const handleSave = async () => {
    setIsSaving(true)
    try {
      for (const row of rows) {
        // Skip rows with no values set
        if (row.participant_goal === null && row.session_fee === null && !row.configId) continue

        const payload = {
          category: 'budget',
          subcategory: String(currentYear),
          config_key: `session_${row.cm_id}`,
          value: {
            participant_goal: row.participant_goal,
            session_fee: row.session_fee,
          },
        }

        if (row.configId) {
          await pb.collection('config').update(row.configId, payload)
        } else {
          await pb.collection('config').create(payload)
        }
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionBudgetConfig(currentYear),
      })
      toast.success('Session budgets saved')
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (sessionsLoading || configLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        <span className="text-muted-foreground ml-2 text-sm">Loading session budgets...</span>
      </div>
    )
  }

  return (
    <div className="border-border mt-6 rounded-xl border p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <DollarSign className="text-forest-600 dark:text-forest-400 h-5 w-5" />
        <div>
          <h3 className="text-base font-semibold">Session Budget Config — {currentYear}</h3>
          <p className="text-muted-foreground text-sm">
            Set participant goal and session fee per session. Used for revenue forecasting.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-2 pr-4 text-left font-medium">Session</th>
              <th className="px-2 py-2 text-center font-medium">Participant Goal</th>
              <th className="px-2 py-2 text-center font-medium">Session Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.session_type !== 'quest').map((row) => (
              <tr key={row.cm_id} className="border-border border-b">
                <td className="py-2 pr-4 font-medium">{row.name}</td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    value={row.participant_goal ?? ''}
                    onChange={(e) => handleChange(row.cm_id, 'participant_goal', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-24 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-muted-foreground text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={row.session_fee ?? ''}
                      onChange={(e) => handleChange(row.cm_id, 'session_fee', e.target.value)}
                      className="bg-muted/30 dark:bg-muted/50 border-border w-24 rounded border px-2 py-1 text-center text-sm"
                    />
                  </div>
                </td>
              </tr>
            ))}
            {rows.some((r) => r.session_type === 'quest') && (
              <tr>
                <td colSpan={3} className="text-muted-foreground pt-4 pb-2 text-sm font-semibold uppercase">
                  Quests
                </td>
              </tr>
            )}
            {rows.filter((r) => r.session_type === 'quest').map((row) => (
              <tr key={row.cm_id} className="border-border border-b">
                <td className="py-2 pr-4 font-medium">{row.name}</td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    value={row.participant_goal ?? ''}
                    onChange={(e) => handleChange(row.cm_id, 'participant_goal', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-24 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-muted-foreground text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={row.session_fee ?? ''}
                      onChange={(e) => handleChange(row.cm_id, 'session_fee', e.target.value)}
                      className="bg-muted/30 dark:bg-muted/50 border-border w-24 rounded border px-2 py-1 text-center text-sm"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasChanges && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-forest-600 hover:bg-forest-700 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Budgets
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
