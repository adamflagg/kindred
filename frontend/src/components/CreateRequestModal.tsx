import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Search, Loader2 } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'
import clsx from 'clsx'
import { Modal } from './ui/Modal'
import { invalidateRequestQueries, queryKeys } from '../utils/queryKeys'
import { useSessionCamperPersons } from '../hooks/useSessionCamperPersons'

interface CreateRequestModalProps {
  sessionId: number
  year: number
  onClose: () => void
  /**
   * kindred#2538 tier 2b. The dialog is ALWAYS MOUNTED so ui/Modal's 150ms
   * leave transition has something to fade; the parent drives this flag
   * instead of unmounting on the close frame.
   *
   * Optional and defaulting to TRUE, matching NewScenarioModal: an
   * unconverted call site keeps its old conditional-mount behaviour, so the
   * degradation for a missed site is "no fade" rather than "a modal appears".
   */
  isOpen?: boolean
  /**
   * Per-open nonce from kindred#2541's useRetainedDialog. Bumping it wipes
   * every field, which is what an unmount used to do for free.
   */
  nonce?: number
}

type RequestType = 'bunk_with' | 'not_bunk_with' | 'age_preference'

export default function CreateRequestModal({
  sessionId,
  year,
  onClose,
  isOpen = true,
  nonce,
}: CreateRequestModalProps) {
  const queryClient = useQueryClient()
  const [requestType, setRequestType] = useState<RequestType>('bunk_with')
  const [requesterSearch, setRequesterSearch] = useState('')
  const [targetSearch, setTargetSearch] = useState('')
  const [selectedRequester, setSelectedRequester] = useState<PersonsResponse | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<PersonsResponse | null>(null)
  const [agePreferenceTarget, setAgePreferenceTarget] = useState<'older' | 'younger'>('older')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // kindred#2538's per-open reset, as a RENDER-TIME CORRECTION rather than
  // NewScenarioModal's `key={nonce}` on a split-out form body. The split does
  // not apply here and the reason is structural, not stylistic: this dialog's
  // footer is a `<Modal footer={…}>` PROP, and it reads four of the states
  // below (isSubmitting, campersLoading, selectedRequester, selectedTarget).
  // Modal renders `footer` OUTSIDE the scrollable content area, which is what
  // pins it — so moving these states into a keyed child would force the
  // buttons into `children` and leave them scrolling with the form. Keying the
  // shell instead is the one thing kindred#2541 forbids: it remounts the
  // fading <Modal> and snaps it away mid-leave.
  //
  // The correction is safe precisely where a remount would have been: all
  // eight initializers below are static constants, so re-running them by hand
  // reproduces a fresh mount exactly. NewScenarioModal genuinely needed the
  // remount because its `copyFrom` default is DERIVED from a prop.
  //
  // Render-time, not an effect — React discards this render and re-renders
  // synchronously with the corrected state, so a reopen never paints the
  // abandoned draft for a frame. Same shape as `usePanelParty` and
  // `useRetainedDialog`'s `resetWhen`. Guarded on the nonce having actually
  // changed, or it loops.
  const [lastNonce, setLastNonce] = useState(nonce)
  if (nonce !== lastNonce) {
    setLastNonce(nonce)
    setRequestType('bunk_with')
    setRequesterSearch('')
    setTargetSearch('')
    setSelectedRequester(null)
    setSelectedTarget(null)
    setAgePreferenceTarget('older')
    setNotes('')
    setIsSubmitting(false)
  }

  // Fetch campers for this session.
  //
  // Gated on `isOpen` (kindred#2538): always-mounted, an ungated hook pulls
  // the FULL enrolled-attendee list on every RequestReviewPanel visit whether
  // or not this dialog is ever opened. The hook already accepts `enabled`;
  // `EditableRequestTarget` gates the same query the same way.
  const {
    data: campers = [],
    isLoading: campersLoading,
    isError: campersError,
  } = useSessionCamperPersons(sessionId, year, { enabled: isOpen })

  // Filter campers based on search
  const filteredRequesters = campers.filter((camper) => {
    if (!requesterSearch) return true
    const searchLower = requesterSearch.toLowerCase()
    const fullName = `${camper.first_name} ${camper.last_name}`.toLowerCase()
    return fullName.includes(searchLower)
  })

  const filteredTargets = campers.filter((camper) => {
    if (!targetSearch) return true
    if (selectedRequester && camper.id === selectedRequester.id) return false // Can't request with self
    const searchLower = targetSearch.toLowerCase()
    const fullName = `${camper.first_name} ${camper.last_name}`.toLowerCase()
    return fullName.includes(searchLower)
  })

  // Create request mutation
  const createRequestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRequester) {
        throw new Error('Please select a requester')
      }

      if (requestType !== 'age_preference' && !selectedTarget) {
        throw new Error('Please select a target person')
      }

      const newRequest: Partial<BunkRequestsResponse> = {
        session_id: sessionId,
        year: year,
        requester_id: selectedRequester.cm_id,
        request_type: requestType as BunkRequestsResponse['request_type'],
        status: 'resolved' as BunkRequestsResponse['status'], // Manually created requests go directly to resolved
        confidence_score: 1.0, // Full confidence for manual entries
        source_field: 'manual', // Required field - identifies this as a staff-created request
        original_text: `Manually created ${requestType} request`,
        parse_notes: notes || 'Created through admin interface',
        is_active: true, // Manually created requests are active
      }

      if (requestType === 'age_preference') {
        newRequest.age_preference_target = agePreferenceTarget
        newRequest.metadata = { target: agePreferenceTarget }
      } else {
        if (!selectedTarget) {
          throw new Error('No target selected')
        }
        newRequest.requestee_id = selectedTarget.cm_id
      }

      return pb.collection<BunkRequestsResponse>('bunk_requests').create(newRequest)
    },
    onSuccess: () => {
      invalidateRequestQueries(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionCampers(sessionId, year) })
      toast.success('Request created successfully')
      onClose()
    },
    onError: (error) => {
      console.error('Failed to create request:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create request')
    },
  })

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await createRequestMutation.mutateAsync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const headerContent = (
    <div className="border-border border-b p-6 pr-14">
      <h2 className="font-display text-xl font-bold">Create Request</h2>
    </div>
  )

  const footerContent = (
    <div className="border-border flex items-center justify-end gap-3 border-t p-6">
      <button onClick={onClose} className="btn-ghost">
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={
          isSubmitting ||
          campersLoading ||
          !selectedRequester ||
          (requestType !== 'age_preference' && !selectedTarget)
        }
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Create Request
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="lg"
      noPadding
      scrollable
    >
      <div className="p-6">
        {campersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : campersError ? (
          <div className="text-destructive py-8 text-center text-sm">
            Failed to load campers. Please close and try again.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Request Type */}
            <div>
              <label htmlFor="create-request-type" className="mb-2 block text-sm font-semibold">
                Request Type
              </label>
              <select
                id="create-request-type"
                value={requestType}
                onChange={(e) => {
                  setRequestType(e.target.value as RequestType)
                  setSelectedTarget(null)
                }}
                className="input-lodge"
              >
                <option value="bunk_with">Bunk With</option>
                <option value="not_bunk_with">Not Bunk With</option>
                <option value="age_preference">Age Preference</option>
              </select>
            </div>

            {/* Requester */}
            <div>
              <label
                htmlFor="create-request-requester"
                className="mb-2 block text-sm font-semibold"
              >
                Requester
              </label>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 transform" />
                <input
                  id="create-request-requester"
                  type="text"
                  placeholder="Search for requester..."
                  value={requesterSearch}
                  onChange={(e) => setRequesterSearch(e.target.value)}
                  className="input-lodge pl-11"
                />
              </div>
              {requesterSearch && (
                <div className="border-border bg-card shadow-lodge mt-2 max-h-40 overflow-y-auto rounded-xl border">
                  {filteredRequesters.length === 0 ? (
                    <div className="text-muted-foreground p-3 text-sm">No campers found</div>
                  ) : (
                    filteredRequesters.slice(0, 10).map((camper) => (
                      <button
                        key={camper.id}
                        onClick={() => {
                          setSelectedRequester(camper)
                          setRequesterSearch(`${camper.first_name} ${camper.last_name}`)
                        }}
                        className={clsx(
                          'hover:bg-muted/50 w-full px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-xl last:rounded-b-xl',
                          selectedRequester?.id === camper.id && 'bg-primary/10 text-primary'
                        )}
                      >
                        {camper.first_name} {camper.last_name}
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedRequester && (
                <div className="text-muted-foreground mt-2 text-sm">
                  Selected: {selectedRequester.first_name} {selectedRequester.last_name}
                </div>
              )}
            </div>

            {/* Target (for non-age preference) */}
            {requestType !== 'age_preference' && (
              <div>
                <label htmlFor="create-request-target" className="mb-2 block text-sm font-semibold">
                  Target Person
                </label>
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 transform" />
                  <input
                    id="create-request-target"
                    type="text"
                    placeholder="Search for target person..."
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    className="input-lodge pl-11"
                  />
                </div>
                {targetSearch && (
                  <div className="border-border bg-card shadow-lodge mt-2 max-h-40 overflow-y-auto rounded-xl border">
                    {filteredTargets.length === 0 ? (
                      <div className="text-muted-foreground p-3 text-sm">No campers found</div>
                    ) : (
                      filteredTargets.slice(0, 10).map((camper) => (
                        <button
                          key={camper.id}
                          onClick={() => {
                            setSelectedTarget(camper)
                            setTargetSearch(`${camper.first_name} ${camper.last_name}`)
                          }}
                          className={clsx(
                            'hover:bg-muted/50 w-full px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-xl last:rounded-b-xl',
                            selectedTarget?.id === camper.id && 'bg-primary/10 text-primary'
                          )}
                        >
                          {camper.first_name} {camper.last_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {selectedTarget && (
                  <div className="text-muted-foreground mt-2 text-sm">
                    Selected: {selectedTarget.first_name} {selectedTarget.last_name}
                  </div>
                )}
              </div>
            )}

            {/* Age Preference Target */}
            {requestType === 'age_preference' && (
              <div>
                <label
                  htmlFor="create-request-age-preference"
                  className="mb-2 block text-sm font-semibold"
                >
                  Age Preference
                </label>
                <select
                  id="create-request-age-preference"
                  value={agePreferenceTarget}
                  onChange={(e) => setAgePreferenceTarget(e.target.value as 'older' | 'younger')}
                  className="input-lodge"
                >
                  <option value="older">Older (same grade + one above)</option>
                  <option value="younger">Younger (same grade + one below)</option>
                </select>
              </div>
            )}

            {/* Notes */}
            <div>
              <label htmlFor="create-request-notes" className="mb-2 block text-sm font-semibold">
                Notes (Optional)
              </label>
              <textarea
                id="create-request-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes about this request..."
                className="input-lodge min-h-[80px] resize-none"
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
