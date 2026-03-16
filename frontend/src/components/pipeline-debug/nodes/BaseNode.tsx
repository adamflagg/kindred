/**
 * BaseNode - Shared layout for all pipeline phase nodes.
 *
 * Provides consistent styling with 4 visual states:
 * - success: green border, check icon
 * - warning: amber border, warning icon
 * - error: red border, X icon
 * - skipped: gray/dimmed, dash icon
 *
 * Each phase node wraps BaseNode and determines state from trace data.
 */

import { Handle, Position } from '@xyflow/react'
import { Check, AlertTriangle, X, Minus, Clock } from 'lucide-react'

export type NodeState = 'success' | 'warning' | 'error' | 'skipped'

interface BaseNodeProps {
  label: string
  state: NodeState
  metric?: string
  isStale?: boolean | undefined
  /** Whether to show left (input) handle */
  showInput?: boolean
  /** Whether to show right (output) handle */
  showOutput?: boolean
}

const stateStyles: Record<NodeState, string> = {
  success: 'border-green-500 dark:border-green-400 bg-green-50/80 dark:bg-green-950/30',
  warning: 'border-amber-500 dark:border-amber-400 bg-amber-50/80 dark:bg-amber-950/30',
  error: 'border-red-500 dark:border-red-400 bg-red-50/80 dark:bg-red-950/30',
  skipped: 'border-gray-300 dark:border-gray-600 bg-gray-50/60 dark:bg-gray-900/30 opacity-60',
}

const stateIcons: Record<NodeState, React.ReactElement> = {
  success: <Check className="h-4 w-4 text-green-600 dark:text-green-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  error: <X className="h-4 w-4 text-red-600 dark:text-red-400" />,
  skipped: <Minus className="h-4 w-4 text-gray-400 dark:text-gray-500" />,
}

export function BaseNode({
  label,
  state,
  metric,
  isStale = false,
  showInput = true,
  showOutput = true,
}: BaseNodeProps) {
  return (
    <div
      className={`relative rounded-xl border-2 px-4 py-3 shadow-sm transition-all ${stateStyles[state]} min-w-[140px] cursor-pointer select-none`}
    >
      {showInput && <Handle type="target" position={Position.Left} className="!bg-gray-400" />}
      {showOutput && <Handle type="source" position={Position.Right} className="!bg-gray-400" />}

      {/* Stale badge */}
      {isStale && (
        <span className="absolute -top-2 -right-1 flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
          <Clock className="h-2.5 w-2.5" />
          stale
        </span>
      )}

      {/* Status icon + label */}
      <div className="flex items-center gap-2">
        <span data-testid={`node-status-${state}`}>{stateIcons[state]}</span>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span>
      </div>

      {/* Key metric */}
      {metric && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{metric}</p>}
    </div>
  )
}
