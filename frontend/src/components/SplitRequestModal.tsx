import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Scissors, AlertCircle, User, HelpCircle, Star } from 'lucide-react'
import { Modal } from './ui/Modal'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types'
import { pb } from '../lib/pocketbase'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { invalidateRequestQueries } from '../utils/queryKeys'

interface SourceLinkData {
  original_request_id: string
  source_field: string
  original_content?: string | undefined
  created?: string | undefined
  parse_notes?: string | undefined
  is_primary?: boolean | undefined
  // Additional fields for absorbed request display
  requested_person_name?: string | undefined
  requestee_id?: number | undefined
}

interface SplitRequestModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * NOT nullable, and kindred#2538's ⛔ section is why it must stay that way.
   *
   * That section refutes widening this to `BunkRequestsResponse | null` plus
   * an `if (!request) return null` guard: the effect dep array below
   * dereferences `request.request_type` at RENDER time, before any guard line
   * runs, and hoisting the guard above the hooks makes the hook count
   * conditional ("Rendered more hooks than during the previous render").
   *
   * The conversion sidesteps the whole problem instead of solving it. The
   * parent gates on `useRetainedDialog`'s retained SNAPSHOT
   * (`splitDialog.data !== null`), which is non-null for as long as the dialog
   * is mounted -- including throughout the exit fade. So this prop is never
   * null while mounted and none of those dereferences need guarding. Do not
   * "fix" this by making it nullable.
   */
  request: BunkRequestsResponse
  sourceLinks: SourceLinkData[]
  isLoadingSourceLinks?: boolean
  onSplitComplete: () => void
  /**
   * Per-open nonce from kindred#2541's useRetainedDialog (kindred#2538). The
   * remount is what clears a failed split's error banner, which would
   * otherwise greet the next open.
   */
  nonce?: number
  /** Modal's afterLeave, so the parent can release its retained snapshot. */
  afterLeave?: () => void
}

interface SplitSourceConfig {
  original_request_id: string
  new_type: BunkRequestsRequestTypeOptions
  new_target_id: number | null
}

interface SplitResponse {
  original_request_id: string
  restored_request_ids: string[]
  updated_source_fields: string[]
}

export default function SplitRequestModal({
  isOpen,
  nonce,
  onClose,
  afterLeave,
  ...body
}: SplitRequestModalProps) {
  // Thin shell owning the chrome; the state lives in the body, keyed by the
  // nonce so every open remounts it fresh. The key goes on the CONTENT and
  // never on <Modal> — remounting the chrome mid-leave would snap the fading
  // dialog away instead of fading it (kindred#2541).
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      // Spread: tsconfig sets exactOptionalPropertyTypes, so an explicit
      // `undefined` is not assignable to Modal's `afterLeave?: () => void`.
      {...(afterLeave !== undefined && { afterLeave })}
      title="Split Request"
      size="lg"
    >
      <SplitRequestForm key={nonce} isOpen={isOpen} onClose={onClose} {...body} />
    </Modal>
  )
}

type SplitRequestFormProps = Omit<SplitRequestModalProps, 'nonce' | 'afterLeave'>

