import { useCallback, useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import Modal from './ui/Modal'
import { ConfirmActionPopover } from './ConfirmActionPopover'
import { RequestEditableHeader } from './RequestEditableHeader'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { invalidateRequestQueries, queryKeys } from '../utils/queryKeys'
import { formatSourceField } from '../utils/formatSourceField'
import { formatReason } from '../utils/dispositionColors'
import { highlightSourceText } from '../utils/highlightSourceText'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export interface AllCamperRequestsModalProps {
  isOpen: boolean
  onClose: () => void
  requesterCmId: number
  requesterName: string
  year: number
  currentRequestId: string | null
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    case 'resolved':
      return 'bg-forest-100 text-forest-800 dark:bg-forest-900/40 dark:text-forest-200'
    case 'declined':
      return 'bg-bark-100 text-bark-800 dark:bg-bark-900/40 dark:text-bark-200'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function RequestCard({
  request,
  isCurrent = false,
  onAction,
  onUpdate,
  personMap,
}: {
  request: BunkRequestsResponse
  isCurrent?: boolean
  onAction?: (action: 'approve' | 'decline', requestId: string, anchorRect: DOMRect) => void
  onUpdate?: (requestId: string, updates: Partial<BunkRequestsResponse>) => void
  personMap?: Map<number, PersonsResponse>
}) {
  return (
    <article className="border-border bg-card overflow-hidden rounded-xl border">
      <header className="border-border/60 from-forest-50/50 dark:from-forest-900/10 grid grid-cols-[1fr_auto] items-center gap-3 border-b bg-gradient-to-b to-transparent px-4 py-3">
        <RequestEditableHeader
          request={request}
          year={request.year}
          {...(personMap ? { personMap } : {})}
          onUpdate={(updates) => onUpdate?.(request.id, updates)}
          isCurrent={isCurrent}
        />
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(request.status)}`}
          >
            {request.status}
            {request.disposition_reason ? ` · ${formatReason(request.disposition_reason)}` : ''}
          </span>
          {request.staff_touched && (
            <span
              title="A staff user has manually edited this request — the source/notes shown reflect the pipeline's original parse, not the current state."
              className="border-border bg-muted text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
            >
              Staff edited
            </span>
          )}
          {onAction && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Approve"
                title="Approve"
                onClick={(e) => {
                  e.stopPropagation()
                  onAction('approve', request.id, e.currentTarget.getBoundingClientRect())
                }}
                className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 touch-manipulation rounded-lg p-1.5 transition-colors"
              >
                <CheckCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Decline"
                title="Decline"
                onClick={(e) => {
                  e.stopPropagation()
                  onAction('decline', request.id, e.currentTarget.getBoundingClientRect())
                }}
                className="hover:bg-destructive/10 text-destructive touch-manipulation rounded-lg p-1.5 transition-colors"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <section className="border-border/60 border-b p-4 md:border-r md:border-b-0">
          <h4 className="text-muted-foreground mb-2 flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase">
            Source
            {request.source_field && (
              <span className="bg-muted text-foreground rounded px-1.5 py-0.5 font-sans text-[10.5px] tracking-normal normal-case">
                {formatSourceField(request.source_field)}
              </span>
            )}
          </h4>
          {(() => {
            const body = request.original_text || request.source_detail || request.source_fragment
            if (!body) {
              return (
                <div className="text-muted-foreground text-sm italic">No source text captured.</div>
              )
            }
            return (
              <blockquote className="border-forest-400 bg-bark-50 text-bark-800 dark:bg-bark-900/30 dark:text-bark-200 rounded-r-lg border-l-[3px] p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {highlightSourceText(body, request.source_fragment)}
              </blockquote>
            )
          })()}
        </section>
        <section className="p-4">
          <h4 className="text-muted-foreground mb-2 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase">
            Processing Notes (AI Generated)
          </h4>
          <div className="text-foreground text-sm leading-relaxed">
            {request.parse_notes || <span className="text-muted-foreground italic">None.</span>}
          </div>
        </section>
      </div>
      <footer className="bg-muted/40 border-border/60 text-muted-foreground flex items-center gap-3 border-t px-4 py-2 text-xs">
        <span className="font-mono text-[11px]">
          {((request.confidence_score ?? 0) * 100).toFixed(0)}%
        </span>
      </footer>
    </article>
  )
}

export function AllCamperRequestsModal({
  isOpen,
  onClose,
  requesterCmId,
  requesterName,
  year,
  currentRequestId,
}: AllCamperRequestsModalProps) {
  const { user, isLoading: isAuthLoading } = useAuth()
  const queryClient = useQueryClient()
  const headingId = useId()

  const [confirmPopover, setConfirmPopover] = useState<{
    action: 'approve' | 'decline'
    anchorRect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
    requestId: string
  } | null>(null)

  const handleConfirmCancel = useCallback(() => setConfirmPopover(null), [setConfirmPopover])

  // SINGLE CHOKEPOINT for all bunk_requests writes from this modal — including
  // the ConfirmActionPopover approve/decline path, which calls
  // updateRequestMutation.mutate() rather than pb.collection().update() directly.
  // Any new GUI-originated update path in this component MUST go through this
  // mutation so the staff_touched: true stamp is applied uniformly. Issue #1458.
  const updateRequestMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BunkRequestsResponse> }) =>
      pb.collection('bunk_requests').update(id, { ...updates, staff_touched: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.camperRequestSummary(requesterCmId, year),
      })
      invalidateRequestQueries(queryClient)
      toast.success('Request updated')
      setConfirmPopover(null)
    },
    onError: () => {
      toast.error('Failed to update request')
    },
  })

  function handleAction(action: 'approve' | 'decline', requestId: string, anchorRect: DOMRect) {
    setConfirmPopover({ action, anchorRect, requestId })
  }

  function handleRequestUpdate(requestId: string, updates: Partial<BunkRequestsResponse>) {
    updateRequestMutation.mutate({ id: requestId, updates })
  }

  // Staff-review exemption: this fetch intentionally does NOT filter
  // status = "resolved". The modal renders every request with
  // status-colored dots and offers approve/decline actions, functioning
  // as a per-camper staff-review surface.
  const {
    data: requests = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.camperRequestSummary(requesterCmId, year),
    queryFn: async () =>
      pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: `requester_id = ${requesterCmId} && year = ${year} && (merged_into = "" || merged_into = null)`,
        sort: '-is_first_requested,request_type',
      }),
    enabled: isOpen && !isAuthLoading && !!user && requesterCmId > 0,
    staleTime: 30_000,
  })

  const requesteeIds = useMemo(() => {
    const ids = new Set<number>()
    requests.forEach((r) => {
      if (r.requestee_id && r.requestee_id > 0) ids.add(r.requestee_id)
    })
    return Array.from(ids).sort((a, b) => a - b)
  }, [requests])

  const { data: persons = [] } = useQuery({
    queryKey: queryKeys.camperRequestSummaryPersons(requesteeIds, year),
    queryFn: async () => {
      if (requesteeIds.length === 0) return []
      const chunks: number[][] = []
      for (let i = 0; i < requesteeIds.length; i += 50) {
        chunks.push(requesteeIds.slice(i, i + 50))
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          pb.collection<PersonsResponse>('persons').getFullList({
            filter: `(${chunk.map((id) => `cm_id = ${id}`).join(' || ')}) && year = ${year}`,
          })
        )
      )
      return results.flat()
    },
    enabled: isOpen && !isAuthLoading && !!user && requesteeIds.length > 0,
  })

  const personMap = useMemo(() => new Map(persons.map((p) => [p.cm_id, p])), [persons])

  const statusCounts = useMemo(() => {
    const counts = { resolved: 0, pending: 0, declined: 0 }
    for (const r of requests) {
      if (r.status === 'resolved') counts.resolved++
      else if (r.status === 'pending') counts.pending++
      else if (r.status === 'declined') counts.declined++
    }
    return counts
  }, [requests])

  if (!isOpen) return null

  const nonAge = requests.filter((r) => r.request_type !== 'age_preference')
  const agePref = requests.find((r) => r.request_type === 'age_preference')
  const isEmpty = !isLoading && !isError && nonAge.length === 0 && !agePref

  const campMinderUrl = `https://system.campminder.com/ui/person/Record#${requesterCmId}:${year}`
  const totalRequests = requests.length
  const requestsLabel = `${totalRequests} ${totalRequests === 1 ? 'request' : 'requests'}`

  const header = (
    <div
      className="border-border/60 border-b pt-[22px] pb-[18px] pl-7"
      style={{
        backgroundImage:
          'radial-gradient(120% 160% at 0% 0%, color-mix(in oklch, var(--color-forest-50, oklch(97% 0.01 145)) 85%, transparent) 0%, transparent 60%)',
      }}
    >
      <div className="text-forest-700 dark:text-forest-300 flex items-center gap-3 font-mono text-[10.5px] font-medium tracking-[0.16em] uppercase">
        All requests
        <a
          href={campMinderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground tracking-normal normal-case"
          title="Open in CampMinder"
        >
          CampMinder ↗
        </a>
      </div>
      <h2 id={headingId} className="text-foreground mt-1 text-xl font-semibold">
        Requests from{' '}
        <span className="text-forest-700 dark:text-forest-300 font-semibold">{requesterName}</span>
      </h2>
      {totalRequests > 0 && (
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono">{year}</span>
          <span className="text-border">·</span>
          <span>{requestsLabel}</span>
          <span className="text-border">·</span>
          <span>
            <span className="text-bark-800 dark:text-bark-200">{statusCounts.resolved}</span>{' '}
            resolved
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="text-bark-800 dark:text-bark-200">{statusCounts.pending}</span> pending
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="text-bark-800 dark:text-bark-200">{statusCounts.declined}</span>{' '}
            declined
          </span>
        </div>
      )}
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={header}
      size="xl"
      scrollable
      noPadding
      ariaLabelledBy={headingId}
    >
      <div className="px-7 pt-5 pb-6">
        {isLoading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading requests…
          </div>
        )}
        {isError && (
          <div className="text-destructive py-8 text-center">Failed to load requests.</div>
        )}
        {isEmpty && (
          <div className="text-muted-foreground py-12 text-center">
            No other requests from this camper.
          </div>
        )}
        {!isLoading && !isError && (nonAge.length > 0 || agePref) && (
          <div className="space-y-3">
            {nonAge.map((req) => (
              <RequestCard
                key={req.id}
                request={req}
                isCurrent={req.id === currentRequestId}
                onAction={handleAction}
                onUpdate={handleRequestUpdate}
                personMap={personMap}
              />
            ))}
            {agePref && (
              <>
                {nonAge.length > 0 && (
                  <div className="text-muted-foreground my-5 flex items-center gap-3 font-mono text-[10.5px] tracking-[0.18em] uppercase">
                    <span className="border-border/60 flex-1 border-t" />
                    <span>Age preference</span>
                    <span className="border-border/60 flex-1 border-t" />
                  </div>
                )}
                <RequestCard
                  request={agePref}
                  isCurrent={agePref.id === currentRequestId}
                  onAction={handleAction}
                  onUpdate={handleRequestUpdate}
                  personMap={personMap}
                />
              </>
            )}
          </div>
        )}
      </div>
      {confirmPopover && (
        <ConfirmActionPopover
          isOpen
          anchorRect={confirmPopover.anchorRect}
          action={confirmPopover.action}
          onConfirm={() => {
            // Manual decline writes `status: 'declined'` only — `disposition_reason`
            // is intentionally left blank (see DECLINED_REASONS in dispositionColors.ts, #1368).
            updateRequestMutation.mutate({
              id: confirmPopover.requestId,
              updates:
                confirmPopover.action === 'approve'
                  ? { status: 'resolved' }
                  : { status: 'declined' },
            })
          }}
          onCancel={handleConfirmCancel}
        />
      )}
    </Modal>
  )
}

export default AllCamperRequestsModal
