import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  Filter,
  CheckCircle,
  CheckCheck,
  XCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  AlertCircle,
  Shield,
  Plus,
  GitMerge,
  Scissors,
  SlidersHorizontal,
  Users
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { pb } from '../lib/pocketbase';
// Virtual scrolling removed for better dropdown compatibility
import type { BunkRequestsResponse, PersonsResponse, BunkRequestsStatusOptions } from '../types/pocketbase-types';
import clsx from 'clsx';
import EditableRequestType from './EditableRequestType';
import EditableRequestTarget from './EditableRequestTarget';
import EditablePriority from './EditablePriority';
import CreateRequestModal from './CreateRequestModal';
import CamperDetailsPanel from './CamperDetailsPanel';
import MergeRequestsModal from './MergeRequestsModal';
import SplitRequestModal from './SplitRequestModal';
import { useOptimisticValidation } from '../hooks/useOptimisticValidation';
import type { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

interface RequestReviewPanelProps {
  sessionId: number;
  relatedSessionIds?: number[]; // Additional session IDs to include (sub-sessions, AG sessions)
  year: number;
}

// Confidence thresholds (must match backend config)
const CONFIDENCE_AUTO_ACCEPT = 0.95;
const CONFIDENCE_RESOLVED = 0.85;

type ResolvedConfidenceFilter = 'all' | 'high' | 'spot-check';

interface FilterState {
  confidenceThreshold: number;
  requestTypes: string[];
  statuses: string[];
  searchQuery: string;
  showResolved: boolean;
  resolvedConfidenceFilter: ResolvedConfidenceFilter;
}


type SortColumn = 'requester' | 'request' | 'type' | 'priority' | 'confidence' | 'status';

export default function RequestReviewPanel({ sessionId, relatedSessionIds = [], year }: RequestReviewPanelProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortColumn>('confidence');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [requestToSplit, setRequestToSplit] = useState<BunkRequestsResponse | null>(null);
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    confidenceThreshold: 0,
    requestTypes: [],
    statuses: ['pending', 'declined', 'resolved'],
    searchQuery: '',
    showResolved: false,
    resolvedConfidenceFilter: 'all'
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Query key excludes searchQuery since search filtering happens client-side using personMap
  const queryKeyFilters = useMemo(() => ({
    confidenceThreshold: filters.confidenceThreshold,
    requestTypes: filters.requestTypes,
    statuses: filters.statuses,
    showResolved: filters.showResolved,
    resolvedConfidenceFilter: filters.resolvedConfidenceFilter
  }), [filters.confidenceThreshold, filters.requestTypes, filters.statuses, filters.showResolved, filters.resolvedConfidenceFilter]);

  // Fetch bunk requests
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['bunk-requests', sessionId, relatedSessionIds, year, queryKeyFilters],
    queryFn: async () => {
      // Build filter for primary session and all related sessions
      const allSessionIds = [sessionId, ...relatedSessionIds];
      const sessionFilter = allSessionIds.map(id => `session_id = ${id}`).join(' || ');
      let filterStr = `(${sessionFilter}) && year = ${year}`;

      // Add status filter - exclude resolved if showResolved is false
      const activeStatuses = filters.showResolved
        ? filters.statuses
        : filters.statuses.filter(s => s !== 'resolved');

      if (activeStatuses.length > 0) {
        const statusFilter = activeStatuses.map(s => `status = '${s}'`).join(' || ');
        filterStr += ` && (${statusFilter})`;
      }

      // Add request type filter
      if (filters.requestTypes.length > 0) {
        const typeFilter = filters.requestTypes.map(t => `request_type = '${t}'`).join(' || ');
        filterStr += ` && (${typeFilter})`;
      }

      const result = await pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: filterStr,
        sort: '-confidence_score,priority'
      });

      // Filter by confidence threshold on client side
      // When slider is at 0, show all requests
      // When slider is at 100, show only low confidence (score <= 100)
      let filtered = filters.confidenceThreshold === 0
        ? result
        : result.filter(r => r.confidence_score <= filters.confidenceThreshold);

      // Apply resolved confidence filter when showing resolved requests
      if (filters.showResolved && filters.resolvedConfidenceFilter !== 'all') {
        filtered = filtered.filter(r => {
          if (r.status !== 'resolved') return true; // Keep non-resolved as-is
          if (filters.resolvedConfidenceFilter === 'high') {
            return r.confidence_score >= CONFIDENCE_AUTO_ACCEPT;
          } else if (filters.resolvedConfidenceFilter === 'spot-check') {
            return r.confidence_score >= CONFIDENCE_RESOLVED && r.confidence_score < CONFIDENCE_AUTO_ACCEPT;
          }
          return true;
        });
      }

      // Search filtering moved to sortedRequests useMemo for instant client-side filtering
      return filtered;
    },
    staleTime: 30000,
    enabled: !!user,
  });

  // Fetch person data for display - use string-based key for stability
  const personIds = useMemo(() => {
    const ids = new Set<number>();
    requests.forEach((r: BunkRequestsResponse) => {
      ids.add(r.requester_id);
      if (r.requestee_id) ids.add(r.requestee_id);
    });
    return Array.from(ids).sort((a, b) => a - b);
  }, [requests]);

  // Stable string key prevents unnecessary refetches when array reference changes
  const personIdsKey = useMemo(() => personIds.join(','), [personIds]);

  const { data: persons = [] } = useQuery({
    queryKey: ['persons-for-requests', personIdsKey, year],
    queryFn: async () => {
      if (personIds.length === 0) return [];

      // Batch fetch in chunks
      const chunks: number[][] = [];
      for (let i = 0; i < personIds.length; i += 50) {
        chunks.push(personIds.slice(i, i + 50));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          pb.collection<PersonsResponse>('persons').getFullList({
            filter: `(${chunk.map(id => `cm_id = ${id}`).join(' || ')}) && year = ${year}`
          })
        )
      );

      return results.flat();
    },
    enabled: !!user && personIds.length > 0,
  });

  const personMap = useMemo(() => {
    return new Map(persons.map((p: PersonsResponse) => [p.cm_id, p]));
  }, [persons]);

  // Fetch source links for split modal when a request is selected for splitting
  const { data: sourceLinksData = [], isLoading: isLoadingSourceLinks } = useQuery({
    queryKey: ['source-links', requestToSplit?.id],
    queryFn: async () => {
      if (!requestToSplit) return [];
      return pb.collection('bunk_request_sources').getFullList({
        filter: `bunk_request = "${requestToSplit.id}"`,
        sort: '-is_primary,created',
        expand: 'original_request',
      });
    },
    enabled: !!requestToSplit,
  });

  // Transform source links data for SplitRequestModal
  const sourceLinks = useMemo(() => {
    interface ExpandedOriginalRequest {
      content?: string;
      created?: string;
    }
    interface SourceLinkRecord {
      original_request: string;
      source_field: string;
      parse_notes?: string;  // AI parse notes stored on junction table
      expand?: {
        original_request?: ExpandedOriginalRequest;
      };
    }
    return (sourceLinksData as unknown as SourceLinkRecord[]).map((sl) => ({
      original_request_id: sl.original_request,
      source_field: sl.source_field,
      original_content: sl.expand?.original_request?.content,
      created: sl.expand?.original_request?.created,
      parse_notes: sl.parse_notes,
    }));
  }, [sourceLinksData]);

  // Count of requests needing review (all pending requests need attention)
  const reviewCount = useMemo(() => {
    return requests.filter((r: BunkRequestsResponse) => r.status === 'pending').length;
  }, [requests]);

  // Filter and sort requests - search filtering happens here for instant client-side response
  const sortedRequests = useMemo(() => {
    let filtered = [...requests];

    // Client-side search filtering using already-fetched personMap
    if (filters.searchQuery && personMap.size > 0) {
      const searchLower = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(r => {
        const requester = personMap.get(r.requester_id);
        const requested = r.requestee_id ? personMap.get(r.requestee_id) : null;
        const requesterName = requester ? `${requester.first_name || ''} ${requester.last_name || ''}`.toLowerCase() : '';
        const requestedName = requested ? `${requested.first_name || ''} ${requested.last_name || ''}`.toLowerCase() : '';
        return requesterName.includes(searchLower) || requestedName.includes(searchLower);
      });
    }

    // Sort filtered results
    const sorted = filtered.sort((a, b) => {
      let aValue: string | number | Date;
      let bValue: string | number | Date;

      switch (sortBy) {
        case 'requester': {
          const aRequester = personMap.get(a.requester_id);
          const bRequester = personMap.get(b.requester_id);
          aValue = aRequester ? `${aRequester?.first_name || ''} ${aRequester?.last_name || ''}` : '';
          bValue = bRequester ? `${bRequester?.first_name || ''} ${bRequester?.last_name || ''}` : '';
          break;
        }
        case 'request': {
          const aRequested = a.requestee_id ? personMap.get(a.requestee_id) : null;
          const bRequested = b.requestee_id ? personMap.get(b.requestee_id) : null;
          aValue = aRequested ? `${aRequested?.first_name || ''} ${aRequested?.last_name || ''}` : a.parse_notes || '';
          bValue = bRequested ? `${bRequested?.first_name || ''} ${bRequested?.last_name || ''}` : b.parse_notes || '';
          break;
        }
        case 'type':
          aValue = a.request_type;
          bValue = b.request_type;
          break;
        case 'priority':
          aValue = a.priority;
          bValue = b.priority;
          break;
        case 'confidence':
          aValue = a.confidence_score;
          bValue = b.confidence_score;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        default:
          return 0;
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return sorted;
  }, [requests, sortBy, sortOrder, personMap, filters.searchQuery]);

  // Check if merge is possible: exactly 2 requests selected with same requester and session
  const mergeEligibility = useMemo(() => {
    if (selectedRequests.size !== 2) {
      return { canMerge: false, reason: 'Select exactly 2 requests to merge', requests: [] };
    }

    const selectedReqs = sortedRequests.filter(r => selectedRequests.has(r.id));
    if (selectedReqs.length !== 2) {
      return { canMerge: false, reason: 'Selected requests not found', requests: [] };
    }

    const [first, second] = selectedReqs;
    if (!first || !second) {
      return { canMerge: false, reason: 'Selected requests not found', requests: [] };
    }

    if (first.requester_id !== second.requester_id) {
      return { canMerge: false, reason: 'Requests must have the same requester', requests: [] };
    }

    if (first.session_id !== second.session_id) {
      return { canMerge: false, reason: 'Requests must be from the same session', requests: [] };
    }

    return { canMerge: true, reason: '', requests: selectedReqs };
  }, [selectedRequests, sortedRequests]);

  // Helper to check if a request is a merged request (has multiple sources)
  // Check either: multiple source_fields OR merged_from metadata exists
  const hasMultipleSources = useCallback((request: BunkRequestsResponse) => {
    // Multiple unique source fields
    if (Array.isArray(request.source_fields) && request.source_fields.length > 1) {
      return true;
    }
    // Check metadata for merged_from (when merging requests from same source field)
    const metadata = request.metadata as Record<string, unknown> | undefined;
    const mergedFrom = metadata?.['merged_from'];
    if (mergedFrom && Array.isArray(mergedFrom) && mergedFrom.length > 0) {
      return true;
    }
    return false;
  }, []);

  // Optimistic validation for conflict detection
  const { validateChange, conflicts, clearConflicts } = useOptimisticValidation(requests);
  const [conflictingRequest, setConflictingRequest] = useState<BunkRequestsResponse | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{
    id: string;
    updates: Partial<BunkRequestsResponse>;
    request: BunkRequestsResponse;
  } | null>(null);

  // Simple scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Mutations
  const updateRequestMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BunkRequestsResponse> }) => {
      return pb.collection('bunk_requests').update(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
      toast.success('Request updated');
    },
    onError: () => {
      toast.error('Failed to update request');
    }
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Partial<BunkRequestsResponse> }) => {
      return Promise.all(ids.map(id => 
        pb.collection('bunk_requests').update(id, updates)
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
      toast.success('Requests updated');
      setSelectedRequests(new Set());
    },
    onError: () => {
      toast.error('Failed to update requests');
    }
  });

  // Handlers
  const toggleRowExpansion = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleRequestSelection = useCallback((id: string) => {
    setSelectedRequests(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAllSelection = useCallback(() => {
    if (selectedRequests.size === sortedRequests.length) {
      setSelectedRequests(new Set());
    } else {
      setSelectedRequests(new Set(sortedRequests.map(r => r.id)));
    }
  }, [selectedRequests, sortedRequests]);

  const handleSort = (column: SortColumn) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const handleBulkApprove = () => {
    if (selectedRequests.size === 0) return;
    bulkUpdateMutation.mutate({
      ids: Array.from(selectedRequests),
      updates: { 
        status: 'resolved' as BunkRequestsStatusOptions,
        request_locked: true
      }
    });
  };

  const handleBulkReject = () => {
    if (selectedRequests.size === 0) return;
    if (!confirm(`Are you sure you want to reject ${selectedRequests.size} requests?`)) return;
    bulkUpdateMutation.mutate({
      ids: Array.from(selectedRequests),
      updates: { status: 'declined' as BunkRequestsStatusOptions }
    });
  };

  // Validated update handler - checks for conflicts before applying
  const handleValidatedUpdate = useCallback((
    request: BunkRequestsResponse,
    updates: Partial<BunkRequestsResponse>
  ) => {
    // Only validate if changing target or type (potential conflict fields)
    if (updates.requestee_id !== undefined || updates.request_type !== undefined) {
      const newRequesteeId = updates.requestee_id ?? request.requestee_id ?? 0;
      const newType = (updates.request_type ?? request.request_type) as BunkRequestsRequestTypeOptions;

      validateChange({
        requestId: request.id,
        requesterId: request.requester_id,
        newRequesteeId,
        newType,
        sessionId: request.session_id,
      });

      // Check if validation found conflicts
      if (conflicts.length > 0) {
        const conflict = conflicts[0];
        if (conflict) {
          setConflictingRequest(conflict.conflictingRequest);
          setPendingUpdate({ id: request.id, updates, request });
          return; // Don't proceed with update, show conflict dialog instead
        }
      }
    }

    // No conflict, proceed with update
    updateRequestMutation.mutate({ id: request.id, updates });
  }, [validateChange, conflicts, updateRequestMutation]);

  // Handle conflict resolution - proceed with update despite conflict
  const handleProceedDespiteConflict = useCallback(() => {
    if (pendingUpdate) {
      updateRequestMutation.mutate({ id: pendingUpdate.id, updates: pendingUpdate.updates });
      clearConflicts();
      setPendingUpdate(null);
      setConflictingRequest(null);
    }
  }, [pendingUpdate, updateRequestMutation, clearConflicts]);

  // Handle conflict resolution - merge instead
  const handleMergeConflict = useCallback(() => {
    if (pendingUpdate && conflictingRequest) {
      // Open merge modal with the two conflicting requests
      setSelectedRequests(new Set([pendingUpdate.id, conflictingRequest.id]));
      setShowMergeModal(true);
      clearConflicts();
      setPendingUpdate(null);
      setConflictingRequest(null);
    }
  }, [pendingUpdate, conflictingRequest, clearConflicts]);

  // Cancel conflict resolution
  const handleCancelConflict = useCallback(() => {
    clearConflicts();
    setPendingUpdate(null);
    setConflictingRequest(null);
  }, [clearConflicts]);

  const getConfidenceColor = (score: number) => {
    if (score >= CONFIDENCE_AUTO_ACCEPT) return 'text-forest-700 bg-forest-50 dark:text-forest-300 dark:bg-forest-900/30';
    if (score >= CONFIDENCE_RESOLVED) return 'text-forest-600 bg-forest-50/70 dark:text-forest-400 dark:bg-forest-900/20';
    if (score >= 0.50) return 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30';
    return 'text-bark-700 bg-bark-50 dark:text-bark-300 dark:bg-bark-900/30';
  };

  // Get confidence indicator icon based on score
  const getConfidenceIndicator = (score: number) => {
    if (score >= CONFIDENCE_AUTO_ACCEPT) {
      return <CheckCheck className="w-3 h-3 inline mr-1" />; // Double check for high confidence
    }
    if (score >= CONFIDENCE_RESOLVED) {
      return <CheckCircle className="w-3 h-3 inline mr-1" />; // Single check for standard
    }
    return null; // No indicator for low confidence
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Pending</span>;
      case 'resolved':
        return <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-forest-100 text-forest-800 dark:bg-forest-900/40 dark:text-forest-200">Resolved</span>;
      case 'declined':
        return <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-bark-100 text-bark-800 dark:bg-bark-900/40 dark:text-bark-200">Declined</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">{status}</span>;
    }
  };

  const getRequestTypeLabel = (type: string) => {
    switch (type) {
      case 'bunk_with':
        return 'Bunk With';
      case 'not_bunk_with':
        return 'Not Bunk With';
      case 'age_preference':
        return 'Age Preference';
      default:
        return type;
    }
  };

  const requestTypes = ['bunk_with', 'not_bunk_with', 'age_preference'];

  // Count active filters for the filter toggle badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.confidenceThreshold !== 0) count++;
    if (filters.requestTypes.length > 0) count++;
    if (filters.statuses.length !== 3 || filters.showResolved) count++;
    return count;
  }, [filters.confidenceThreshold, filters.requestTypes.length, filters.statuses.length, filters.showResolved]);

  // Get preview of selected request names for bulk action bar
  const getSelectedNamesPreview = useCallback((maxDisplay: number = 2) => {
    const selectedReqs = sortedRequests.filter(r => selectedRequests.has(r.id));
    const names = selectedReqs.map(r => {
      const person = personMap.get(r.requester_id);
      if (person) {
        const firstName = person.first_name || '';
        const lastName = person.last_name || '';
        return `${firstName} ${lastName.charAt(0)}.`.trim();
      }
      return `#${r.requester_id}`;
    });

    if (names.length === 0) return '';
    if (names.length <= maxDisplay) return names.join(', ');
    const displayed = names.slice(0, maxDisplay).join(', ');
    const remaining = names.length - maxDisplay;
    return `${displayed} +${remaining}`;
  }, [sortedRequests, selectedRequests, personMap]);

  // Keyboard handler for Escape to close filters
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && filtersExpanded) {
        setFiltersExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filtersExpanded]);

  return (
    <>
    <div className="card-lodge overflow-hidden">
      {/* Compact Header Bar - Always visible */}
      <div className="p-3 sm:p-4 border-b border-border">
        <div className="flex items-center gap-3">
          {/* Title with review badge */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Filter className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground hidden sm:block">
              Requests
            </h2>
            {reviewCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 rounded-full">
                {reviewCount}
              </span>
            )}
          </div>

          {/* Search - Always visible */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={filters.searchQuery}
              onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="input-lodge pl-9 py-2 text-sm w-full"
            />
          </div>

          {/* Filter Toggle Button */}
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            aria-expanded={filtersExpanded}
            aria-controls="filter-panel"
            className={clsx(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all touch-manipulation",
              filtersExpanded
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className={clsx(
                "px-1.5 py-0.5 text-xs rounded-full font-semibold",
                filtersExpanded
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-primary text-primary-foreground"
              )}>
                {activeFilterCount}
              </span>
            )}
            {filtersExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {/* Create Button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 text-sm px-3 py-2 touch-manipulation"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create</span>
          </button>

          {/* Total count */}
          <div className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
            {sortedRequests.length} total
          </div>
        </div>
      </div>

      {/* Collapsible Filter Panel */}
      <div
        id="filter-panel"
        className={clsx(
          "border-b border-border bg-forest-50/30 dark:bg-forest-900/40 overflow-hidden transition-all duration-200 ease-out",
          filtersExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="p-4 sm:p-6 space-y-4">
          {/* Row 1: Confidence Segmented Buttons */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-semibold text-bark-600 dark:text-bark-300 w-20">Confidence</span>
            <div className="flex items-center gap-1 bg-muted/50 dark:bg-muted/30 rounded-xl p-1 border border-border/50">
              {[
                { value: 0, label: 'All' },
                { value: 50, label: 'Low Only' },
                { value: 1, label: 'Needs Review' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFilters(prev => ({ ...prev, confidenceThreshold: value }))}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
                    filters.confidenceThreshold === value
                      ? "bg-primary text-primary-foreground shadow-lodge-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Request Types as Pills */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-semibold text-bark-600 dark:text-bark-300 w-20">Types</span>
            <div className="flex flex-wrap items-center gap-2">
              {requestTypes.map(type => {
                const isSelected = filters.requestTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setFilters(prev => ({
                        ...prev,
                        requestTypes: isSelected
                          ? prev.requestTypes.filter(t => t !== type)
                          : [...prev.requestTypes, type]
                      }));
                    }}
                    role="button"
                    aria-pressed={isSelected}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                      isSelected
                        ? "bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700"
                        : "bg-transparent text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground"
                    )}
                  >
                    {isSelected && <CheckCircle className="w-3 h-3 inline mr-1.5" />}
                    {getRequestTypeLabel(type)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Status Pills + Show Resolved */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-semibold text-bark-600 dark:text-bark-300 w-20">Status</span>
            <div className="flex flex-wrap items-center gap-2">
              {['pending', 'declined'].map(status => {
                const isSelected = filters.statuses.includes(status);
                return (
                  <button
                    key={status}
                    onClick={() => {
                      setFilters(prev => ({
                        ...prev,
                        statuses: isSelected
                          ? prev.statuses.filter(s => s !== status)
                          : [...prev.statuses, status]
                      }));
                    }}
                    role="button"
                    aria-pressed={isSelected}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-sm font-medium transition-all border capitalize",
                      isSelected
                        ? "bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700"
                        : "bg-transparent text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground"
                    )}
                  >
                    {isSelected && <CheckCircle className="w-3 h-3 inline mr-1.5" />}
                    {status}
                  </button>
                );
              })}
              <div className="border-l border-border pl-2 ml-1 flex items-center gap-2">
                <button
                  onClick={() => setFilters(prev => ({ ...prev, showResolved: !prev.showResolved }))}
                  role="button"
                  aria-pressed={filters.showResolved}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                    filters.showResolved
                      ? "bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700"
                      : "bg-transparent text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground"
                  )}
                >
                  {filters.showResolved && <CheckCircle className="w-3 h-3 inline mr-1.5" />}
                  Show Resolved
                </button>
                {filters.showResolved && (
                  <select
                    value={filters.resolvedConfidenceFilter}
                    onChange={(e) => setFilters(prev => ({
                      ...prev,
                      resolvedConfidenceFilter: e.target.value as ResolvedConfidenceFilter
                    }))}
                    className="input-lodge text-sm py-1.5 px-2"
                  >
                    <option value="all">All Resolved</option>
                    <option value="high">High Confidence (≥95%)</option>
                    <option value="spot-check">Spot Check (85-94%)</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Request List */}
      <div className="overflow-hidden">
        {/* Table Header - Desktop only */}
        <div className="hidden md:block bg-forest-50/40 dark:bg-forest-900/40 border-b border-border sticky top-0 z-10">
          <div className="request-table-grid">
            <div className="px-3 py-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedRequests.size === sortedRequests.length && sortedRequests.length > 0}
                onChange={toggleAllSelection}
                className="rounded"
              />
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
            <div
              className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('requester')}
            >
              <div className="flex items-center gap-1">
                Requester
                {sortBy === 'requester' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div
              className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('request')}
            >
              <div className="flex items-center gap-1">
                Request
                {sortBy === 'request' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div
              className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('type')}
            >
              <div className="flex items-center gap-1">
                Type
                {sortBy === 'type' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div
              className="px-4 py-3 text-center text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('priority')}
            >
              <div className="flex items-center gap-1 justify-center">
                Priority
                {sortBy === 'priority' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div
              className="px-4 py-3 text-center text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('confidence')}
            >
              <div className="flex items-center gap-1 justify-center">
                Confidence
                {sortBy === 'confidence' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div
              className="px-4 py-3 text-center text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={() => handleSort('status')}
            >
              <div className="flex items-center gap-1 justify-center">
                Status
                {sortBy === 'status' && (
                  <span className="text-primary">{sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
                )}
              </div>
            </div>
            <div className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Actions
            </div>
          </div>
        </div>

        {/* Mobile Header */}
        <div className="md:hidden bg-forest-50/40 dark:bg-forest-900/40 border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectedRequests.size === sortedRequests.length && sortedRequests.length > 0}
              onChange={toggleAllSelection}
              className="rounded w-5 h-5"
            />
            <span className="text-sm font-medium">Select All</span>
          </div>
          <span className="text-sm text-muted-foreground">{sortedRequests.length} requests</span>
        </div>

        {/* Table Body */}
        <div
          ref={scrollContainerRef}
          className="overflow-auto relative"
          style={{
            height: '600px',
            overscrollBehaviorY: 'contain'
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading requests...
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              No requests match the current filters
            </div>
          ) : (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden pb-[100px]">
                {sortedRequests.map((request) => {
                  const requester = personMap.get(request.requester_id);
                  const isExpanded = expandedRows.has(request.id);

                  return (
                    <div key={request.id}>
                      <div className="request-card-mobile hover:bg-muted/30 transition-colors">
                        {/* Checkbox */}
                        <div className="card-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedRequests.has(request.id)}
                            onChange={() => toggleRequestSelection(request.id)}
                            className="rounded w-5 h-5"
                          />
                        </div>

                        {/* Main info: Requester name and type */}
                        <div className="card-main">
                          <button
                            onClick={() => setSelectedCamperId(String(request.requester_id))}
                            className="font-medium text-left hover:text-primary hover:underline transition-colors"
                          >
                            {requester ? `${requester?.first_name || ''} ${requester?.last_name || ''}` : `Person ${request.requester_id}`}
                          </button>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {getRequestTypeLabel(request.request_type)}
                          </div>
                        </div>

                        {/* Badges: Confidence & Status */}
                        <div className="card-badges">
                          <span className={clsx(
                            "px-2 py-0.5 text-xs rounded-full font-medium flex items-center",
                            getConfidenceColor(request.confidence_score)
                          )}>
                            {getConfidenceIndicator(request.confidence_score)}
                            {(request.confidence_score * 100).toFixed(0)}%
                          </span>
                          {getStatusBadge(request.status)}
                        </div>

                        {/* Request target info */}
                        <div className="card-request">
                          <EditableRequestTarget
                            requestType={request.request_type}
                            currentPersonId={request.requestee_id ?? null}
                            {...(request.age_preference_target !== undefined && { agePreferenceTarget: request.age_preference_target })}
                            sessionId={sessionId}
                            year={year}
                            requesterCmId={request.requester_id}
                            onChange={(updates) => {
                              const pbUpdates: Partial<BunkRequestsResponse> = {};
                              if (updates.requestee_id !== undefined) {
                                pbUpdates.requestee_id = updates.requestee_id ?? 0;
                              }
                              if (updates.age_preference_target !== undefined) {
                                pbUpdates.age_preference_target = updates.age_preference_target;
                              }
                              if (updates.requestee_id && updates.requestee_id > 0) {
                                pbUpdates.status = 'resolved' as BunkRequestsStatusOptions;
                                pbUpdates.confidence_score = 1.0;
                              }
                              handleValidatedUpdate(request, pbUpdates);
                            }}
                            disabled={request.request_locked || false}
                            originalText={request.original_text}
                            requestedPersonName={request.requested_person_name}
                            {...(request.parse_notes !== undefined && { parseNotes: request.parse_notes })}
                            onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                            personMap={personMap}
                          />
                        </div>

                        {/* Actions */}
                        <div className="card-actions">
                          <button
                            onClick={() => toggleRowExpansion(request.id)}
                            className="p-2 hover:bg-muted rounded-lg transition-colors touch-manipulation"
                            title="View details"
                          >
                            {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                          </button>
                          {request.status === 'resolved' && request.request_locked && (
                            <button
                              onClick={() => updateRequestMutation.mutate({
                                id: request.id,
                                updates: { request_locked: false }
                              })}
                              className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-colors touch-manipulation"
                              title="Unprotect"
                            >
                              <Shield className="w-5 h-5" />
                            </button>
                          )}
                          {hasMultipleSources(request) && (
                            <button
                              onClick={() => {
                                setRequestToSplit(request);
                                setShowSplitModal(true);
                              }}
                              className="p-2 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg transition-colors touch-manipulation"
                              title="Split merged request"
                            >
                              <Scissors className="w-5 h-5" />
                            </button>
                          )}
                          <button
                            onClick={() => updateRequestMutation.mutate({
                              id: request.id,
                              updates: {
                                status: 'resolved' as BunkRequestsStatusOptions,
                                request_locked: true
                              }
                            })}
                            className="p-2 hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 rounded-lg transition-colors touch-manipulation"
                            title="Approve"
                          >
                            <CheckCircle className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Reject this request?')) {
                                updateRequestMutation.mutate({
                                  id: request.id,
                                  updates: { status: 'declined' as BunkRequestsStatusOptions }
                                });
                              }
                            }}
                            className="p-2 hover:bg-destructive/10 text-destructive rounded-lg transition-colors touch-manipulation"
                            title="Reject"
                          >
                            <XCircle className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded details - mobile */}
                      {isExpanded && (
                        <div className="px-4 py-3 bg-parchment-50/50 dark:bg-forest-950/20 border-b border-border">
                          <div className="space-y-2 text-sm">
                            <div>
                              <span className="font-medium">Priority:</span>{' '}
                              <EditablePriority
                                value={request.priority}
                                onChange={(newPriority) => {
                                  updateRequestMutation.mutate({
                                    id: request.id,
                                    updates: { priority: newPriority }
                                  });
                                }}
                                disabled={false}
                              />
                            </div>
                            <div>
                              <span className="font-medium">Source:</span>{' '}
                              <span className="text-muted-foreground">{request.source}</span>
                            </div>
                            {request.original_text && (
                              <div>
                                <span className="font-medium">Original:</span>{' '}
                                <span className="text-muted-foreground">{request.original_text}</span>
                              </div>
                            )}
                            {request.parse_notes && (
                              <div>
                                <span className="font-medium">Notes:</span>{' '}
                                <span className="text-muted-foreground">{request.parse_notes}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden md:block min-w-[1064px] pb-[200px]">
                {sortedRequests.map((request) => {
                  const requester = personMap.get(request.requester_id);
                  const isExpanded = expandedRows.has(request.id);

                  return (
                    <div
                      key={request.id}
                      className={clsx(
                        "border-b transition-colors",
                        selectedRequests.has(request.id)
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-muted/30"
                      )}
                    >
                      <div className="request-table-grid">
                      <div className="px-3 py-3 flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selectedRequests.has(request.id)}
                          onChange={() => toggleRequestSelection(request.id)}
                          className="rounded"
                        />
                        <button
                          onClick={() => toggleRowExpansion(request.id)}
                          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                          title="View details"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="px-4 py-3 flex items-center">
                        <button
                          onClick={() => setSelectedCamperId(String(request.requester_id))}
                          className="font-medium truncate text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                          title="View camper details"
                        >
                          {requester ? `${requester?.first_name || ''} ${requester?.last_name || ''}` : `Person ${request.requester_id}`}
                        </button>
                      </div>
                      <div className="px-4 py-3 flex items-center">
                        <EditableRequestTarget
                          requestType={request.request_type}
                          currentPersonId={request.requestee_id ?? null}
                          {...(request.age_preference_target !== undefined && { agePreferenceTarget: request.age_preference_target })}
                          sessionId={sessionId}
                          year={year}
                          requesterCmId={request.requester_id}
                          onChange={(updates) => {
                            // Convert null to 0 for PocketBase (0 means "no value")
                            const pbUpdates: Partial<BunkRequestsResponse> = {};
                            if (updates.requestee_id !== undefined) {
                              pbUpdates.requestee_id = updates.requestee_id ?? 0;
                            }
                            if (updates.age_preference_target !== undefined) {
                              pbUpdates.age_preference_target = updates.age_preference_target;
                            }
                            // When resolving, also mark as resolved
                            if (updates.requestee_id && updates.requestee_id > 0) {
                              pbUpdates.status = 'resolved' as BunkRequestsStatusOptions;
                              pbUpdates.confidence_score = 1.0;
                            }
                            handleValidatedUpdate(request, pbUpdates);
                          }}
                          disabled={request.request_locked || false}
                          originalText={request.original_text}
                          requestedPersonName={request.requested_person_name}
                          {...(request.parse_notes !== undefined && { parseNotes: request.parse_notes })}
                          onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                          personMap={personMap}
                        />
                      </div>
                      <div className="px-4 py-3 flex items-center">
                        <EditableRequestType
                          value={request.request_type}
                          onChange={(newType) => {
                            const updates: Partial<BunkRequestsResponse> = { request_type: newType as BunkRequestsResponse['request_type'] };

                            // Clear fields based on type change
                            if (newType === 'age_preference') {
                              // Clear person selection when switching to age preference
                              delete updates.requestee_id;
                            } else {
                              // Clear age preference when switching to person-based types
                              delete updates.age_preference_target;
                            }

                            handleValidatedUpdate(request, updates);
                          }}
                          disabled={request.request_locked || false}
                        />
                      </div>
                      <div className="px-4 py-3 flex items-center justify-center">
                        <EditablePriority
                          value={request.priority}
                          onChange={(newPriority) => {
                            updateRequestMutation.mutate({
                              id: request.id,
                              updates: { priority: newPriority }
                            });
                          }}
                          disabled={false} // Allow priority changes even for resolved requests
                        />
                      </div>
                      <div className="px-4 py-3 flex items-center justify-center">
                        <span className={clsx(
                          "px-2 py-1 text-xs rounded-full font-medium flex items-center",
                          getConfidenceColor(request.confidence_score)
                        )}>
                          {getConfidenceIndicator(request.confidence_score)}
                          {(request.confidence_score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-center justify-center">
                        {getStatusBadge(request.status)}
                      </div>
                      <div className="px-4 py-3 flex items-center justify-end">
                        <div className="flex items-center justify-end gap-1 min-w-[100px]">
                          {request.status === 'resolved' && request.request_locked && (
                            <button
                              onClick={() => updateRequestMutation.mutate({
                                id: request.id,
                                updates: {
                                  request_locked: false
                                }
                              })}
                              className="p-1.5 hover:bg-primary/10 text-primary rounded-lg transition-colors opacity-80 hover:opacity-100"
                              title="Click to unprotect and allow editing"
                            >
                              <Shield className="w-4 h-4" />
                            </button>
                          )}
                          {hasMultipleSources(request) && (
                            <button
                              onClick={() => {
                                setRequestToSplit(request);
                                setShowSplitModal(true);
                              }}
                              className="p-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg transition-colors opacity-80 hover:opacity-100"
                              title="Split merged request"
                            >
                              <Scissors className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => updateRequestMutation.mutate({
                              id: request.id,
                              updates: {
                                status: 'resolved' as BunkRequestsStatusOptions,
                                request_locked: true
                              }
                            })}
                            className="p-1.5 hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 rounded-lg transition-colors opacity-80 hover:opacity-100"
                            title="Approve"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to reject this request?')) {
                                updateRequestMutation.mutate({
                                  id: request.id,
                                  updates: { status: 'declined' as BunkRequestsStatusOptions }
                                });
                              }
                            }}
                            className="p-1.5 hover:bg-destructive/10 text-destructive rounded-lg transition-colors opacity-80 hover:opacity-100"
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 py-4 bg-parchment-50/50 dark:bg-forest-950/20 border-t border-border">
                        <div className="space-y-3 max-w-3xl ml-10">
                          {/* Combined Source Field & Content */}
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Source Field & Content</h4>
                            {(() => {
                              // Helper to format field name (snake_case -> Title Case)
                              const formatFieldName = (f: string) =>
                                f.split('_').map((word: string) =>
                                  word.charAt(0).toUpperCase() + word.slice(1)
                                ).join(' ');

                              // Get field name(s) with proper fallback chain:
                              // 1. source_fields (for merged requests - array)
                              // 2. source_field (single field)
                              // 3. ai_p1_reasoning.csv_source_field (AI processing)
                              interface AiReasoningWithField {
                                csv_source_field?: string;
                              }

                              const sourceFields = request.source_fields;
                              const singleField = request.source_field;
                              const aiField = (request.ai_p1_reasoning && typeof request.ai_p1_reasoning === 'object' && 'csv_source_field' in request.ai_p1_reasoning)
                                ? (request.ai_p1_reasoning as AiReasoningWithField).csv_source_field ?? ''
                                : '';

                              // Determine display field name
                              let fieldName: string;
                              if (Array.isArray(sourceFields) && sourceFields.length > 1) {
                                // Merged request: show all source fields combined
                                fieldName = sourceFields.map(f => formatFieldName(f)).join(' + ');
                              } else {
                                // Single source: use first available field
                                const field = sourceFields?.[0] || singleField || aiField || '';
                                fieldName = field ? formatFieldName(field) : 'Unknown Field';
                              }

                              return (
                                <p className="text-sm">
                                  <span className="font-medium">{fieldName}:</span>{' '}
                                  <span className="text-muted-foreground">
                                    {request.original_text || <span className="italic">No original text</span>}
                                  </span>
                                </p>
                              );
                            })()}
                          </div>

                          {/* Parse Notes - always show */}
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Parse Notes</h4>
                            <p className="text-sm text-muted-foreground">
                              {request.parse_notes || <span className="italic">No parse notes</span>}
                            </p>
                          </div>


                          {/* Metadata - always show */}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Source: {request.source}</span>
                            <span>Reciprocal: {request.is_reciprocal ? 'Yes' : 'No'}</span>
                            <span>Created: {new Date(request.created).toLocaleDateString()}</span>
                          </div>

                          {/* Protection status - show when applicable */}
                          {request.request_locked && request.status === 'resolved' && (
                            <div className="flex items-center gap-4 text-xs">
                              <span className="flex items-center gap-1.5 text-primary font-medium">
                                <Shield className="w-3 h-3" />
                                Protected due to manual approval
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      </div>

      {/* Help Text - Hidden on mobile to save space, shown on larger screens */}
      <div className="hidden sm:block p-4 sm:p-6 bg-forest-50/50 dark:bg-forest-900/50 border-t border-border">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-forest-600 dark:text-forest-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-forest-800 dark:text-forest-200 space-y-3">
            <div>
              <p className="font-medium mb-1">Confidence Indicators:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-forest-700 dark:text-forest-300">
                <li><span className="inline-flex items-center"><CheckCheck className="w-3 h-3 mr-1" /> <strong>95%+</strong></span> — High confidence, auto-resolved, typically no review needed</li>
                <li><span className="inline-flex items-center"><CheckCircle className="w-3 h-3 mr-1" /> <strong>85-94%</strong></span> — Standard confidence, resolved but may want to spot-check</li>
                <li><strong>&lt;85%</strong> — Lower confidence, requires manual review</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Review Guidelines:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-forest-700 dark:text-forest-300">
                <li>Focus on pending requests first — these need attention</li>
                <li>Use "Spot Check (85-94%)" filter to review borderline resolved requests</li>
                <li>Check parse notes for ambiguous requests that need clarification</li>
                <li>Use bulk actions to quickly process similar requests</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Action Meanings:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-forest-700 dark:text-forest-300">
                <li><strong className="text-forest-800 dark:text-forest-200">Approve (✓):</strong> Confirms the request is valid and the requested person has been correctly identified. Approved requests are automatically protected from sync updates.</li>
                <li><strong className="text-forest-800 dark:text-forest-200">Reject (✗):</strong> Marks request as invalid (e.g., person not attending this session, incorrect name match, or typo)</li>
                <li><strong className="text-forest-800 dark:text-forest-200">Protected (🛡️):</strong> Resolved requests are automatically protected to preserve manual approvals</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Create Request Modal */}
      {showCreateModal && (
        <CreateRequestModal
          sessionId={sessionId}
          year={year}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Camper Details Panel */}
      {selectedCamperId && (
        <CamperDetailsPanel
          camperId={selectedCamperId}
          onClose={() => setSelectedCamperId(null)}
        />
      )}

      {/* Merge Requests Modal */}
      {showMergeModal && mergeEligibility.canMerge && (
        <MergeRequestsModal
          isOpen={showMergeModal}
          onClose={() => setShowMergeModal(false)}
          requests={mergeEligibility.requests}
          onMergeComplete={() => {
            setShowMergeModal(false);
            setSelectedRequests(new Set());
            toast.success('Requests merged successfully');
          }}
        />
      )}

      {/* Split Request Modal */}
      {showSplitModal && requestToSplit && (
        <SplitRequestModal
          isOpen={showSplitModal}
          onClose={() => {
            setShowSplitModal(false);
            setRequestToSplit(null);
          }}
          request={requestToSplit}
          sourceLinks={sourceLinks}
          isLoadingSourceLinks={isLoadingSourceLinks}
          onSplitComplete={() => {
            setShowSplitModal(false);
            setRequestToSplit(null);
            toast.success('Request split successfully');
          }}
        />
      )}

      {/* Conflict Resolution Dialog */}
      {conflictingRequest && pendingUpdate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-background rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-amber-500" />
              <h3 className="text-lg font-semibold">Conflict Detected</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              This change would create a duplicate request. A request for the same person already exists:
            </p>
            <div className="p-3 bg-muted rounded-lg mb-4">
              <div className="text-sm">
                <span className="font-medium">Type:</span>{' '}
                {conflictingRequest.request_type.replace('_', ' ')}
              </div>
              <div className="text-sm">
                <span className="font-medium">Source:</span>{' '}
                {conflictingRequest.source_field}
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelConflict}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMergeConflict}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                <GitMerge className="w-4 h-4" />
                Merge Requests
              </button>
              <button
                onClick={handleProceedDespiteConflict}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                Create Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Sticky Bottom Bulk Action Bar - Fixed position, slides up when requests selected */}
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${selectedRequests.size} selected requests`}
      className={clsx(
        "fixed bottom-0 left-0 right-0 z-50",
        "bg-background/95 backdrop-blur-sm border-t border-border shadow-lg",
        "transition-transform duration-300 ease-out will-change-transform",
        selectedRequests.size > 0 ? "translate-y-0" : "translate-y-full"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          {/* Selection info */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{selectedRequests.size} selected</span>
            </div>
            {selectedRequests.size > 0 && (
              <span className="text-sm text-muted-foreground truncate hidden sm:block">
                • {getSelectedNamesPreview()}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkApprove}
              disabled={selectedRequests.size === 0}
              className="px-4 py-2 bg-forest-600 text-white rounded-xl hover:bg-forest-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium shadow-sm touch-manipulation min-h-[44px]"
            >
              <CheckCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Approve</span>
            </button>
            {mergeEligibility.canMerge && (
              <button
                onClick={() => setShowMergeModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2 font-medium shadow-sm touch-manipulation min-h-[44px]"
                title="Merge these two requests into one"
              >
                <GitMerge className="w-4 h-4" />
                <span className="hidden sm:inline">Merge</span>
              </button>
            )}
            <button
              onClick={handleBulkReject}
              disabled={selectedRequests.size === 0}
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded-xl hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium shadow-sm touch-manipulation min-h-[44px]"
            >
              <XCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Reject</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}