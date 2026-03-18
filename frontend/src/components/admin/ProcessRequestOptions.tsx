import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brain, Loader2, AlertTriangle, ChevronDown } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { pb } from '../../lib/pocketbase'
import { useYear } from '../../hooks/useCurrentYear'
import { queryKeys, syncDataOptions } from '../../utils/queryKeys'

export interface ProcessRequestOptionsState {
  session: string
  limit: number | undefined
  forceReprocess: boolean
  sourceFields: string[]
  debug: boolean
  trace: boolean
  collectTraces: boolean
}

interface ProcessRequestOptionsProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (options: ProcessRequestOptionsState) => void
  isProcessing: boolean
}

// Regex patterns to extract friendly names from session names
// TOC returns 'toc' (backend sessionNameMap maps toc→1); numbered sessions return '2', '2a', etc.
const SESSION_NAME_PATTERN = /Session\s+(\d+[a-z]?)/i
const TOC_PATTERN = /Taste\s+of\s+Camp/i

function extractFriendlyName(name: string): string | null {
  if (TOC_PATTERN.test(name)) return 'toc'
  const match = name.match(SESSION_NAME_PATTERN)
  const captured = match?.[1]
  return captured ? captured.toLowerCase() : null
}

// Source field options (static - these don't change between years)
const SOURCE_FIELD_OPTIONS = [
  { value: 'bunk_with', label: 'Bunk With' },
  { value: 'not_bunk_with', label: 'Not Bunk With' },
  { value: 'bunking_notes', label: 'Bunking Notes' },
  { value: 'internal_notes', label: 'Internal Notes' },
  { value: 'socialize_with', label: 'Socialize With' },
] as const