function SplitRequestForm({
  isOpen,
  onClose,
  request,
  sourceLinks,
  isLoadingSourceLinks = false,
  onSplitComplete,
}: SplitRequestFormProps) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [sourceTypes, setSourceTypes] = useState<Record<string, BunkRequestsRequestTypeOptions>>({})
  const [error, setError] = useState<string | null>(null)
  const prevIsOpenRef = useRef(false)

  // Auto-select all non-primary sources when modal opens
  // This is a valid "reset state when modal opens" pattern
  useEffect(() => {
    // Only initialize when modal transitions from closed to open
    const wasOpen = prevIsOpenRef.current
    prevIsOpenRef.current = isOpen

    if (isOpen && !wasOpen && sourceLinks.length > 0) {
      const nonPrimarySources = sourceLinks
        .filter((link) => !link.is_primary)
        .map((link) => link.original_request_id)

      setSelectedSources(new Set(nonPrimarySources))

      const defaultTypes: Record<string, BunkRequestsRequestTypeOptions> = {}
      nonPrimarySources.forEach((id) => {
        defaultTypes[id] = request.request_type
      })
      setSourceTypes(defaultTypes)
    }
  }, [isOpen, sourceLinks, request.request_type])

  // Get current source fields from request
  // source_fields may be an array if the request was merged
  const currentSourceFields = (request as unknown as { source_fields?: string[] })
    .source_fields ?? [request.source_field]

  // Fetch person data for resolved target
  const requesteeId = request.requestee_id
  const { data: targetPerson } = useQuery({
    queryKey: ['person-for-split', requesteeId, request.year],
    queryFn: async () => {
      if (!requesteeId || requesteeId <= 0) return null
      const year = request.year
      if (!year) return null

      const filter = `cm_id = ${requesteeId} && year = ${year}`
      const results = await pb.collection<PersonsResponse>('persons').getFullList({ filter })
      return results[0] ?? null
    },
    enabled: !!requesteeId && requesteeId > 0,
  })

  // Helper to render target display
  const renderTarget = () => {
    const requestedName = request.requested_person_name

    // Resolved: positive ID with person lookup
    if (requesteeId && requesteeId > 0) {
      if (targetPerson) {
        return (
          <span className="flex items-center gap-1.5">
            <User className="text-forest-600 dark:text-forest-400 h-3.5 w-3.5" />
            <span className="text-forest-700 dark:text-forest-300 font-medium">
              {targetPerson.first_name} {targetPerson.last_name}
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

  // Toggle source selection
  const toggleSource = (originalRequestId: string) => {
    const newSelected = new Set(selectedSources)
    if (newSelected.has(originalRequestId)) {
      newSelected.delete(originalRequestId)
    } else {
      newSelected.add(originalRequestId)
      // Set default type to the parent request's type (not hardcoded bunk_with)
      if (!sourceTypes[originalRequestId]) {
        setSourceTypes((prev) => ({
          ...prev,
          [originalRequestId]: request.request_type,
        }))
      }
    }
    setSelectedSources(newSelected)
  }

  // Update type for a selected source
  const updateSourceType = (originalRequestId: string, type: BunkRequestsRequestTypeOptions) => {
    setSourceTypes((prev) => ({
      ...prev,
      [originalRequestId]: type,
    }))
  }

  // Split mutation
  const splitMutation = useMutation({
    mutationFn: async () => {
      const splitSources: SplitSourceConfig[] = Array.from(selectedSources).map((origId) => ({
        original_request_id: origId,
        new_type: sourceTypes[origId] ?? BunkRequestsRequestTypeOptions.bunk_with,
        new_target_id: null,
      }))

      const response = await fetchWithAuth('/api/requests/split', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_id: request.id,
          split_sources: splitSources,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail ?? 'Split failed')
      }

      return response.json() as Promise<SplitResponse>
    },
    onSuccess: () => {
      // Split rewrites source linkages between rows — invalidate aux keys too.
      invalidateRequestQueries(queryClient, { includeSourceLinks: true })
      onSplitComplete()
      onClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleSplit = () => {
    setError(null)
    splitMutation.mutate()
  }

  const canSplit = selectedSources.size > 0 && !splitMutation.isPending

  // The old `if (!isOpen) return null` was DEAD code — RequestReviewPanel
  // gates this component's mount, so when mounted, isOpen is always true.
  // Deleted (spec 1c tier 1); see MergeRequestsModal for why keeping it
  // would defeat kindred#2529's parent conversion.

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

        {/* Current request info */}
        <div className="bg-muted/30 rounded-lg p-4">
          <h3 className="mb-2 text-sm font-medium">Current Request</h3>
          <div className="mb-1 text-sm">
            <span className="text-foreground font-medium">Target:</span> {renderTarget()}
          </div>
          <div className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Type:</span>{' '}
            {request.request_type.replace('_', ' ')}
          </div>
          <div className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Source Fields:</span>{' '}
            {Array.isArray(currentSourceFields)
              ? currentSourceFields.join(', ')
              : currentSourceFields}
          </div>
          {request.original_text && (
            <div className="text-muted-foreground mt-1 text-sm">
              <span className="text-foreground font-medium">Original:</span>{' '}
              <span className="text-xs italic">"{request.original_text}"</span>
            </div>
          )}
        </div>

        {/* Source selection */}
        <div>
          <h3 className="mb-3 text-sm font-medium">Select sources to split off:</h3>
          <div className="space-y-3">
            {sourceLinks.map((link) => {
              const isSelected = selectedSources.has(link.original_request_id)
              const isPrimary = link.is_primary === true
              return (
                <div
                  key={link.original_request_id}
                  className={`rounded-lg border p-4 transition-colors ${
                    isPrimary
                      ? 'border-border bg-muted/20 opacity-60'
                      : isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`source-${link.original_request_id}`}
                      checked={isSelected}
                      onChange={() => toggleSource(link.original_request_id)}
                      disabled={isPrimary}
                      className={`mt-1 rounded ${isPrimary ? 'cursor-not-allowed' : ''}`}
                    />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`source-${link.original_request_id}`}
                          className={`text-sm font-medium ${isPrimary ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {link.requested_person_name ? (
                            <span className="flex items-center gap-1.5">
                              <User className="text-forest-600 dark:text-forest-400 h-3.5 w-3.5" />
                              {link.requested_person_name}
                              <span className="text-muted-foreground text-xs">
                                ({link.source_field})
                              </span>
                            </span>
                          ) : (
                            link.source_field
                          )}
                        </label>
                        {isPrimary && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                            <Star className="h-3 w-3" />
                            Primary (cannot split)
                          </span>
                        )}
                      </div>
                      {link.original_content && (
                        <p className="text-muted-foreground mt-1 text-sm italic">
                          &quot;{link.original_content}&quot;
                        </p>
                      )}
                      {link.parse_notes && (
                        <p className="text-muted-foreground bg-muted/50 mt-1 rounded px-2 py-1 text-xs">
                          <span className="font-medium">AI Notes:</span> {link.parse_notes}
                        </p>
                      )}
                      {link.created && (
                        <span className="text-muted-foreground mt-1 block text-xs">
                          Added: {new Date(link.created).toLocaleDateString()}
                        </span>
                      )}

                      {/* Type selection - shown when source is selected */}
                      {isSelected && (
                        <div className="mt-3">
                          <label
                            htmlFor={`type-${link.original_request_id}`}
                            className="mb-1 block text-xs font-medium"
                          >
                            New Request Type:
                          </label>
                          <select
                            id={`type-${link.original_request_id}`}
                            aria-label="New request type"
                            value={sourceTypes[link.original_request_id] ?? request.request_type}
                            onChange={(e) =>
                              updateSourceType(
                                link.original_request_id,
                                e.target.value as BunkRequestsRequestTypeOptions
                              )
                            }
                            className="border-border bg-background w-full rounded-lg border px-3 py-2 text-sm"
                          >
                            <option value={BunkRequestsRequestTypeOptions.bunk_with}>
                              Bunk With
                            </option>
                            <option value={BunkRequestsRequestTypeOptions.not_bunk_with}>
                              Not Bunk With
                            </option>
                            <option value={BunkRequestsRequestTypeOptions.age_preference}>
                              Age Preference
                            </option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {isLoadingSourceLinks && (
            <div className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading source links...</span>
            </div>
          )}

          {!isLoadingSourceLinks && sourceLinks.length === 0 && (
            <p className="text-muted-foreground text-sm">No sources available to split.</p>
          )}
        </div>

        {/* Preview */}
        {selectedSources.size > 0 && (
          <div className="bg-muted/30 rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium">Split Preview</h3>
            <p className="text-muted-foreground text-sm">
              {selectedSources.size} source(s) will be restored to their original requests.
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Remaining sources:{' '}
              {sourceLinks
                .filter((l) => !selectedSources.has(l.original_request_id))
                .map((l) => l.source_field)
                .join(', ') || 'None'}
            </p>
          </div>
        )}

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
            onClick={handleSplit}
            disabled={!canSplit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {splitMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Splitting...
              </>
            ) : (
              <>
                <Scissors className="h-4 w-4" />
                Split Request
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
