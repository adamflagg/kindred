import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Scissors, AlertCircle } from 'lucide-react';
import { Modal } from './ui/Modal';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

interface SourceLinkData {
  original_request_id: string;
  source_field: string;
}

interface SplitRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: BunkRequestsResponse;
  sourceLinks: SourceLinkData[];
  onSplitComplete: () => void;
}

interface SplitSourceConfig {
  original_request_id: string;
  new_type: BunkRequestsRequestTypeOptions;
  new_target_id: number | null;
}

interface SplitResponse {
  original_request_id: string;
  created_request_ids: string[];
  updated_source_fields: string[];
}

export default function SplitRequestModal({
  isOpen,
  onClose,
  request,
  sourceLinks,
  onSplitComplete,
}: SplitRequestModalProps) {
  const queryClient = useQueryClient();
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [sourceTypes, setSourceTypes] = useState<Record<string, BunkRequestsRequestTypeOptions>>({});
  const [error, setError] = useState<string | null>(null);

  // Get current source fields from request
  // source_fields may be an array if the request was merged
  const currentSourceFields = (request as unknown as { source_fields?: string[] }).source_fields || [request.source_field];

  // Toggle source selection
  const toggleSource = (originalRequestId: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(originalRequestId)) {
      newSelected.delete(originalRequestId);
    } else {
      newSelected.add(originalRequestId);
      // Set default type if not already set
      if (!sourceTypes[originalRequestId]) {
        setSourceTypes((prev) => ({
          ...prev,
          [originalRequestId]: BunkRequestsRequestTypeOptions.bunk_with,
        }));
      }
    }
    setSelectedSources(newSelected);
  };

  // Update type for a selected source
  const updateSourceType = (originalRequestId: string, type: BunkRequestsRequestTypeOptions) => {
    setSourceTypes((prev) => ({
      ...prev,
      [originalRequestId]: type,
    }));
  };

  // Split mutation
  const splitMutation = useMutation({
    mutationFn: async () => {
      const splitSources: SplitSourceConfig[] = Array.from(selectedSources).map((origId) => ({
        original_request_id: origId,
        new_type: sourceTypes[origId] || BunkRequestsRequestTypeOptions.bunk_with,
        new_target_id: null,
      }));

      const response = await fetch('/api/requests/split', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_id: request.id,
          split_sources: splitSources,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Split failed');
      }

      return response.json() as Promise<SplitResponse>;
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
      onSplitComplete();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSplit = () => {
    setError(null);
    splitMutation.mutate();
  };

  const canSplit = selectedSources.size > 0 && !splitMutation.isPending;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Split Request" size="lg">
      <div className="space-y-6">
        {/* Error display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Error: {error}</span>
          </div>
        )}

        {/* Current request info */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <h3 className="text-sm font-medium mb-2">Current Request</h3>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Type:</span> {request.request_type}
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Source Fields:</span>{' '}
            {Array.isArray(currentSourceFields) ? currentSourceFields.join(', ') : currentSourceFields}
          </div>
        </div>

        {/* Source selection */}
        <div>
          <h3 className="text-sm font-medium mb-3">Select sources to split off:</h3>
          <div className="space-y-3">
            {sourceLinks.map((link) => {
              const isSelected = selectedSources.has(link.original_request_id);
              return (
                <div
                  key={link.original_request_id}
                  className={`p-4 border rounded-lg transition-colors ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`source-${link.original_request_id}`}
                      checked={isSelected}
                      onChange={() => toggleSource(link.original_request_id)}
                      className="mt-1 rounded"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor={`source-${link.original_request_id}`}
                        className="block text-sm font-medium cursor-pointer"
                      >
                        {link.source_field}
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Original ID: {link.original_request_id}
                      </span>

                      {/* Type selection - shown when source is selected */}
                      {isSelected && (
                        <div className="mt-3">
                          <label
                            htmlFor={`type-${link.original_request_id}`}
                            className="block text-xs font-medium mb-1"
                          >
                            New Request Type:
                          </label>
                          <select
                            id={`type-${link.original_request_id}`}
                            aria-label="New request type"
                            value={sourceTypes[link.original_request_id] || BunkRequestsRequestTypeOptions.bunk_with}
                            onChange={(e) =>
                              updateSourceType(
                                link.original_request_id,
                                e.target.value as BunkRequestsRequestTypeOptions
                              )
                            }
                            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
                          >
                            <option value={BunkRequestsRequestTypeOptions.bunk_with}>Bunk With</option>
                            <option value={BunkRequestsRequestTypeOptions.not_bunk_with}>Not Bunk With</option>
                            <option value={BunkRequestsRequestTypeOptions.age_preference}>Age Preference</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {sourceLinks.length === 0 && (
            <p className="text-sm text-muted-foreground">No sources available to split.</p>
          )}
        </div>

        {/* Preview */}
        {selectedSources.size > 0 && (
          <div className="p-4 bg-muted/30 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Split Preview</h3>
            <p className="text-sm text-muted-foreground">
              {selectedSources.size} source(s) will be split into new request(s).
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Remaining sources:{' '}
              {sourceLinks
                .filter((l) => !selectedSources.has(l.original_request_id))
                .map((l) => l.source_field)
                .join(', ') || 'None'}
            </p>
          </div>
        )}

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
            onClick={handleSplit}
            disabled={!canSplit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {splitMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Splitting...
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                Split Request
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
