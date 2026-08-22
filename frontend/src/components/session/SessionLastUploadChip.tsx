import { useState } from 'react'
import { Download } from 'lucide-react'
import { useLastUploadSummary } from '../../hooks/session/useLastUploadSummary'
import SessionUploadChangesModal from './SessionUploadChangesModal'

interface Props {
  sessionCmId: number | undefined
  agSessionCmIds: number[]
  sessionName: string
}

export default function SessionLastUploadChip({ sessionCmId, agSessionCmIds, sessionName }: Props) {
  const { runId, session } = useLastUploadSummary(sessionCmId, agSessionCmIds)
  const [open, setOpen] = useState(false)

  // Render-time correction, same pattern as usePanelParty's render-time
  // clearing (hooks/usePanelParty.ts):
  // when the summary transiently disappears (refetch gap), this early return
  // unmounts the always-mounted dialog below — and a latched `open` would
  // make it re-open itself via Modal's `appear` the moment data returns.
  if (!session || !runId) {
    if (open) setOpen(false)
    return null
  }

  const cmIds = [sessionCmId, ...agSessionCmIds].filter((k): k is number => typeof k === 'number')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        aria-label="View last upload changes for this session"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="font-semibold">{session.total} new</span>
        {session.needReview > 0 && (
          <span className="font-semibold text-amber-700 dark:text-amber-400">
            · ⚠ {session.needReview} review
          </span>
        )}
      </button>
      {/* Always mounted once session+runId resolve (kindred#2529): the old
          `{open && ...}` gate unmounted the dialog on the frame the close
          fired, so Modal's exit fade never played. The dialog's query gates
          on isOpen, so mounted-closed it fetches nothing. */}
      <SessionUploadChangesModal
        isOpen={open}
        runId={runId}
        sessionCmIds={cmIds}
        sessionName={sessionName}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