export default function ProcessRequestOptions({
  isOpen,
  onClose,
  onSubmit,
  isProcessing,
}: ProcessRequestOptionsProps) {
  const currentYear = useYear()

  const [session, setSession] = useState<string>('all')
  const [limitValue, setLimitValue] = useState<string>('')
  const [forceReprocess, setForceReprocess] = useState(false)
  const [sourceFields, setSourceFields] = useState<string[]>([])
  const [debug, setDebug] = useState(false)
  const [trace, setTrace] = useState(false)
  const [collectTraces, setCollectTraces] = useState(false)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)

  // Reset form when modal closes (render-time check to avoid setState in effect)
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(isOpen)
    setSession('all')
    setLimitValue('')
    setForceReprocess(false)
    setSourceFields([])
    setDebug(false)
    setTrace(false)
    setCollectTraces(false)
  } else if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
  }

  // Fetch sessions dynamically from database (adapts to each year)
  const { data: sessions } = useQuery({
    queryKey: queryKeys.sessions(currentYear),
    queryFn: async () => {
      const records = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${currentYear} && (session_type = "main" || session_type = "embedded")`,
        sort: 'start_date',
      })
      return records
    },
    ...syncDataOptions, // 1 hour stale - sessions don't change often
    enabled: isOpen, // Only fetch when modal is open
  })

  // Build session options dynamically from database
  const sessionOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'all', label: 'All Sessions' },
    ]

    if (sessions) {
      // Sort logically: toc (=1), 2, 2a, 2b, 3, 3a, 4
      const sorted = [...sessions].sort((a, b) => {
        const aName = extractFriendlyName(a.name) ?? ''
        const bName = extractFriendlyName(b.name) ?? ''
        // TOC sorts as session 1
        const aNum = aName === 'toc' ? 1 : parseInt(aName) || 0
        const bNum = bName === 'toc' ? 1 : parseInt(bName) || 0
        if (aNum !== bNum) return aNum - bNum
        return aName.localeCompare(bName)
      })

      const seen = new Set<string>()
      for (const s of sorted) {
        const friendly = extractFriendlyName(s.name)
        if (friendly && !seen.has(friendly)) {
          seen.add(friendly)
          options.push({ value: friendly, label: s.name })
        }
      }
    }

    return options
  }, [sessions])

  const handleSourceFieldToggle = (field: string) => {
    setSourceFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    )
  }

  const handleSubmit = () => {
    const parsedLimit = parseInt(limitValue, 10)
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined

    onSubmit({
      session,
      limit,
      forceReprocess,
      sourceFields,
      debug,
      trace,
      collectTraces,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-100 p-2.5 dark:bg-teal-900/40">
            <Brain className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold" role="heading" aria-level={2}>
              Process Requests
            </h2>
            <p className="text-muted-foreground text-sm">
              Process original bunk requests with AI parsing
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Session Selector */}
          <div>
            <label htmlFor="session-select" className="mb-1.5 block text-sm font-medium">
              Session
            </label>
            <div className="relative">
              <select
                id="session-select"
                value={session}
                onChange={(e) => setSession(e.target.value)}
                disabled={isProcessing}
                className="border-border bg-background text-foreground focus:ring-primary/30 focus:border-primary w-full cursor-pointer appearance-none rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sessionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
            </div>
          </div>

          {/* Source Fields */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Source Fields</label>
            <p className="text-muted-foreground mb-2 text-xs">
              Filter by field type (empty = all fields)
            </p>
            <div className="space-y-2">
              {SOURCE_FIELD_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sourceFields.includes(opt.value)}
                    onChange={() => handleSourceFieldToggle(opt.value)}
                    disabled={isProcessing}
                    className="border-border text-primary focus:ring-primary/30 h-4 w-4 rounded focus:ring-offset-0 disabled:opacity-50"
                    aria-label={opt.label}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Limit Input */}
          <div>
            <label htmlFor="limit-input" className="mb-1.5 block text-sm font-medium">
              Limit (optional)
            </label>
            <input
              id="limit-input"
              type="number"
              value={limitValue}
              onChange={(e) => setLimitValue(e.target.value)}
              placeholder="No limit"
              min="1"
              disabled={isProcessing}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary/30 focus:border-primary w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-muted-foreground mt-1.5 text-xs">
              Limit the number of requests to process (for testing)
            </p>
          </div>

          {/* Force Reprocess Checkbox */}
          <div className="space-y-2">
            <label className="group flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={forceReprocess}
                onChange={(e) => setForceReprocess(e.target.checked)}
                disabled={isProcessing}
                className="border-border text-primary focus:ring-primary/30 h-4 w-4 rounded focus:ring-offset-0 disabled:opacity-50"
                aria-describedby={forceReprocess ? 'force-warning' : undefined}
              />
              <span className="group-hover:text-foreground text-sm font-medium transition-colors">
                Force reprocess
              </span>
            </label>

            {/* Warning when force is enabled */}
            {forceReprocess && (
              <div
                id="force-warning"
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Warning:</strong> This will clear processed flags and delete existing
                  parsed requests for the selected scope, then reprocess from scratch.
                </p>
              </div>
            )}
          </div>

          {/* Collect Traces Checkbox */}
          <label className="group flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={collectTraces}
              onChange={(e) => setCollectTraces(e.target.checked)}
              disabled={isProcessing}
              className="border-border text-primary focus:ring-primary/30 h-4 w-4 rounded focus:ring-offset-0 disabled:opacity-50"
            />
            <div>
              <span className="group-hover:text-foreground text-sm font-medium transition-colors">
                Collect pipeline traces
              </span>
              <p className="text-muted-foreground text-xs">
                Capture detailed trace data at every phase for the Pipeline Debug tool
              </p>
            </div>
          </label>

          {/* Debug/Trace Checkboxes */}
          <div className="space-y-3">
            <label className="block text-sm font-medium">Logging Level</label>
            <div className="flex gap-6">
              <label className="group flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={debug}
                  onChange={(e) => {
                    setDebug(e.target.checked)
                    if (e.target.checked) setTrace(false) // Mutually exclusive
                  }}
                  disabled={isProcessing || trace}
                  className="border-border text-primary focus:ring-primary/30 h-4 w-4 rounded focus:ring-offset-0 disabled:opacity-50"
                />
                <span className="group-hover:text-foreground text-sm transition-colors">Debug</span>
              </label>
              <label className="group flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={trace}
                  onChange={(e) => {
                    setTrace(e.target.checked)
                    if (e.target.checked) setDebug(false) // Mutually exclusive
                  }}
                  disabled={isProcessing || debug}
                  className="border-border text-primary focus:ring-primary/30 h-4 w-4 rounded focus:ring-offset-0 disabled:opacity-50"
                />
                <span className="group-hover:text-foreground text-sm transition-colors">Trace</span>
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              Debug: AI prompts & resolution details. Trace: Very verbose (API params, SDK
              internals)
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="border-border hover:bg-muted flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isProcessing}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Process'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
