import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, GitMerge, AlertCircle, User, HelpCircle } from 'lucide-react'
import { formatSourceField } from '../utils/formatSourceField'
import { Modal } from './ui/Modal'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types'
import { pb } from '../lib/pocketbase'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { invalidateRequestQueries } from '../utils/queryKeys'

interface MergeRequestsModalProps {
  isOpen: boolean
  onClose: () => void
  requests: BunkRequestsResponse[]
  onMergeComplete: () => void
  /**
   * Per-open nonce from kindred#2541's useRetainedDialog (kindred#2538).
   *
   * Load-bearing for CORRECTNESS here, not just for tidiness. Always-mounted,
   * `selectedTargetId` and `finalType` below are `useState(requests[0]…)`
   * initializers that run ONCE at mount and never re-derive -- so a second
   * open on a different pair would keep the first pair's target and Merge
   * would POST a `keep_target_from` that is no longer on screen.
   */
  nonce?: number
  /** Modal's afterLeave, so the parent can release its retained snapshot. */
  afterLeave?: () => void
}

interface MergeResponse {
  merged_request_id: string
  merged_request_ids: string[]
  source_fields: string[]
  confidence_score: number
}

export default function MergeRequestsModal({
  isOpen,
  nonce,
  onClose,
  afterLeave,
  ...body
}: MergeRequestsModalProps) {
  // Thin shell owning the chrome; every useState lives in the body below,
  // keyed by the nonce so each open remounts it fresh. The key goes on the
  // CONTENT and never on <Modal> -- remounting the chrome mid-leave would snap
  // the fading dialog away instead of fading it (kindred#2541).
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      // Spread rather than passed straight through: tsconfig sets
      // exactOptionalPropertyTypes, so an explicit `undefined` is not
      // assignable to Modal's `afterLeave?: () => void`.
      {...(afterLeave !== undefined && { afterLeave })}
      title="Merge Requests"
      size="lg"
    >
      <MergeRequestsForm key={nonce} isOpen={isOpen} onClose={onClose} {...body} />
    </Modal>
  )
}

type MergeRequestsFormProps = Omit<MergeRequestsModalProps, 'nonce' | 'afterLeave'>

