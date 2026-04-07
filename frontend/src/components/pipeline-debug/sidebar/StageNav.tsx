import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Clock } from 'lucide-react'
import type { TraceData, PipelineStage, PipelinePhase, StageGroup } from '../types'
import { STAGE_GROUPS, STAGE_TO_PHASE } from '../types'
import { STAGE_LABELS } from '../phaseDescriptions'
import { deriveStageStatus, type StageStatus } from './stageStatus'

interface StageNavProps {
  traceData: TraceData
  selectedStage: PipelineStage | null
  onStageSelect: (stage: PipelineStage) => void
  stalePhases: Set<PipelinePhase>
}

const STATUS_ICONS: Record<StageStatus, { symbol: string; color: string }> = {
  success: { symbol: '✓', color: 'text-green-400' },
  warning: { symbol: '⚠', color: 'text-amber-400' },
  error: { symbol: '✗', color: 'text-red-400' },
  skipped: { symbol: '—', color: 'text-gray-500' },
}

/** Summary icon for a collapsed group: worst status wins. */
function groupSummaryStatus(stages: PipelineStage[], traceData: TraceData): StageStatus {
  const statuses = stages.map((s) => deriveStageStatus(s, traceData))
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('warning')) return 'warning'
  if (statuses.includes('success')) return 'success'
  return 'skipped'
}

export function StageNav({ traceData, selectedStage, onStageSelect, stalePhases }: StageNavProps) {
  const selectedGroup = selectedStage
    ? STAGE_GROUPS.find((g) => (g.stages as readonly PipelineStage[]).includes(selectedStage))?.id
    : null

  // Manual user overrides: +1 means force-expanded, -1 means force-collapsed
  const [manualOverrides, setManualOverrides] = useState<Map<StageGroup, 'open' | 'closed'>>(
    new Map()
  )

  // Derived auto-collapse: collapse completed groups that aren't selected
  const autoCollapsed = useMemo<Set<StageGroup>>(() => {
    const result = new Set<StageGroup>()
    for (const group of STAGE_GROUPS) {
      if (group.id === selectedGroup) continue
      const allDone = group.stages.every((s) => {
        const status = deriveStageStatus(s, traceData)
        return status === 'success' || status === 'skipped'
      })
      if (allDone) result.add(group.id)
    }
    return result
  }, [selectedGroup, traceData])

  // Final collapsed set: auto-collapsed merged with manual overrides
  const collapsed = useMemo<Set<StageGroup>>(() => {
    const result = new Set(autoCollapsed)
    for (const [groupId, state] of manualOverrides) {
      if (state === 'open') result.delete(groupId)
      else result.add(groupId)
    }
    return result
  }, [autoCollapsed, manualOverrides])

  const toggleGroup = (groupId: StageGroup) => {
    setManualOverrides((prev) => {
      const next = new Map(prev)
      const currentlyCollapsed = collapsed.has(groupId)
      next.set(groupId, currentlyCollapsed ? 'open' : 'closed')
      return next
    })
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold tracking-widest text-blue-400 uppercase">Pipeline</p>

      {STAGE_GROUPS.map((group) => {
        const isCollapsed = collapsed.has(group.id)
        const summaryStatus = groupSummaryStatus(group.stages, traceData)
        const summaryIcon = STATUS_ICONS[summaryStatus]

        return (
          <div key={group.id}>
            <button
              onClick={() => toggleGroup(group.id)}
              className="flex w-full items-center gap-1 py-1 text-left"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-gray-500" />
              ) : (
                <ChevronDown className="h-3 w-3 text-gray-500" />
              )}
              <span className="text-[10px] font-medium tracking-wide text-gray-500 uppercase">
                {group.label}
              </span>
              {isCollapsed && (
                <span className={`ml-auto text-[10px] ${summaryIcon.color}`}>
                  {summaryIcon.symbol}
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className="ml-1 space-y-px">
                {group.stages.map((stage) => {
                  const status = deriveStageStatus(stage, traceData)
                  const icon = STATUS_ICONS[status]
                  const isSelected = selectedStage === stage
                  const isStale = stalePhases.has(STAGE_TO_PHASE[stage])

                  return (
                    <button
                      key={stage}
                      onClick={() => onStageSelect(stage)}
                      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                        isSelected
                          ? 'border-l-2 border-blue-500 bg-blue-500/10 font-semibold text-blue-300'
                          : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
                      }`}
                    >
                      <span
                        className={`w-3 text-center text-[10px] ${isSelected ? 'text-blue-400' : icon.color}`}
                      >
                        {isSelected ? '●' : icon.symbol}
                      </span>
                      <span className="flex-1 truncate">{STAGE_LABELS[stage]}</span>
                      {isStale && <Clock className="h-3 w-3 text-amber-400" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
