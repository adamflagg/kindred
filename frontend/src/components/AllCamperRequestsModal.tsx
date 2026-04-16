import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import Modal from './ui/Modal'
import CamperLink from './CamperLink'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys } from '../utils/queryKeys'
import { formatSourceField } from '../utils/formatSourceField'
import { formatReason, MUTUAL_BADGE_CLASSES } from '../utils/dispositionColors'
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
  targetName,
  isCurrent = false,
}: {
  request: BunkRequestsResponse
  targetName: string | null
  isCurrent?: boolean
}) {
  const isBunk = request.request_type === 'bunk_with'
  const isNot = request.request_type === 'not_bunk_with'
  const isAge = request.request_type === 'age_preference'

  const typeLabel = isBunk ? 'Bunk with' : isNot ? 'Not with' : 'Age preference'
  const typeChipClass = isBunk
    ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-300'
    : isNot
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'

  const hasResolvedTarget = !!(request.requestee_id && request.requestee_id > 0 && targetName)

  return (
    <article
      className={`border-border bg-card overflow-hidden rounded-xl border ${isCurrent ? 'ring-forest-500 dark:ring-forest-400 ring-2' : ''}`}
    >
      <header className="border-border/60 from-forest-50/50 dark:from-forest-900/10 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b bg-gradient-to-b to-transparent px-4 py-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${typeChipClass}`}
        >
          {typeLabel}
        </span>
        <span className="font-display text-foreground flex items-center gap-2 text-base font-semibold tracking-tight">
          <span className="text-muted-foreground">→</span>
          {isAge ? (
            <strong>{request.age_preference_target || 'Age preference'}</strong>
          ) : hasResolvedTarget ? (
            <CamperLink
              personCmId={request.requestee_id}
              displayName={targetName}
              isConfirmed={true}
            />
          ) : (
            <span className="text-muted-foreground italic">
              {request.requested_person_name || 'Unresolved'}
            </span>
          )}
          {request.is_reciprocal && <span className={MUTUAL_BADGE_CLASSES}>mutual</span>}
          {isCurrent && (
            <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
              Viewing
            </span>
          )}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(request.status)}`}
        >
          {request.status}
          {request.disposition_reason ? ` · ${formatReason(request.disposition_reason)}` : ''}
        </span>
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
          {request.source_fragment || request.source_detail || request.original_text ? (
            <blockquote className="border-forest-400 bg-muted/50 text-bark-800 dark:text-bark-200 rounded-r-lg border-l-4 p-3 text-sm leading-relaxed">
              {request.source_fragment || request.source_detail || request.original_text}
            </blockquote>
          ) : (
            <div className="text-muted-foreground text-sm italic">No source text captured.</div>
          )}
        </section>
        <section className="p-4">
          <h4 className="text-muted-foreground mb-2 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase">
            Processing Notes
          </h4>
          <div className="text-foreground text-sm leading-relaxed">
            {request.parse_notes || <span className="text-muted-foreground italic">None.</span>}
          </div>
        </section>
      </div>
      <footer className="bg-muted/40 border-border/60 text-muted-foreground flex items-center gap-3 border-t px-4 py-2 text-xs">
        <span className="bg-muted text-foreground rounded px-2 py-0.5 font-mono text-[10.5px]">
          Priority {request.priority}
        </span>
        <span>·</span>
        <span className="font-mono text-[11px]">
          {((request.confidence_score ?? 0) * 100).toFixed(0)}%
        </span>
        {request.csv_position != null && (
          <>
            <span>·</span>
            <span className="font-mono text-[11px]">csv_position {request.csv_position}</span>
          </>
        )}
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
  const { user } = useAuth()

  const {
    data: requests = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.camperRequestSummary(requesterCmId, year),
    queryFn: async () =>
      pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: `requester_id = ${requesterCmId} && year = ${year} && (merged_into = "" || merged_into = null)`,
        sort: '-priority,request_type',
      }),
    enabled: isOpen && !!user && requesterCmId > 0,
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
    enabled: isOpen && !!user && requesteeIds.length > 0,
  })

  const personMap = useMemo(() => new Map(persons.map((p) => [p.cm_id, p])), [persons])

  if (!isOpen) return null

  const nonAge = requests.filter((r) => r.request_type !== 'age_preference')
  const agePref = requests.find((r) => r.request_type === 'age_preference')
  const isEmpty = !isLoading && !isError && nonAge.length === 0 && !agePref

  const campMinderUrl = `https://system.campminder.com/ui/person/Record#${requesterCmId}:${year}`

  const header = (
    <div>
      <div className="text-forest-600 flex items-center gap-3 font-mono text-[10.5px] font-medium tracking-[0.16em] uppercase">
        All requests · read-only
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
      <h2 className="font-display text-foreground mt-1 text-2xl font-semibold tracking-tight">
        Requests from <em className="text-forest-600 not-italic">{requesterName}</em>
      </h2>
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} header={header} size="xl" scrollable noPadding>
      <div className="p-6">
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
            {nonAge.map((req) => {
              const target =
                req.requestee_id && req.requestee_id > 0
                  ? (personMap.get(req.requestee_id) ?? null)
                  : null
              const targetName = target
                ? `${target.first_name} ${target.last_name}`
                : (req.requested_person_name ?? null)
              return (
                <RequestCard
                  key={req.id}
                  request={req}
                  targetName={targetName}
                  isCurrent={req.id === currentRequestId}
                />
              )
            })}
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
                  targetName={null}
                  isCurrent={agePref.id === currentRequestId}
                />
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default AllCamperRequestsModal
