import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'
import {
  matchSessions,
  buildPreview,
  type SessionData,
  type ConfigRecordLike,
  type PopulatePreview,
  type PreviewRegDateItem,
  type PreviewSessionItem,
} from './populateUtils'
import { SUMMER_CAMP_TYPES } from '../../utils/sessionTypePredicates'

function useSummerSessions(year: number) {
  return useQuery({
    queryKey: ['populate-sessions', year],
    queryFn: async () => {
      const typeFilter = SUMMER_CAMP_TYPES.map((t) => `session_type = "${t}"`).join(' || ')
      return await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (${typeFilter})`,
        sort: 'start_date',
      })
    },
    enabled: year > 0,
    ...userDataOptions,
  })
}

function useConfigByCategory(category: string, year: number, extraFilter?: string) {
  const filterParts = [`category = "${category}"`, `subcategory = "${year}"`]
  if (extraFilter) filterParts.push(extraFilter)
  const filter = filterParts.join(' && ')

  return useQuery({
    queryKey: ['populate-config', category, year, extraFilter ?? ''],
    queryFn: async () => {
      return await pb.collection('config').getFullList<ConfigRecord>({ filter })
    },
    enabled: year > 0,
    ...userDataOptions,
  })
}

// ── Component ────────────────────────────────────────────────────────

export function PopulateFromPreviousYear() {
  const { currentYear } = useCurrentYear()
  const previousYear = currentYear - 1
  const queryClient = useQueryClient()

  const [expanded, setExpanded] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  // Previous year data
  const { data: prevSessions } = useSummerSessions(previousYear)
  const { data: prevRegDates } = useConfigByCategory('registration', previousYear)
  const { data: prevGradeConfig } = useConfigByCategory('session_availability', previousYear)
  const { data: prevBudgetConfig } = useConfigByCategory('budget', previousYear)

  // Current year data
  const { data: curSessions } = useSummerSessions(currentYear)
  const { data: curRegDates } = useConfigByCategory('registration', currentYear)
  const { data: curGradeConfig } = useConfigByCategory('session_availability', currentYear)
  const { data: curBudgetConfig } = useConfigByCategory('budget', currentYear)

  // Determine if we have prior-year data worth showing
  const hasPrevData = useMemo(() => {
    if (!prevSessions?.length) return false
    const hasConfig =
      (prevRegDates?.length ?? 0) > 0 ||
      (prevGradeConfig?.length ?? 0) > 0 ||
      (prevBudgetConfig?.length ?? 0) > 0
    return hasConfig
  }, [prevSessions, prevRegDates, prevGradeConfig, prevBudgetConfig])

  // Build preview when expanded
  const preview = useMemo<PopulatePreview | null>(() => {
    if (!expanded) return null
    if (!curSessions || !prevSessions) return null

    const curSessionData: SessionData[] = curSessions.map((s) => {
      const rec = s as Record<string, unknown>
      return {
        cm_id: rec['cm_id'] as number,
        name: rec['name'] as string,
        session_type: rec['session_type'] as string,
        year: rec['year'] as number,
      }
    })

    const prevSessionData: SessionData[] = prevSessions.map((s) => {
      const rec = s as Record<string, unknown>
      return {
        cm_id: rec['cm_id'] as number,
        name: rec['name'] as string,
        session_type: rec['session_type'] as string,
        year: rec['year'] as number,
      }
    })

    const matches = matchSessions(curSessionData, prevSessionData)

    return buildPreview(
      matches,
      (prevRegDates ?? []) as ConfigRecordLike[],
      (prevGradeConfig ?? []) as ConfigRecordLike[],
      (prevBudgetConfig ?? []) as ConfigRecordLike[],
      (curRegDates ?? []) as ConfigRecordLike[],
      (curGradeConfig ?? []) as ConfigRecordLike[],
      (curBudgetConfig ?? []) as ConfigRecordLike[],
      currentYear
    )
  }, [
    expanded,
    curSessions,
    prevSessions,
    prevRegDates,
    prevGradeConfig,
    prevBudgetConfig,
    curRegDates,
    curGradeConfig,
    curBudgetConfig,
    currentYear,
  ])

  // Hidden state: no prior data
  if (!hasPrevData) return null

  const noCurrentSessions = !curSessions?.length

  const handleApply = async () => {
    if (!preview || preview.summary.toCreate === 0) return
    setIsApplying(true)

    try {
      let created = 0

      // Create registration dates
      for (const item of preview.registrationDates) {
        if (item.existingValue !== null) continue
        await pb.collection('config').create({
          category: 'registration',
          subcategory: String(currentYear),
          config_key: item.key,
          value: item.newValue,
          metadata: {
            business_category: 'registration',
            component_type: 'date',
            friendly_name: item.label,
            source: 'default_config',
          },
          description: `Registration date for ${item.key}`,
        })
        created++
      }

      // Create or update grade config
      for (const item of preview.gradeItems) {
        if (item.existingValue !== null) continue
        if (item.existingRecordId) {
          await pb.collection('config').update(item.existingRecordId, {
            value: item.previousValue,
          })
        } else {
          await pb.collection('config').create({
            category: 'session_availability',
            subcategory: String(currentYear),
            config_key: item.newConfigKey,
            value: item.previousValue,
          })
        }
        created++
      }

      // Create threshold
      if (preview.threshold?.existingValue === null) {
        await pb.collection('config').create({
          category: 'session_availability',
          subcategory: String(currentYear),
          config_key: 'limited_threshold',
          value: preview.threshold.newValue,
        })
        created++
      }

      // Create or update budget config
      for (const item of preview.budgetItems) {
        if (item.existingValue !== null) continue
        if (item.existingRecordId) {
          await pb.collection('config').update(item.existingRecordId, {
            value: item.previousValue,
          })
        } else {
          await pb.collection('config').create({
            category: 'budget',
            subcategory: String(currentYear),
            config_key: item.newConfigKey,
            value: item.previousValue,
          })
        }
        created++
      }

      // Invalidate all registration config queries
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.registrationDatesConfig(currentYear),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.gradeEligibilityConfig(currentYear),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessionBudgetConfig(currentYear),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.gradeEligibilityThreshold(currentYear),
        }),
        // Invalidate our own queries so preview refreshes
        queryClient.invalidateQueries({
          queryKey: ['populate-config'],
        }),
      ])

      toast.success(`Populated ${created} config values from ${previousYear}`)
    } catch (error) {
      toast.error(`Failed to populate: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="border-border mb-6 rounded-xl border p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCopy className="text-forest-600 dark:text-forest-400 h-5 w-5" />
          <div>
            <h3 className="text-base font-semibold">Populate from {previousYear}</h3>
            <p className="text-muted-foreground text-sm">
              Copy registration dates, grade ranges, and budgets from last year as a starting point.
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          disabled={noCurrentSessions}
          className="bg-forest-600 hover:bg-forest-700 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          aria-label={noCurrentSessions ? 'Run a sync first' : 'Preview & Populate'}
        >
          {noCurrentSessions ? (
            'Run a sync first'
          ) : (
            <>
              Preview
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </>
          )}
        </button>
      </div>

      {noCurrentSessions && (
        <p className="text-muted-foreground mt-2 text-sm">
          No sessions found for {currentYear}. Run a sync to import session data first.
        </p>
      )}

      {expanded && preview && (
        <div className="mt-4 space-y-4">
          {/* Registration Dates */}
          {preview.registrationDates.length > 0 && (
            <PreviewSection title="Registration Dates">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="py-1.5 pr-4 text-left font-medium">Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">{previousYear}</th>
                    <th className="px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">{currentYear}</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.registrationDates.map((item) => (
                    <RegDateRow key={item.key} item={item} />
                  ))}
                </tbody>
              </table>
            </PreviewSection>
          )}

          {/* Grade Config */}
          {preview.gradeItems.length > 0 && (
            <PreviewSection title="Session Grade Config">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="py-1.5 pr-4 text-left font-medium">Session</th>
                    <th className="px-2 py-1.5 text-left font-medium">Match</th>
                    <th className="px-2 py-1.5 text-left font-medium">Value</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.gradeItems.map((item) => (
                    <SessionConfigRow key={item.newConfigKey} item={item} type="grade" />
                  ))}
                </tbody>
              </table>
            </PreviewSection>
          )}

          {/* Budget Config */}
          {preview.budgetItems.length > 0 && (
            <PreviewSection title="Session Budget Config">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="py-1.5 pr-4 text-left font-medium">Session</th>
                    <th className="px-2 py-1.5 text-left font-medium">Match</th>
                    <th className="px-2 py-1.5 text-left font-medium">Value</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.budgetItems.map((item) => (
                    <SessionConfigRow key={item.newConfigKey} item={item} type="budget" />
                  ))}
                </tbody>
              </table>
            </PreviewSection>
          )}

          {/* Threshold */}
          {preview.threshold && (
            <div className="text-muted-foreground text-sm">
              Limited Space Threshold: {preview.threshold.previousValue}%
              {preview.threshold.existingValue !== null ? ' (already set)' : ' (will be created)'}
            </div>
          )}

          {/* Summary */}
          <div className="border-border flex items-center justify-between border-t pt-4">
            <div className="text-sm">
              <span className="font-medium">{preview.summary.toCreate} to create</span>
              {preview.summary.alreadySet > 0 && (
                <span className="text-muted-foreground ml-3">
                  {preview.summary.alreadySet} already set
                </span>
              )}
              {preview.summary.unmatchedSessions > 0 && (
                <span className="ml-3 text-amber-600 dark:text-amber-400">
                  {preview.summary.unmatchedSessions} unmatched session
                  {preview.summary.unmatchedSessions > 1 ? 's' : ''}
                  {preview.summary.unmatchedSessionNames.length > 0 && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({preview.summary.unmatchedSessionNames.join(', ')})
                    </span>
                  )}
                </span>
              )}
            </div>

            <button
              onClick={handleApply}
              disabled={isApplying || preview.summary.toCreate === 0}
              className="bg-forest-600 hover:bg-forest-700 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              aria-label={preview.summary.toCreate === 0 ? 'Nothing to populate' : 'Apply'}
            >
              {isApplying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying...
                </>
              ) : preview.summary.toCreate === 0 ? (
                'Nothing to populate'
              ) : (
                <>
                  <Check className="h-4 w-4" /> Apply {preview.summary.toCreate} values
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  )
}

function RegDateRow({ item }: { item: PreviewRegDateItem }) {
  const isExisting = item.existingValue !== null
  return (
    <tr className={`border-border border-b ${isExisting ? 'opacity-50' : ''}`}>
      <td className="py-1.5 pr-4 font-medium">{item.label}</td>
      <td className="text-muted-foreground px-2 py-1.5">{item.previousValue}</td>
      <td className="px-2 py-1.5">
        <ArrowRight className="text-muted-foreground h-3 w-3" />
      </td>
      <td className="px-2 py-1.5">{isExisting ? item.existingValue : item.newValue}</td>
      <td className="px-2 py-1.5">
        {isExisting ? (
          <span className="text-muted-foreground text-xs">already set</span>
        ) : (
          <span className="text-forest-600 dark:text-forest-400 text-xs">new</span>
        )}
      </td>
    </tr>
  )
}

function SessionConfigRow({ item, type }: { item: PreviewSessionItem; type: 'grade' | 'budget' }) {
  const isExisting = item.existingValue !== null
  return (
    <tr className={`border-border border-b ${isExisting ? 'opacity-50' : ''}`}>
      <td className="py-1.5 pr-4 font-medium">
        {item.sessionName}
        {item.matchType === 'alias' && item.previousSessionName && (
          <span className="text-muted-foreground ml-1 text-xs font-normal">
            (was {item.previousSessionName})
          </span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {item.matchType === 'alias' && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            alias
          </span>
        )}
        {item.matchType === 'cm_id' && (
          <span className="text-forest-600 dark:text-forest-400 text-xs">exact</span>
        )}
      </td>
      <td className="text-muted-foreground px-2 py-1.5 text-xs">
        {type === 'grade'
          ? formatGradeValue(item.previousValue)
          : formatBudgetValue(item.previousValue)}
      </td>
      <td className="px-2 py-1.5">
        {isExisting ? (
          <span className="text-muted-foreground text-xs">already set</span>
        ) : (
          <span className="text-forest-600 dark:text-forest-400 text-xs">new</span>
        )}
      </td>
    </tr>
  )
}

function formatGradeValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '-'
  const v = value as Record<string, unknown>
  const min = v['min_grade'] ?? '?'
  const max = v['max_grade'] ?? '?'
  return `Grades ${String(min)}–${String(max)}`
}

function formatBudgetValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '-'
  const v = value as Record<string, unknown>
  const goal = v['participant_goal'] ?? '?'
  const fee = v['session_fee'] ?? '?'
  return `Goal: ${String(goal)}, Fee: $${String(fee)}`
}
