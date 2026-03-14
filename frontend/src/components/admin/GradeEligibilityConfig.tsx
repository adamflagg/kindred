import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Grid2x2, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { useAdminSessions } from '../../hooks/useAdminSessions'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'

interface SessionConfig {
  min_grade: number | null
  max_grade: number | null
  capacity_override: number | null
}

interface SessionRow {
  cm_id: number
  name: string
  session_type: string
  configId: string | undefined
  config: SessionConfig
}

const DEFAULT_CONFIG: SessionConfig = {
  min_grade: null,
  max_grade: null,
  capacity_override: null,
}

function useGradeEligibilityConfig(year: number) {
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
    queryKey: ['grade-eligibility-threshold', year],
    ...userDataOptions,
    queryFn: async () => {
      return await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "session_availability" && subcategory = "${year}" && config_key = "limited_threshold"`,
      })
    },
  })
}

export function GradeEligibilityConfig() {
  const { currentYear } = useCurrentYear()
  const queryClient = useQueryClient()
  const { data: sessions, isLoading: sessionsLoading } = useAdminSessions(currentYear)
  const { data: configRecords, isLoading: configLoading } = useGradeEligibilityConfig(currentYear)
  const { data: thresholdRecords, isLoading: thresholdLoading } = useThresholdConfig(currentYear)

  const [rows, setRows] = useState<SessionRow[]>([])
  const [threshold, setThreshold] = useState<number>(80)
  const [thresholdId, setThresholdId] = useState<string | undefined>()
  const [isSaving, setIsSaving] = useState(false)

  const buildRows = useCallback(
    (sessionData: typeof sessions, configData: typeof configRecords): SessionRow[] => {
      if (!sessionData) return []

      const result: SessionRow[] = []

      for (const s of sessionData) {
        const rec = s as Record<string, unknown>
        const sType = rec['session_type'] as string
        const cmId = rec['cm_id'] as number
        const name = rec['name'] as string

        const existing = configData?.find((r) => r.config_key === String(cmId))
        const val = existing?.value as SessionConfig | null

        result.push({
          cm_id: cmId,
          name,
          session_type: sType,
          configId: existing?.id,
          config: val
            ? {
                min_grade: val.min_grade ?? null,
                max_grade: val.max_grade ?? null,
                capacity_override: val.capacity_override ?? null,
              }
            : { ...DEFAULT_CONFIG },
        })
      }

      return result
    },
    []
  )

  useEffect(() => {
    setRows(buildRows(sessions, configRecords))
  }, [sessions, configRecords, buildRows])

  useEffect(() => {
    const rec = thresholdRecords?.[0]
    if (rec) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime fallback: `as number` cast may be undefined at runtime
      setThreshold((rec.value as number) ?? 80)
      setThresholdId(rec.id)
    }
  }, [thresholdRecords])

  const handleChange = (cmId: number, field: keyof SessionConfig, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.cm_id === cmId
          ? {
              ...r,
              config: {
                ...r.config,
                [field]: value === '' ? null : Number(value),
              },
            }
          : r
      )
    )
  }

  const hasChanges = (() => {
    const origRows = buildRows(sessions, configRecords)
    const rowsChanged = rows.some((r) => {
      const orig = origRows.find((o) => o.cm_id === r.cm_id)
      return JSON.stringify(r.config) !== JSON.stringify(orig?.config)
    })
    const origThreshold = thresholdRecords?.[0]?.value as number | undefined
    const thresholdChanged = threshold !== (origThreshold ?? 80)
    return rowsChanged || thresholdChanged
  })()

  const handleSave = async () => {
    setIsSaving(true)
    try {
      for (const row of rows) {
        const payload = {
          category: 'session_availability',
          subcategory: String(currentYear),
          config_key: String(row.cm_id),
          value: row.config,
        }
        if (row.configId) {
          await pb.collection('config').update(row.configId, payload)
        } else {
          await pb.collection('config').create(payload)
        }
      }

      // Save threshold
      const thresholdPayload = {
        category: 'session_availability',
        subcategory: String(currentYear),
        config_key: 'limited_threshold',
        value: threshold,
      }
      if (thresholdId) {
        await pb.collection('config').update(thresholdId, thresholdPayload)
      } else {
        await pb.collection('config').create(thresholdPayload)
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.gradeEligibilityConfig(currentYear),
      })
      toast.success('Session availability config saved')
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (sessionsLoading || configLoading || thresholdLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        <span className="text-muted-foreground ml-2 text-sm">
          Loading session availability config...
        </span>
      </div>
    )
  }

  const mainRows = rows.filter((r) => r.session_type !== 'quest' && r.session_type !== 'ag')
  const questRows = rows.filter((r) => r.session_type === 'quest')
  const agRows = rows.filter((r) => r.session_type === 'ag')

  const renderRow = (row: SessionRow) => (
    <tr key={row.cm_id} className="border-border border-b">
      <td className="py-2 pr-4 font-medium">{row.name}</td>
      <td className="px-2 py-2">
        <select
          value={row.config.min_grade ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'min_grade', e.target.value)}
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
          value={row.config.max_grade ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'max_grade', e.target.value)}
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
          value={row.config.capacity_override ?? ''}
          onChange={(e) => handleChange(row.cm_id, 'capacity_override', e.target.value)}
          className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
        />
      </td>
    </tr>
  )

  return (
    <div className="border-border mt-6 rounded-xl border p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Grid2x2 className="text-forest-600 dark:text-forest-400 h-5 w-5" />
        <div>
          <h3 className="text-base font-semibold">Session Availability Config — {currentYear}</h3>
          <p className="text-muted-foreground text-sm">
            Set eligible grade ranges and capacity overrides per session. Used for the availability
            matrix.
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

      {/* Sessions table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-2 pr-4 text-left font-medium">Session</th>
              <th className="px-2 py-2 text-center font-medium">Min Grade</th>
              <th className="px-2 py-2 text-center font-medium">Max Grade</th>
              <th className="px-2 py-2 text-center font-medium">Cap. Override</th>
            </tr>
          </thead>
          <tbody>
            {mainRows.map(renderRow)}
            {questRows.length > 0 && (
              <tr>
                <td
                  colSpan={4}
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
                  colSpan={4}
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
