import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitMerge, AlertCircle, User, HelpCircle } from 'lucide-react';
import { Modal } from './ui/Modal';
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';
import { pb } from '../lib/pocketbase';
import { useApiWithAuth } from '../hooks/useApiWithAuth';

interface MergeRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BunkRequestsResponse[];
  onMergeComplete: () => void;
}

interface MergeResponse {
  merged_request_id: string;
  deleted_request_ids: string[];
  source_fields: string[];
  confidence_score: number;
}

export default function MergeRequestsModal({
  isOpen,
  onClose,
  requests,
  onMergeComplete,
}: MergeRequestsModalProps) {
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useApiWithAuth();
  const [selectedTargetId, setSelectedTargetId] = useState<string>(requests[0]?.id || '');
  const [finalType, setFinalType] = useState<BunkRequestsRequestTypeOptions>(
    requests[0]?.request_type || BunkRequestsRequestTypeOptions.bunk_with
  );
  const [error, setError] = useState<string | null>(null);

  // Compute combined source fields preview
  const combinedSourceFields = [...new Set(requests.map((r) => r.source_field).filter(Boolean))];

  // Get unique requestee IDs that are positive (resolved) for person lookup
  const requesteeIds = useMemo(() => {
    return [...new Set(requests
      .map(r => r.requestee_id)
      .filter((id): id is number => typeof id === 'number' && id > 0)
    )];
  }, [requests]);

  // Fetch person data for resolved targets
  const { data: persons = [] } = useQuery({
    queryKey: ['persons-for-merge', requesteeIds, requests[0]?.year],
    queryFn: async () => {
      if (requesteeIds.length === 0) return [];
      const year = requests[0]?.year;
      if (!year) return [];

      const filter = `(${requesteeIds.map(id => `cm_id = ${id}`).join(' || ')}) && year = ${year}`;
      return pb.collection<PersonsResponse>('persons').getFullList({ filter });
    },
    enabled: requesteeIds.length > 0,
  });

  const personMap = useMemo(() => {
    return new Map(persons.map(p => [p.cm_id, p]));
  }, [persons]);

  // Helper to render target display
  const renderTarget = (request: BunkRequestsResponse) => {
    const requesteeId = request.requestee_id;
    const requestedName = request.requested_person_name;

    // Resolved: positive ID with person lookup
    if (requesteeId && requesteeId > 0) {
      const person = personMap.get(requesteeId);
      if (person) {
        return (
          <span className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-forest-600 dark:text-forest-400" />
            <span className="text-forest-700 dark:text-forest-300 font-medium">
              {person.first_name} {person.last_name}
            </span>
          </span>
        );
      }
      // Person not found in lookup, show ID
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <User className="w-3.5 h-3.5" />
          Person #{requesteeId}
        </span>
      );
    }

    // Placeholder: negative ID (AI-generated placeholder)
    if (requesteeId && requesteeId < 0) {
      return (
        <span className="flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-amber-700 dark:text-amber-300 italic">
            {requestedName || 'Unknown'} <span className="text-xs text-muted-foreground">(unresolved)</span>
          </span>
        </span>
      );
    }

    // Unresolved: no ID, just the parsed name
    if (requestedName) {
      return (
        <span className="flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-amber-700 dark:text-amber-300 italic">
            {requestedName} <span className="text-xs text-muted-foreground">(unresolved)</span>
          </span>
        </span>
      );
    }

    // No target at all
    return <span className="text-muted-foreground italic">No target</span>;
  };

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
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Merge failed');
      }

      return response.json() as Promise<MergeResponse>;
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
      onMergeComplete();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleMerge = () => {
    setError(null);
    mergeMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Requests" size="lg">
      <div className="space-y-6">
        {/* Error display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Error: {error}</span>
          </div>
        )}

        {/* Side-by-side comparison */}
        <div>
          <h3 className="text-sm font-medium mb-3">Select which request's target to keep:</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {requests.map((request, index) => (
              <label
                key={request.id}
                className={`relative p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedTargetId === request.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
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
                    <span className="text-xs font-semibold text-muted-foreground">
                      Request {index + 1}
                    </span>
                    {selectedTargetId === request.id && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Target:</span>{' '}
                    {renderTarget(request)}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Type:</span>{' '}
                    <span className="text-muted-foreground">{request.request_type.replace('_', ' ')}</span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Source:</span>{' '}
                    <span className="text-muted-foreground">{request.source_field}</span>
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
                      <span className="text-muted-foreground text-xs italic">"{request.original_text}"</span>
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Final type selection */}
        <div>
          <label htmlFor="final-type" className="block text-sm font-medium mb-2">
            Final Request Type:
          </label>
          <select
            id="final-type"
            aria-label="Final request type"
            value={finalType}
            onChange={(e) => setFinalType(e.target.value as BunkRequestsRequestTypeOptions)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background"
          >
            <option value={BunkRequestsRequestTypeOptions.bunk_with}>Bunk With</option>
            <option value={BunkRequestsRequestTypeOptions.not_bunk_with}>Not Bunk With</option>
            <option value={BunkRequestsRequestTypeOptions.age_preference}>Age Preference</option>
          </select>
        </div>

        {/* Combined source fields preview */}
        <div>
          <h3 className="text-sm font-medium mb-2">Combined Source Fields:</h3>
          <div className="p-3 bg-muted/50 rounded-lg">
            {combinedSourceFields.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {combinedSourceFields.map((field) => (
                  <span
                    key={field}
                    className="text-xs px-2 py-1 bg-primary/10 text-primary rounded"
                  >
                    {field}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No source fields</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={mergeMutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {mergeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="w-4 h-4" />
                Merge Requests
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
