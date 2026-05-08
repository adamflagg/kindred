import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Grid2x2, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { useAdminSessions } from '../../hooks/useAdminSessions'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'
import { isQuestSession, isAgSession } from '../../utils/sessionTypePredicates'

interface GradeConfig {
  min_grade: number | null
  max_grade: number | null
  capacity_override: number | null
}

interface BudgetValue {
  participant_goal: number | null
  session_fee: number | null
}

interface SessionRow {
  cm_id: number
  name: string
  session_type: string
  min_grade: number | null
  max_grade: number | null
  capacity_override: number | null
  participant_goal: number | null
  session_fee: number | null
}

const DEFAULT_THRESHOLD = 80

function useGradeConfig(year: number) {
  return useQuery({
    queryKey: queryKeys.gradeEligibilityConfig(year),
    ...userDataOptions,
    queryFn: async () => {
      return await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "session_availability" && subcategory = "${year}" && config_key != "limited_threshold"`,
        sort: 'config_key',
      })
    },
  })
}

function useThresholdConfig(year: number) {
  return useQuery({
    queryKey: queryKeys.gradeEligibilityThreshold(year),
    ...userDataOptions,
    queryFn: async () => {
      return await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "session_availability" && subcategory = "${year}" && config_key = "limited_threshold"`,
      })
    },
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

export function SessionConfigTable() {
  const { currentYear } = useCurrentYear()
  const queryClient = useQueryClient()
  const {
    data: sessions,
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useAdminSessions(currentYear)
  const {
    data: gradeRecords,
    isLoading: gradeLoading,
    error: gradeError,
  } = useGradeConfig(currentYear)
  const {
    data: thresholdRecords,
    isLoading: thresholdLoading,
    error: thresholdError,
  } = useThresholdConfig(currentYear)
  const {
    data: budgetRecords,
    isLoading: budgetLoading,
    error: budgetError,
  } = useBudgetConfig(currentYear)

  const [rows, setRows] = useState<SessionRow[]>([])
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD)
  const [isSaving, setIsSaving] = useState(false)

  const buildRows = useCallback(
    (
      sessionData: typeof sessions,
      gradeData: typeof gradeRecords,
      budgetData: typeof budgetRecords
    ): SessionRow[] => {
      if (!sessionData) return []

      const result: SessionRow[] = []

      for (const s of sessionData) {
        const rec = s as Record<string, unknown>
        const cmId = rec['cm_id'] as number
        const name = rec['name'] as string
        const sType = rec['session_type'] as string

        const gradeRec = gradeData?.find((r) => r.config_key === String(cmId))
        const gradeVal = gradeRec?.value as GradeConfig | null

        const budgetRec = budgetData?.find((r) => r.config_key === `session_${cmId}`)
        const budgetVal = budgetRec?.value as BudgetValue | null

        result.push({
          cm_id: cmId,
          name,
          session_type: sType,
          min_grade: gradeVal?.min_grade ?? null,
          max_grade: gradeVal?.max_grade ?? null,
          capacity_override: gradeVal?.capacity_override ?? null,
          participant_goal: budgetVal?.participant_goal ?? null,
          session_fee: budgetVal?.session_fee ?? null,
        })
      }

      return result
    },
    []
  )

  useEffect(() => {
    setRows(buildRows(sessions, gradeRecords, budgetRecords))
  }, [sessions, gradeRecords, budgetRecords, buildRows])

  useEffect(() => {
    const rec = thresholdRecords?.[0]
    setThreshold(rec && typeof rec.value === 'number' ? rec.value : DEFAULT_THRESHOLD)
  }, [thresholdRecords])

  type EditableField =
    | 'min_grade'
    | 'max_grade'
    | 'capacity_override'
    | 'participant_goal'
    | 'session_fee'

  const handleChange = (cmId: number, field: EditableField, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.cm_id === cmId ? { ...r, [field]: value === '' ? null : Number(value) } : r
      )
    )
  }

  const hasChanges = useMemo(() => {
    const origRows = buildRows(sessions, gradeRecords, budgetRecords)
    const rowsChanged = rows.some((r) => {
      const orig = origRows.find((o) => o.cm_id === r.cm_id)
      return (
        r.min_grade !== orig?.min_grade ||
        r.max_grade !== orig?.max_grade ||
        r.capacity_override !== orig?.capacity_override ||
        r.participant_goal !== orig?.participant_goal ||
        r.session_fee !== orig?.session_fee
      )
    })
    const origThreshold = thresholdRecords?.[0]?.value as number | undefined
    const thresholdChanged = threshold !== (origThreshold ?? DEFAULT_THRESHOLD)
    return rowsChanged || thresholdChanged
  }, [buildRows, sessions, gradeRecords, budgetRecords, rows, threshold, thresholdRecords])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Save grade eligibility config
      for (const row of rows) {
        const existingGrade = gradeRecords?.find((r) => r.config_key === String(row.cm_id))

        // Skip rows with no grade values set
        if (
          row.min_grade === null &&
          row.max_grade === null &&
          row.capacity_override === null &&
          !existingGrade
        )
          continue

        const gradePayload = {
          category: 'session_availability',
          subcategory: String(currentYear),
          config_key: String(row.cm_id),
          value: {
            min_grade: row.min_grade,
            max_grade: row.max_grade,
            capacity_override: row.capacity_override,
          },
        }
        if (existingGrade?.id) {
          await pb.collection('config').update(existingGrade.id, gradePayload)
        } else {
          await pb.collection('config').create(gradePayload)
        }
      }

      // Save threshold
      const thresholdPayload = {
        category: 'session_availability',
        subcategory: String(currentYear),
        config_key: 'limited_threshold',
        value: threshold,
      }
      const existingThresholdId = thresholdRecords?.[0]?.id
      if (existingThresholdId) {
        await pb.collection('config').update(existingThresholdId, thresholdPayload)
      } else {
        await pb.collection('config').create(thresholdPayload)
      }

      // Save budget config
      for (const row of rows) {
        const existingBudget = budgetRecords?.find((r) => r.config_key === `session_${row.cm_id}`)

        // Skip rows with no budget values set
        if (row.participant_goal === null && row.session_fee === null && !existingBudget) continue

        const budgetPayload = {
          category: 'budget',
          subcategory: String(currentYear),
          config_key: `session_${row.cm_id}`,
          value: {
            participant_goal: row.participant_goal,
            session_fee: row.session_fee,
          },
        }
        if (existingBudget?.id) {
          await pb.collection('config').update(existingBudget.id, budgetPayload)
        } else {
          await pb.collection('config').create(budgetPayload)
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gradeEligibilityConfig(currentYear),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.gradeEligibilityThreshold(currentYear),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessionBudgetConfig(currentYear),
        }),
      ])
      toast.success('Session config saved')
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (sessionsLoading || gradeLoading || thresholdLoading || budgetLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        <span className="text-muted-foreground ml-2 text-sm">Loading session config...</span>
      </div>
    )
  }

  const queryError = sessionsError || gradeError || thresholdError || budgetError
  if (queryError) {
    return (
      <div className="flex items-center justify-center py-8 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-5 w-5" />
        <span className="text-sm">Failed to load session config: {queryError.message}</span>
      </div>
    )
  }

  const mainRows = rows.filter((r) => !isQuestSession(r) && !isAgSession(r))
  const questRows = rows.filter(isQuestSession)
  const agRows = rows.filter(isAgSession)

  const renderRow = (row: SessionRow) => (
    <tr key={row.cm_id} className="border-border border-b">
      <th scope="row" id={`session-${row.cm_id}`} className="py-2 pr-4 text-left font-medium">
        {row.name}
      </th>
      <td className="px-2 py-2">
        <select
          value={row.min_grade ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'min_grade', e.target.value)}
          aria-labelledby={`session-${row.cm_id} col-min-grade`}
          className="bg-muted/30 dark:bg-muted/50 border-border w-20 rounded border px-1 py-1 text-center text-sm"
        >
          <option value="" />
          {Array.from({ length: 11 }, (_, i) => i + 2).map((g) => (
            <option key={g} value={g}>
              {formatGradeOrdinal(g)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <select
          value={row.max_grade ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'max_grade', e.target.value)}
          aria-labelledby={`session-${row.cm_id} col-max-grade`}
          className="bg-muted/30 dark:bg-muted/50 border-border w-20 rounded border px-1 py-1 text-center text-sm"
        >
          <option value="" />
          {Array.from({ length: 11 }, (_, i) => i + 2).map((g) => (
            <option key={g} value={g}>
              {formatGradeOrdinal(g)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          value={row.capacity_override ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'capacity_override', e.target.value)}
          aria-labelledby={`session-${row.cm_id} col-cap-override`}
          className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          value={row.participant_goal ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'participant_goal', e.target.value)}
          aria-labelledby={`session-${row.cm_id} col-participant-goal`}
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
            aria-labelledby={`session-${row.cm_id} col-session-fee`}
            className="bg-muted/30 dark:bg-muted/50 border-border w-24 rounded border px-2 py-1 text-center text-sm"
          />
        </div>
      </td>
    </tr>
  )

  return (
    <div className="border-border mt-6 rounded-xl border p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Grid2x2 className="text-forest-600 dark:text-forest-400 h-5 w-5" />
        <div>
          <h3 className="text-base font-semibold">Session Config — {currentYear}</h3>
          <p className="text-muted-foreground text-sm">
            Grade ranges, capacity overrides, and budget per session.
          </p>
        </div>
      </div>

      {/* Threshold */}
      <div className="mb-6 flex items-center gap-3">
        <label htmlFor="threshold" className="text-sm font-medium">
          Limited Space Threshold (%)
        </label>
        <input
          id="threshold"
          type="number"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="bg-muted/30 dark:bg-muted/50 border-border focus:border-forest-500 focus:ring-forest-500 w-20 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </div>

      {/* Combined table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-2 pr-4 text-left font-medium">Session</th>
              <th id="col-min-grade" className="px-2 py-2 text-center font-medium">
                Min Grade
              </th>
              <th id="col-max-grade" className="px-2 py-2 text-center font-medium">
                Max Grade
              </th>
              <th id="col-cap-override" className="px-2 py-2 text-center font-medium">
                Cap. Override
              </th>
              <th id="col-participant-goal" className="px-2 py-2 text-center font-medium">
                Participant Goal
              </th>
              <th id="col-session-fee" className="px-2 py-2 text-center font-medium">
                Session Fee
              </th>
            </tr>
          </thead>
          <tbody>
            {mainRows.map(renderRow)}
            {questRows.length > 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground pt-4 pb-2 text-sm font-semibold uppercase"
                >
                  Quests
                </td>
              </tr>
            )}
            {questRows.map(renderRow)}
            {agRows.length > 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground pt-4 pb-2 text-sm font-semibold uppercase"
                >
                  AG Sessions
                </td>
              </tr>
            )}
            {agRows.map(renderRow)}
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
                <Save className="h-4 w-4" /> Save Config
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
