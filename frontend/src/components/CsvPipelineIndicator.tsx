import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCsvPipelineStatus } from '../hooks/useCsvPipelineStatus'
import { useClickOutside } from '../hooks/useClickOutside'
import { formatTimestamp } from '../utils/formatTimestamp'

const DISMISSED_KEY = 'csvProgressDismissedRunId'
const LAST_SEEN_KEY = 'csvProgressLastSeenRunId'

export default function CsvPipelineIndicator() {
  const { data } = useCsvPipelineStatus()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(() =>
    localStorage.getItem(DISMISSED_KEY)
  )
  const lastSeenRef = useRef<string | null>(localStorage.getItem(LAST_SEEN_KEY))
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useClickOutside(wrapperRef, () => setPopoverOpen(false), popoverOpen)

  // CORRECT AS-IS, no overlay token (kindred#2237): a trigger popover in the
  // app shell that `useClickOutside` above dismisses on any outside pointer
  // press, so opening anything else closes it first. It hosts no overlay and
  // has no host relationship with one.
  useEffect(() => {
    if (!popoverOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popoverOpen])

  useEffect(() => {
    if (data?.phase === 'done' && data.runId !== lastSeenRef.current) {
      const review = data.counts.needReview
      const reviewLabel = review > 0 ? `, ${review} need${review === 1 ? 's' : ''} review` : ''
      const total = data.counts.total
      const matched = data.counts.autoMatched
      toast.success(
        `Import complete: ${total} new or updated ${total === 1 ? 'request' : 'requests'}, ${matched} auto-matched${reviewLabel}.`,
        { duration: 6000 }
      )
      lastSeenRef.current = data.runId
      localStorage.setItem(LAST_SEEN_KEY, data.runId)
    }
  }, [data])

  if (!data || data.phase === 'idle') return null
  if (data.phase === 'done' && dismissedRunId === data.runId) return null

  const handleDismiss = () => {
    if (data.phase !== 'done') return
    localStorage.setItem(DISMISSED_KEY, data.runId)
    setDismissedRunId(data.runId)
    setPopoverOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs whitespace-nowrap hover:bg-gray-100"
        aria-label="CSV pipeline status"
      >
        {data.phase === 'importing' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
            <span>Importing CSV…</span>
          </>
        )}
        {data.phase === 'matching' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
            <span>Matching CSV requests…</span>
          </>
        )}
        {data.phase === 'done' && (
          <>
            <CheckCircle className="h-3 w-3 text-green-600" />
            <span>
              Import complete · {data.counts.total} new
              {data.counts.needReview > 0 ? <> · ⚠ {data.counts.needReview} review</> : null}
            </span>
          </>
        )}
        {data.phase === 'error' && (
          <>
            <AlertCircle className="h-3 w-3 text-red-600" />
            <span>Import failed. Click for details.</span>
          </>
        )}
      </button>
      {data.phase === 'done' && (
        <button
          type="button"
          onClick={handleDismiss}
          className="ml-1 rounded p-0.5 hover:bg-gray-200"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {popoverOpen && (
        <div
          role="region"
          aria-label="Pipeline detail"
          className="absolute top-full right-0 z-50 mt-1 w-72 rounded border bg-white p-3 shadow-lg"
        >
          {data.phase === 'importing' && (
            <p className="text-sm">Phase 1 of 2 — reading the CSV and adding new request rows.</p>
          )}
          {data.phase === 'matching' && (
            <p className="text-sm">
              Phase 2 of 2 — resolving camper names and calculating requests.
            </p>
          )}
          {data.phase === 'done' && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Import complete</p>
              <ul className="list-disc pl-5">
                <li>
                  {data.counts.total} new or updated{' '}
                  {data.counts.total === 1 ? 'request' : 'requests'}
                </li>
                <li>{data.counts.autoMatched} auto-matched</li>
                {data.counts.needReview > 0 && (
                  <li>
                    {data.counts.needReview} {data.counts.needReview === 1 ? 'needs' : 'need'}{' '}
                    review
                  </li>
                )}
              </ul>
              <p className="text-xs text-gray-600">{formatTimestamp(data.finishedAt)}</p>
            </div>
          )}
          {data.phase === 'error' && (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-red-700">Import failed</p>
              <p className="text-xs text-gray-700">{data.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