function MergeRequestsForm({ isOpen, onClose, requests, onMergeComplete }: MergeRequestsFormProps) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const [selectedTargetId, setSelectedTargetId] = useState<string>(requests[0]?.id ?? '')
  const [finalType, setFinalType] = useState<BunkRequestsRequestTypeOptions>(
    requests[0]?.request_type ?? BunkRequestsRequestTypeOptions.bunk_with
  )
  const [error, setError] = useState<string | null>(null)

  // Compute combined source fields preview
  const combinedSourceFields = [...new Set(requests.map((r) => r.source_field).filter(Boolean))]

  // Get unique requestee IDs that are positive (resolved) for person lookup
  const requesteeIds = useMemo(() => {
    return [
      ...new Set(
        requests
          .map((r) => r.requestee_id)
          .filter((id): id is number => typeof id === 'number' && id > 0)
      ),
    ]
  }, [requests])

  // Fetch person data for resolved targets
  const { data: persons = [] } = useQuery({
    queryKey: ['persons-for-merge', requesteeIds, requests[0]?.year],
    queryFn: async () => {
      if (requesteeIds.length === 0) return []
      const year = requests[0]?.year
      if (!year) return []

      const filter = `(${requesteeIds.map((id) => `cm_id = ${id}`).join(' || ')}) && year = ${year}`
      return pb.collection<PersonsResponse>('persons').getFullList({ filter })
    },
    // Gated on `isOpen` too (kindred#2538), as defence in depth rather than
    // as the primary guard. The primary guard is structural: <Modal
    // isOpen={false}> renders no children, so this body is not mounted while
    // the dialog is closed and the query cannot run. What `isOpen` adds is the
    // EXIT-FADE window -- the body stays mounted for the leave with isOpen
    // already false, and this stops a `requests` change landing in that window
    // from starting a lookup for a dialog on its way out.
    enabled: isOpen && requesteeIds.length > 0,
  })

  const personMap = useMemo(() => {
    return new Map(persons.map((p) => [p.cm_id, p]))
  }, [persons])

  // Helper to render target display
  const renderTarget = (request: BunkRequestsResponse) => {
    const requesteeId = request.requestee_id
    const requestedName = request.requested_person_name

    // Resolved: positive ID with person lookup
    if (requesteeId && requesteeId > 0) {
      const person = personMap.get(requesteeId)
      if (person) {
        return (
          <span className="flex items-center gap-1.5">
            <User className="text-forest-600 dark:text-forest-400 h-3.5 w-3.5" />
            <span className="text-forest-700 dark:text-forest-300 font-medium">
              {person.first_name} {person.last_name}
            </span>
          </span>
        )
      }
      // Person not found in lookup, show ID
      return (
        <span className="text-muted-foreground flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" />
          Person #{requesteeId}
        </span>
      )
    }

    // Placeholder: negative ID (AI-generated placeholder)
    if (requesteeId && requesteeId < 0) {
      return (
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-700 italic dark:text-amber-300">
            {requestedName || 'Unknown'}{' '}
            <span className="text-muted-foreground text-xs">(unresolved)</span>
          </span>
        </span>
      )
    }

    // Unresolved: no ID, just the parsed name
    if (requestedName) {
      return (
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-700 italic dark:text-amber-300">
            {requestedName} <span className="text-muted-foreground text-xs">(unresolved)</span>
          </span>
        </span>
      )
    }

    // No target at all
    return <span className="text-muted-foreground italic">No target</span>
  }

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth('/api/requests/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_ids: requests.map((r) => r.id),
          keep_target_from: selectedTargetId,
          final_type: finalType,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail ?? 'Merge failed')
      }

      return response.json() as Promise<MergeResponse>
    },
    onSuccess: () => {
      // Merge rewrites source linkages between rows — invalidate aux keys too.
      invalidateRequestQueries(queryClient, { includeSourceLinks: true })
      onMergeComplete()
      onClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleMerge = () => {
    setError(null)
    mergeMutation.mutate()
  }

  // The old `if (!isOpen) return null` was DEAD code — RequestReviewPanel
  // gates this component's mount, so when mounted, isOpen is always true.
  // Deleted (spec 1c tier 1) because it would silently defeat kindred#2529's
  // parent conversion: a parent that keeps this mounted to let the exit
  // fade play would find the guard unmounting Modal anyway.

  return (
    <>
      <div className="space-y-6">
        {/* Error display */}
        {error && (
          <div className="bg-destructive/10 border-destructive/20 text-destructive flex items-center gap-2 rounded-lg border p-3">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Error: {error}</span>
          </div>
        )}

        {/* Side-by-side comparison */}
        <div>
          <h3 className="mb-3 text-sm font-medium">Select which request's target to keep:</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {requests.map((request, index) => (
              <label
                key={request.id}
                className={`relative cursor-pointer rounded-lg border p-4 transition-colors ${
                  selectedTargetId === request.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {/* KEPT (kindred#2379): a real native radio, not AT
                    scaffolding — `sr-only` hides its default browser
                    rendering while the card `<label>` stays the visible,
                    clickable control. Deleting the class puts a raw radio
                    button next to the card. */}
                <input
                  type="radio"
                  name="targetRequest"
                  value={request.id}
                  checked={selectedTargetId === request.id}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  className="sr-only"
                />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-semibold">
                      Request {index + 1}
                    </span>
                    {selectedTargetId === request.id && (
                      <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs">
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Target:</span> {renderTarget(request)}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Type:</span>{' '}
                    <span className="text-muted-foreground">
                      {request.request_type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Source:</span>{' '}
                    <span className="text-muted-foreground">
                      {formatSourceField(request.source_field)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Confidence:</span>{' '}
                    <span className="text-muted-foreground">
                      {(request.confidence_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {request.original_text && (
                    <div className="text-sm">
                      <span className="font-medium">Original:</span>{' '}
                      <span className="text-muted-foreground text-xs italic">
                        "{request.original_text}"
                      </span>
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Final type selection */}
        <div>
          <label htmlFor="final-type" className="mb-2 block text-sm font-medium">
            Final Request Type:
          </label>
          <select
            id="final-type"
            aria-label="Final request type"
            value={finalType}
            onChange={(e) => setFinalType(e.target.value as BunkRequestsRequestTypeOptions)}
            className="border-border bg-background w-full rounded-lg border px-3 py-2"
          >
            <option value={BunkRequestsRequestTypeOptions.bunk_with}>Bunk With</option>
            <option value={BunkRequestsRequestTypeOptions.not_bunk_with}>Not Bunk With</option>
            <option value={BunkRequestsRequestTypeOptions.age_preference}>Age Preference</option>
          </select>
        </div>

        {/* Combined source fields preview */}
        <div>
          <h3 className="mb-2 text-sm font-medium">Combined Source Fields:</h3>
          <div className="bg-muted/50 rounded-lg p-3">
            {combinedSourceFields.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {combinedSourceFields.map((field) => (
                  <span
                    key={field}
                    className="bg-primary/10 text-primary rounded px-2 py-1 text-xs"
                  >
                    {field}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">No source fields</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="border-border flex justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="border-border hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={mergeMutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {mergeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="h-4 w-4" />
                Merge Requests
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
