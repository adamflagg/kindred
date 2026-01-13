import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Search, Loader2 } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import type { BunkRequestsResponse, PersonsResponse, AttendeesResponse } from '../types/pocketbase-types';
import clsx from 'clsx';
import { Modal } from './ui/Modal';

interface CreateRequestModalProps {
  sessionId: number;
  year: number;
  onClose: () => void;
}


type RequestType = 'bunk_with' | 'not_bunk_with' | 'age_preference';

export default function CreateRequestModal({ sessionId, year, onClose }: CreateRequestModalProps) {
  const queryClient = useQueryClient();
  const [requestType, setRequestType] = useState<RequestType>('bunk_with');
  const [requesterSearch, setRequesterSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [selectedRequester, setSelectedRequester] = useState<PersonsResponse | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<PersonsResponse | null>(null);
  const [agePreferenceTarget, setAgePreferenceTarget] = useState<'older' | 'younger'>('older');
  const [priority, setPriority] = useState(4);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch campers for this session
  const { data: campers = [], isLoading: campersLoading } = useQuery({
    queryKey: ['session-campers', sessionId, year],
    queryFn: async () => {
      // Fetch attendees for this session
      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter: `session = ${sessionId} && year = ${year} && status = "enrolled"`
      });
      
      // Get person IDs
      const personIds = attendees.map(a => a.person_id);
      if (personIds.length === 0) return [];
      
      // Fetch persons in batches to avoid 414 Request Too Large errors
      const BATCH_SIZE = 50;
      const batches: Array<Promise<PersonsResponse[]>> = [];
      
      // Split personIds into batches and create promises
      for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
        const batch = personIds.slice(i, i + BATCH_SIZE);
        const batchFilter = batch.map(id => `cm_id = ${id}`).join(' || ');
        
        const batchPromise = pb.collection<PersonsResponse>('persons').getFullList({
          filter: batchFilter
        }).catch(error => {
          console.error(`Error fetching person batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
          return []; // Return empty array for failed batches
        });
        
        batches.push(batchPromise);
      }
      
      // Fetch all batches in parallel
      const batchResults = await Promise.all(batches);
      const persons = batchResults.flat();
      
      // Create a map for quick lookup
      const personsMap = new Map<number, PersonsResponse>();
      persons.forEach(p => {
        personsMap.set(p.cm_id, p);
      });

      // Filter to only include persons that have attendees in this session
      return personIds
        .map(id => personsMap.get(id))
        .filter((p): p is PersonsResponse => p !== undefined);
    }
  });

  // Filter campers based on search
  const filteredRequesters = campers.filter(camper => {
    if (!requesterSearch) return true;
    const searchLower = requesterSearch.toLowerCase();
    const fullName = `${camper.first_name} ${camper.last_name}`.toLowerCase();
    return fullName.includes(searchLower);
  });

  const filteredTargets = campers.filter(camper => {
    if (!targetSearch) return true;
    if (selectedRequester && camper.id === selectedRequester.id) return false; // Can't request with self
    const searchLower = targetSearch.toLowerCase();
    const fullName = `${camper.first_name} ${camper.last_name}`.toLowerCase();
    return fullName.includes(searchLower);
  });

  // Create request mutation
  const createRequestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRequester) {
        throw new Error('Please select a requester');
      }

      if (requestType !== 'age_preference' && !selectedTarget) {
        throw new Error('Please select a target person');
      }

      const newRequest: Partial<BunkRequestsResponse> = {
        session_id: sessionId,
        year: year,
        requester_id: selectedRequester.cm_id,
        request_type: requestType as BunkRequestsResponse['request_type'],
        priority: priority,
        status: 'resolved' as BunkRequestsResponse['status'], // Manually created requests go directly to resolved
        confidence_score: 1.0, // Full confidence for manual entries
        source: 'staff' as BunkRequestsResponse['source'],
        original_text: `Manually created ${requestType} request`,
        parse_notes: notes || 'Created through admin interface',
        request_locked: true // Auto-lock manual requests
      };

      if (requestType === 'age_preference') {
        newRequest.age_preference_target = agePreferenceTarget;
        newRequest.metadata = { target: agePreferenceTarget };
      } else {
        if (!selectedTarget) {
          throw new Error('No target selected');
        }
        newRequest.requestee_id = selectedTarget.cm_id;
      }

      return pb.collection<BunkRequestsResponse>('bunk_requests').create(newRequest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
      toast.success('Request created successfully');
      onClose();
    },
    onError: (error) => {
      console.error('Failed to create request:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create request');
    }
  });

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await createRequestMutation.mutateAsync();
    } finally {
      setIsSubmitting(false);
    }
  };

  const headerContent = (
    <div className="p-6 pr-14 border-b border-border">
      <h2 className="text-xl font-display font-bold">Create Request</h2>
    </div>
  );

  const footerContent = (
    <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
      <button
        onClick={onClose}
        className="btn-ghost"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || campersLoading || !selectedRequester || (requestType !== 'age_preference' && !selectedTarget)}
        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Create Request
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={true}
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
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Request Type */}
            <div>
              <label className="block text-sm font-semibold mb-2">Request Type</label>
              <select
                value={requestType}
                onChange={(e) => {
                  setRequestType(e.target.value as RequestType);
                  setSelectedTarget(null);
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
              <label className="block text-sm font-semibold mb-2">Requester</label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search for requester..."
                  value={requesterSearch}
                  onChange={(e) => setRequesterSearch(e.target.value)}
                  className="input-lodge pl-11"
                />
              </div>
              {requesterSearch && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-border rounded-xl bg-card shadow-lodge">
                  {filteredRequesters.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No campers found</div>
                  ) : (
                    filteredRequesters.slice(0, 10).map(camper => (
                      <button
                        key={camper.id}
                        onClick={() => {
                          setSelectedRequester(camper);
                          setRequesterSearch(`${camper.first_name} ${camper.last_name}`);
                        }}
                        className={clsx(
                          "w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors text-sm first:rounded-t-xl last:rounded-b-xl",
                          selectedRequester?.id === camper.id && "bg-primary/10 text-primary"
                        )}
                      >
                        {camper.first_name} {camper.last_name}
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedRequester && (
                <div className="mt-2 text-sm text-muted-foreground">
                  Selected: {selectedRequester.first_name} {selectedRequester.last_name}
                </div>
              )}
            </div>

            {/* Target (for non-age preference) */}
            {requestType !== 'age_preference' && (
              <div>
                <label className="block text-sm font-semibold mb-2">Target Person</label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search for target person..."
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    className="input-lodge pl-11"
                  />
                </div>
                {targetSearch && (
                  <div className="mt-2 max-h-40 overflow-y-auto border border-border rounded-xl bg-card shadow-lodge">
                    {filteredTargets.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">No campers found</div>
                    ) : (
                      filteredTargets.slice(0, 10).map(camper => (
                        <button
                          key={camper.id}
                          onClick={() => {
                            setSelectedTarget(camper);
                            setTargetSearch(`${camper.first_name} ${camper.last_name}`);
                          }}
                          className={clsx(
                            "w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors text-sm first:rounded-t-xl last:rounded-b-xl",
                            selectedTarget?.id === camper.id && "bg-primary/10 text-primary"
                          )}
                        >
                          {camper.first_name} {camper.last_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {selectedTarget && (
                  <div className="mt-2 text-sm text-muted-foreground">
                    Selected: {selectedTarget.first_name} {selectedTarget.last_name}
                  </div>
                )}
              </div>
            )}

            {/* Age Preference Target */}
            {requestType === 'age_preference' && (
              <div>
                <label className="block text-sm font-semibold mb-2">Age Preference</label>
                <select
                  value={agePreferenceTarget}
                  onChange={(e) => setAgePreferenceTarget(e.target.value as 'older' | 'younger')}
                  className="input-lodge"
                >
                  <option value="older">Older (same grade + one above)</option>
                  <option value="younger">Younger (same grade + one below)</option>
                </select>
              </div>
            )}

            {/* Priority */}
            <div>
              <label className="block text-sm font-semibold mb-2">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                className="input-lodge"
              >
                {[4, 3, 2, 1].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold mb-2">Notes (Optional)</label>
              <textarea
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
  );
}