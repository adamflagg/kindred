import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitMerge, AlertCircle } from 'lucide-react';
import { Modal } from './ui/Modal';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

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
  const [selectedTargetId, setSelectedTargetId] = useState<string>(requests[0]?.id || '');
  const [finalType, setFinalType] = useState<BunkRequestsRequestTypeOptions>(
    requests[0]?.request_type || BunkRequestsRequestTypeOptions.bunk_with
  );
  const [error, setError] = useState<string | null>(null);

  // Compute combined source fields preview
  const combinedSourceFields = [...new Set(requests.map((r) => r.source_field).filter(Boolean))];

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/requests/merge', {
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
                    <span className="font-medium">Type:</span>{' '}
                    <span className="text-muted-foreground">{request.request_type}</span>
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
