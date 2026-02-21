import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Grid2x2, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'

interface GradeConfig {
  girls_min_grade: number | null
  girls_max_grade: number | null
  boys_min_grade: number | null
  boys_max_grade: number | null
  capacity_override: number | null
}

interface SessionRow {
  cm_id: number
  name: string
  session_type: string
  configId: string | undefined
  config: GradeConfig
}

interface AGSessionRow {
  cm_id: number
  name: string
  parent_id: number | null
  configId: string | undefined
  min_grade: number | null
  max_grade: number | null
  capacity_override: number | null
}

const DEFAULT_CONFIG: GradeConfig = {
  girls_min_grade: null,
  girls_max_grade: null,
  boys_min_grade: null,
  boys_max_grade: null,
  capacity_override: null,
}

const SUMMER_TYPES = ['main', 'embedded', 'ag', 'quest']

function useSessions(year: number) {
  return useQuery({
    queryKey: ['grade-eligibility-sessions', year],
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
  const { data: sessions, isLoading: sessionsLoading } = useSessions(currentYear)
  const { data: configRecords, isLoading: configLoading } = useGradeEligibilityConfig(currentYear)
  const { data: thresholdRecords, isLoading: thresholdLoading } = useThresholdConfig(currentYear)

  const [rows, setRows] = useState<SessionRow[]>([])
  const [agRows, setAgRows] = useState<AGSessionRow[]>([])
  const [threshold, setThreshold] = useState<number>(80)
  const [thresholdId, setThresholdId] = useState<string | undefined>()
  const [isSaving, setIsSaving] = useState(false)

  const buildRows = useCallback(
    (
      sessionData: typeof sessions,
      configData: typeof configRecords
    ): { main: SessionRow[]; ag: AGSessionRow[] } => {
      if (!sessionData) return { main: [], ag: [] }

      const mainRows: SessionRow[] = []
      const agRowList: AGSessionRow[] = []

      for (const s of sessionData) {
        const rec = s as Record<string, unknown>
        const sType = rec['session_type'] as string
        const cmId = rec['cm_id'] as number
        const name = rec['name'] as string
        const parentId = rec['parent_id'] as number | null

        const existing = configData?.find((r) => r.config_key === String(cmId))
        const val = existing?.value as GradeConfig | null

        if (sType === 'ag') {
          agRowList.push({
            cm_id: cmId,
            name,
            parent_id: parentId,
            configId: existing?.id,
            min_grade: val?.girls_min_grade ?? null,
            max_grade: val?.girls_max_grade ?? null,
            capacity_override: val?.capacity_override ?? null,
          })
        } else {
          mainRows.push({
            cm_id: cmId,
            name,
            session_type: sType,
            configId: existing?.id,
            config: val ?? { ...DEFAULT_CONFIG },
          })
        }
      }

      return { main: mainRows, ag: agRowList }
    },
    []
  )

  useEffect(() => {
    const { main, ag } = buildRows(sessions, configRecords)
    setRows(main)
    setAgRows(ag)
  }, [sessions, configRecords, buildRows])

  useEffect(() => {
    if (thresholdRecords && thresholdRecords.length > 0) {
      const rec = thresholdRecords[0]!
      setThreshold((rec.value as number) ?? 80)
      setThresholdId(rec.id)
    }
  }, [thresholdRecords])

  const handleMainChange = (cmId: number, field: keyof GradeConfig, value: string) => {
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

  const handleAgChange = (
    cmId: number,
    field: 'min_grade' | 'max_grade' | 'capacity_override',
    value: string
  ) => {
    setAgRows((prev) =>
      prev.map((r) =>
        r.cm_id === cmId ? { ...r, [field]: value === '' ? null : Number(value) } : r
      )
    )
  }

  const hasChanges = (() => {
    const { main: origMain, ag: origAg } = buildRows(sessions, configRecords)
    const mainChanged = rows.some((r) => {
      const orig = origMain.find((o) => o.cm_id === r.cm_id)
      return JSON.stringify(r.config) !== JSON.stringify(orig?.config)
    })
    const agChanged = agRows.some((r) => {
      const orig = origAg.find((o) => o.cm_id === r.cm_id)
      return (
        r.min_grade !== orig?.min_grade ||
        r.max_grade !== orig?.max_grade ||
        r.capacity_override !== orig?.capacity_override
      )
    })
    const origThreshold = thresholdRecords?.[0]?.value as number | undefined
    const thresholdChanged = threshold !== (origThreshold ?? 80)
    return mainChanged || agChanged || thresholdChanged
  })()

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Save main session configs
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

      // Save AG session configs
      for (const row of agRows) {
        const payload = {
          category: 'session_availability',
          subcategory: String(currentYear),
          config_key: String(row.cm_id),
          value: {
            girls_min_grade: row.min_grade,
            girls_max_grade: row.max_grade,
            boys_min_grade: row.min_grade,
            boys_max_grade: row.max_grade,
            capacity_override: row.capacity_override,
          },
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

      {/* Main + Embedded sessions table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-2 pr-4 text-left font-medium">Session</th>
              <th className="px-2 py-2 text-center font-medium">Girls Min</th>
              <th className="px-2 py-2 text-center font-medium">Girls Max</th>
              <th className="px-2 py-2 text-center font-medium">Boys Min</th>
              <th className="px-2 py-2 text-center font-medium">Boys Max</th>
              <th className="px-2 py-2 text-center font-medium">Cap. Override</th>
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
                    max={12}
                    value={row.config.girls_min_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'girls_min_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.girls_max_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'girls_max_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.boys_min_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'boys_min_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.boys_max_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'boys_max_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    value={row.config.capacity_override ?? ''}
                    onChange={(e) =>
                      handleMainChange(row.cm_id, 'capacity_override', e.target.value)
                    }
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
              </tr>
            ))}
            {rows.some((r) => r.session_type === 'quest') && (
              <tr>
                <td colSpan={6} className="text-muted-foreground pt-4 pb-2 text-sm font-semibold uppercase">
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
                    max={12}
                    value={row.config.girls_min_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'girls_min_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.girls_max_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'girls_max_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.boys_min_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'boys_min_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={row.config.boys_max_grade ?? ''}
                    onChange={(e) => handleMainChange(row.cm_id, 'boys_max_grade', e.target.value)}
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    value={row.config.capacity_override ?? ''}
                    onChange={(e) =>
                      handleMainChange(row.cm_id, 'capacity_override', e.target.value)
                    }
                    className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AG Sessions */}
      {agRows.length > 0 && (
        <div className="mt-6">
          <h4 className="text-muted-foreground mb-3 text-sm font-semibold uppercase">
            AG Sessions
          </h4>
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
                {agRows.map((row) => (
                  <tr key={row.cm_id} className="border-border border-b">
                    <td className="py-2 pr-4 font-medium">{row.name}</td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        max={12}
                        value={row.min_grade ?? ''}
                        onChange={(e) => handleAgChange(row.cm_id, 'min_grade', e.target.value)}
                        className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        max={12}
                        value={row.max_grade ?? ''}
                        onChange={(e) => handleAgChange(row.cm_id, 'max_grade', e.target.value)}
                        className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        value={row.capacity_override ?? ''}
                        onChange={(e) =>
                          handleAgChange(row.cm_id, 'capacity_override', e.target.value)
                        }
                        className="bg-muted/30 dark:bg-muted/50 border-border w-16 rounded border px-2 py-1 text-center text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
