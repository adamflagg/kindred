import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import {
  fetchSessionUploadChanges,
  type UploadChangeRow,
} from '../../services/sessionUploadChanges'
import { queryKeys } from '../../utils/queryKeys'

interface Props {
  runId: string
  sessionCmIds: number[]
  sessionName: string
  onClose: () => void
}

function isReview(r: UploadChangeRow): boolean {
  return r.final_status === 'pending'
}

export default function SessionUploadChangesModal({
  runId,
  sessionCmIds,
  sessionName,
  onClose,
}: Props) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.sessionUploadChanges(runId, sessionCmIds),
    queryFn: () => fetchSessionUploadChanges(runId, sessionCmIds, fetchWithAuth),
    enabled: !isAuthLoading,
  })

  const byCamper = new Map<number, { name: string; rows: UploadChangeRow[] }>()
  for (const r of rows) {
    const g = byCamper.get(r.requester_cm_id) ?? { name: r.requester_name, rows: [] }
    g.rows.push(r)
    byCamper.set(r.requester_cm_id, g)
  }
  const groups = [...byCamper.entries()]
    .map(([cmId, g]) => ({ cmId, ...g }))
    .sort((a, b) => {
      const ar = a.rows.some(isReview) ? 0 : 1
      const br = b.rows.some(isReview) ? 0 : 1
      return ar - br
    })

  const isEmpty = !isLoading && !isError && groups.length === 0

  return (
    <Modal isOpen onClose={onClose} title={`What's new — ${sessionName}`} size="md" scrollable>
      {isLoading && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}
      {isError && <p className="text-destructive py-4 text-sm">Couldn't load upload changes.</p>}
      {isEmpty && (
        <p className="text-muted-foreground py-4 text-sm">No new requests for this session.</p>
      )}
      {!isLoading &&
        !isError &&
        groups.map((g) => (
          <div key={g.cmId} className="mt-3">
            <div data-testid="camper-group-name" className="text-sm font-bold">
              {g.name}
            </div>
            {g.rows.map((r, i) => (
              <div
                key={i}
                className="border-border/60 dark:border-border/40 flex items-center gap-2 border-b py-1.5 pl-6 text-sm"
              >
                <span className="flex-1">
                  {r.target_name} · {r.request_type}
                </span>
                {isReview(r) ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    ⚠ needs review
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                    ✓ auto-matched
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
    </Modal>
  )
}
