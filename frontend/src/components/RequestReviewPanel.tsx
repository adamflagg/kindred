import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { formatSourceField } from '../utils/formatSourceField'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
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
  Users,
  Loader2,
  Star,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { pb } from '../lib/pocketbase'
// Virtual scrolling removed for better dropdown compatibility
import type {
  BunkRequestsResponse,
  PersonsResponse,
  BunkRequestsStatusOptions,
} from '../types/pocketbase-types'
import clsx from 'clsx'
import {
  getDispositionClasses,
  getDispositionSortRank,
  CONFIDENCE_AUTO_ACCEPT,
  CONFIDENCE_RESOLVED,
} from '../utils/dispositionColors'
import EditableRequestType from './EditableRequestType'
import EditableRequestTarget from './EditableRequestTarget'
import EditablePriority from './EditablePriority'
import CreateRequestModal from './CreateRequestModal'
import CamperDetailsPanel from './CamperDetailsPanel'
import MergeRequestsModal from './MergeRequestsModal'
import SplitRequestModal from './SplitRequestModal'
import { useOptimisticValidation } from '../hooks/useOptimisticValidation'

interface RequestReviewPanelProps {
  sessionId: number
  relatedSessionIds?: number[] // Additional session IDs to include (sub-sessions, AG sessions)
  year: number
}

type ResolvedConfidenceFilter = 'all' | 'high' | 'spot-check'

interface FilterState {
  lowConfidenceOnly: boolean
  needsReviewOnly: boolean
  requestTypes: string[]
  statuses: string[]
  searchQuery: string
  showResolved: boolean
  resolvedConfidenceFilter: ResolvedConfidenceFilter
}

type SortColumn = 'requester' | 'request' | 'disposition' | 'priority' | 'confidence' | 'status'

export default function RequestReviewPanel({
  sessionId,
  relatedSessionIds = [],
  year,
}: RequestReviewPanelProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortColumn>('confidence')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [requestToSplit, setRequestToSplit] = useState<BunkRequestsResponse | null>(null)
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>({
    lowConfidenceOnly: false,
    needsReviewOnly: false,
    requestTypes: [],
    statuses: ['pending', 'declined', 'resolved'],
    searchQuery: '',
    showResolved: false,
    resolvedConfidenceFilter: 'all',
  })
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  // Query key only includes server-side filters (sent to PocketBase).
  // Client-side filters (confidence, review, search) are applied in filteredRequests memo.
  const queryKeyFilters = useMemo(
    () => ({
      requestTypes: filters.requestTypes,
      statuses: filters.statuses,
      showResolved: filters.showResolved,
    }),
    [filters.requestTypes, filters.statuses, filters.showResolved]
  )

  // Fetch bunk requests
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['bunk-requests', sessionId, relatedSessionIds, year, queryKeyFilters],
    queryFn: async () => {
      // Build filter for primary session and all related sessions
      const allSessionIds = [sessionId, ...relatedSessionIds]
      const sessionFilter = allSessionIds.map((id) => `session_id = ${id}`).join(' || ')
      // Filter out absorbed requests (those that have been merged into another request)
      let filterStr = `(${sessionFilter}) && year = ${year} && (merged_into = "" || merged_into = null)`

      // Add status filter - exclude resolved if showResolved is false
      const activeStatuses = filters.showResolved
        ? filters.statuses
        : filters.statuses.filter((s) => s !== 'resolved')

      if (activeStatuses.length > 0) {
        const statusFilter = activeStatuses.map((s) => `status = '${s}'`).join(' || ')
        filterStr += ` && (${statusFilter})`
      }

      // Add request type filter
      if (filters.requestTypes.length > 0) {
        const typeFilter = filters.requestTypes.map((t) => `request_type = '${t}'`).join(' || ')
        filterStr += ` && (${typeFilter})`
      }

      return await pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: filterStr,
        sort: '-confidence_score,priority',
      })
    },
    staleTime: 30000,
    enabled: !!user,
  })

  // Fetch person data for display - use string-based key for stability
  const personIds = useMemo(() => {
    const ids = new Set<number>()
    requests.forEach((r: BunkRequestsResponse) => {
      ids.add(r.requester_id)
      if (r.requestee_id) ids.add(r.requestee_id)
    })
    return Array.from(ids).sort((a, b) => a - b)
  }, [requests])

  // Stable string key prevents unnecessary refetches when array reference changes
  const personIdsKey = useMemo(() => personIds.join(','), [personIds])

  const { data: persons = [] } = useQuery({
    queryKey: ['persons-for-requests', personIdsKey, year],
    queryFn: async () => {
      if (personIds.length === 0) return []

      // Batch fetch in chunks
      const chunks: number[][] = []
      for (let i = 0; i < personIds.length; i += 50) {
        chunks.push(personIds.slice(i, i + 50))
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
    enabled: !!user && personIds.length > 0,
  })

  const personMap = useMemo(() => {
    return new Map(persons.map((p: PersonsResponse) => [p.cm_id, p]))
  }, [persons])

  // Fetch absorbed requests for split modal when a request is selected for splitting
  // These are soft-deleted requests that were merged into the selected request
  const { data: absorbedRequestsData = [], isLoading: isLoadingAbsorbedRequests } = useQuery({
    queryKey: ['absorbed-requests', requestToSplit?.id],
    queryFn: async () => {
      if (!requestToSplit) return []
      // Fetch requests where merged_into points to the selected request
      return pb.collection('bunk_requests').getFullList({
        filter: `merged_into = "${requestToSplit.id}"`,
        sort: 'created',
      })
    },
    enabled: !!requestToSplit,
  })

  // Transform absorbed requests + kept request into source links format for SplitRequestModal
  // The "primary" entry is the kept request itself, absorbed requests are non-primary
  const sourceLinks = useMemo(() => {
    interface SourceLinkEntry {
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
    const links: SourceLinkEntry[] = []

    // Add the kept request as primary (cannot be split off)
    if (requestToSplit) {
      const metadata = requestToSplit.metadata as Record<string, unknown> | null
      links.push({
        original_request_id: requestToSplit.id,
        source_field: requestToSplit.source_field || 'Unknown',
        original_content: metadata?.['original_text'] as string | undefined,
        created: requestToSplit.created,
        parse_notes: metadata?.['parse_notes'] as string | undefined,
        is_primary: true,
        requested_person_name: requestToSplit.requested_person_name || undefined,
        requestee_id: requestToSplit.requestee_id,
      })
    }

    // Add absorbed requests as non-primary (can be split off)
    for (const absorbed of absorbedRequestsData as BunkRequestsResponse[]) {
      const metadata = absorbed.metadata as Record<string, unknown> | null
      links.push({
        original_request_id: absorbed.id,
        source_field: absorbed.source_field || 'Unknown',
        original_content: metadata?.['original_text'] as string | undefined,
        created: absorbed.created,
        parse_notes: metadata?.['parse_notes'] as string | undefined,
        is_primary: false,
        requested_person_name: absorbed.requested_person_name || undefined,
        requestee_id: absorbed.requestee_id,
      })
    }

    return links
  }, [requestToSplit, absorbedRequestsData])

  // Loading state includes both the request itself and absorbed requests
  const isLoadingSourceLinks = isLoadingAbsorbedRequests

  // Track which merged request rows need source links loaded (lazy loading)
  const [expandedMergedRequestId, setExpandedMergedRequestId] = useState<string | null>(null)

  // Lazy load source links for expanded merged request dropdown
  const { data: expandedSourceLinksData = [], isLoading: isLoadingExpandedSourceLinks } = useQuery({
    queryKey: ['expanded-source-links', expandedMergedRequestId],
    queryFn: async () => {
      if (!expandedMergedRequestId) return []
      return pb.collection('bunk_request_sources').getFullList({
        filter: `bunk_request = "${expandedMergedRequestId}"`,
        sort: '-is_primary,created',
        expand: 'original_request',
      })
    },
    enabled: !!expandedMergedRequestId,
    staleTime: 60000, // Cache for 1 minute
  })

  // Transform expanded source links data for dropdown display
  const expandedSourceLinks = useMemo(() => {
    interface ExpandedOriginalRequest {
      content?: string
      created?: string
    }
    interface SourceLinkRecord {
      original_request: string
      source_field: string
      parse_notes?: string
      is_primary?: boolean
      expand?: {
        original_request?: ExpandedOriginalRequest
      }
    }
    return (expandedSourceLinksData as unknown as SourceLinkRecord[]).map((sl) => ({
      original_request_id: sl.original_request,
      source_field: sl.source_field,
      original_content: sl.expand?.original_request?.content,
      created: sl.expand?.original_request?.created,
      parse_notes: sl.parse_notes,
      is_primary: sl.is_primary ?? false,
    }))
  }, [expandedSourceLinksData])

  // Count of requests needing review (all pending requests need attention)
  const reviewCount = useMemo(() => {
    return requests.filter((r: BunkRequestsResponse) => r.status === 'pending').length
  }, [requests])

  // Client-side filtering (confidence, review, resolved confidence, search)
  const sortedRequests = useMemo(() => {
    let filtered = [...requests]

    // Confidence / review filters
    if (filters.lowConfidenceOnly) {
      filtered = filtered.filter((r) => r.confidence_score < CONFIDENCE_RESOLVED)
    }
    if (filters.needsReviewOnly) {
      filtered = filtered.filter((r) => r.requires_manual_review === true)
    }

    // Resolved confidence filter
    if (filters.showResolved && filters.resolvedConfidenceFilter !== 'all') {
      filtered = filtered.filter((r) => {
        if (r.status !== 'resolved') return true
        if (filters.resolvedConfidenceFilter === 'high') {
          return r.confidence_score >= CONFIDENCE_AUTO_ACCEPT
        } else if (filters.resolvedConfidenceFilter === 'spot-check') {
          return (
            r.confidence_score >= CONFIDENCE_RESOLVED && r.confidence_score < CONFIDENCE_AUTO_ACCEPT
          )
        }
        return true
      })
    }

    // Search filtering using already-fetched personMap
    if (filters.searchQuery && personMap.size > 0) {
      const searchLower = filters.searchQuery.toLowerCase()
      filtered = filtered.filter((r) => {
        const requester = personMap.get(r.requester_id)
        const requested = r.requestee_id ? personMap.get(r.requestee_id) : null
        const requesterName = requester
          ? `${requester.first_name || ''} ${requester.last_name || ''}`.toLowerCase()
          : ''
        const requestedName = requested
          ? `${requested.first_name || ''} ${requested.last_name || ''}`.toLowerCase()
          : ''
        return requesterName.includes(searchLower) || requestedName.includes(searchLower)
      })
    }

    // Sort filtered results
    const sorted = filtered.sort((a, b) => {
      let aValue: string | number | Date
      let bValue: string | number | Date

      switch (sortBy) {
        case 'requester': {
          const aRequester = personMap.get(a.requester_id)
          const bRequester = personMap.get(b.requester_id)
          aValue = aRequester ? `${aRequester.first_name || ''} ${aRequester.last_name || ''}` : ''
          bValue = bRequester ? `${bRequester.first_name || ''} ${bRequester.last_name || ''}` : ''
          break
        }
        case 'request': {
          const aRequested = a.requestee_id ? personMap.get(a.requestee_id) : null
          const bRequested = b.requestee_id ? personMap.get(b.requestee_id) : null
          aValue = aRequested
            ? `${aRequested.first_name || ''} ${aRequested.last_name || ''}`
            : a.parse_notes || ''
          bValue = bRequested
            ? `${bRequested.first_name || ''} ${bRequested.last_name || ''}`
            : b.parse_notes || ''
          break
        }
        case 'disposition': {
          const aRank = getDispositionSortRank(a.disposition_reason ?? '')
          const bRank = getDispositionSortRank(b.disposition_reason ?? '')
          if (aRank !== bRank) {
            aValue = aRank
            bValue = bRank
          } else {
            aValue = a.disposition_reason ?? ''
            bValue = b.disposition_reason ?? ''
          }
          break
        }
        case 'priority':
          aValue = a.priority
          bValue = b.priority
          break
        case 'confidence':
          aValue = a.confidence_score
          bValue = b.confidence_score
          break
        case 'status':
          aValue = a.status
          bValue = b.status
          break
        default:
          return 0
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    return sorted
  }, [
    requests,
    sortBy,
    sortOrder,
    personMap,
    filters.searchQuery,
    filters.lowConfidenceOnly,
    filters.needsReviewOnly,
    filters.showResolved,
    filters.resolvedConfidenceFilter,
  ])

  // Check if merge is possible: 2+ requests selected with same requester and session
  const mergeEligibility = useMemo(() => {
    if (selectedRequests.size < 2) {
      return {
        canMerge: false,
        reason: 'Select at least 2 requests to merge',
        requests: [],
      }
    }

    const selectedReqs = sortedRequests.filter((r) => selectedRequests.has(r.id))
    if (selectedReqs.length < 2) {
      return {
        canMerge: false,
        reason: 'Selected requests not found',
        requests: [],
      }
    }

    // Check all selected requests have the same requester_id
    const firstRequesterId = selectedReqs[0]?.requester_id
    const allSameRequester = selectedReqs.every((r) => r.requester_id === firstRequesterId)
    if (!allSameRequester) {
      return {
        canMerge: false,
        reason: 'All requests must have the same requester',
        requests: [],
      }
    }

    // Check all selected requests have the same session_id
    const firstSessionId = selectedReqs[0]?.session_id
    const allSameSession = selectedReqs.every((r) => r.session_id === firstSessionId)
    if (!allSameSession) {
      return {
        canMerge: false,
        reason: 'All requests must be from the same session',
        requests: [],
      }
    }

    return { canMerge: true, reason: '', requests: selectedReqs }
  }, [selectedRequests, sortedRequests])

  // Helper to check if a request is a merged request (has multiple sources)
  // Check either: multiple source_fields OR merged_from metadata exists
  const hasMultipleSources = useCallback((request: BunkRequestsResponse) => {
    // Multiple unique source fields
    if (Array.isArray(request.source_fields) && request.source_fields.length > 1) {
      return true
    }
    // Check metadata for merged_from (when merging requests from same source field)
    const metadata = request.metadata as Record<string, unknown> | undefined
    const mergedFrom = metadata?.['merged_from']
    if (mergedFrom && Array.isArray(mergedFrom) && mergedFrom.length > 0) {
      return true
    }
    return false
  }, [])

  // Optimistic validation for conflict detection
  const { validateChange, conflicts, clearConflicts } = useOptimisticValidation(requests)
  const [conflictingRequest, setConflictingRequest] = useState<BunkRequestsResponse | null>(null)
  const [pendingUpdate, setPendingUpdate] = useState<{
    id: string
    updates: Partial<BunkRequestsResponse>
    request: BunkRequestsResponse
  } | null>(null)

  // Simple scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Mutations
  const updateRequestMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BunkRequestsResponse> }) => {
      return pb.collection('bunk_requests').update(id, updates)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bunk-requests'] })
      toast.success('Request updated')
    },
    onError: () => {
      toast.error('Failed to update request')
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({
      ids,
      updates,
    }: {
      ids: string[]
      updates: Partial<BunkRequestsResponse>
    }) => {
      return Promise.all(ids.map((id) => pb.collection('bunk_requests').update(id, updates)))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bunk-requests'] })
      toast.success('Requests updated')
      setSelectedRequests(new Set())
    },
    onError: () => {
      toast.error('Failed to update requests')
    },
  })

  // Handlers
  const toggleRowExpansion = useCallback(
    (id: string, request?: BunkRequestsResponse) => {
      setExpandedRows((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
          // Clear the expanded merged request when collapsing
          setExpandedMergedRequestId((currentId) => (currentId === id ? null : currentId))
        } else {
          next.add(id)
          // Trigger lazy loading for merged requests
          if (request && hasMultipleSources(request)) {
            setExpandedMergedRequestId(id)
          }
        }
        return next
      })
    },
    [hasMultipleSources]
  )

  const toggleRequestSelection = useCallback((id: string) => {
    setSelectedRequests((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleAllSelection = useCallback(() => {
    if (selectedRequests.size === sortedRequests.length) {
      setSelectedRequests(new Set())
    } else {
      setSelectedRequests(new Set(sortedRequests.map((r) => r.id)))
    }
  }, [selectedRequests, sortedRequests])

  const handleSort = (column: SortColumn) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleBulkApprove = () => {
    if (selectedRequests.size === 0) return
    bulkUpdateMutation.mutate({
      ids: Array.from(selectedRequests),
      updates: {
        status: 'resolved' as BunkRequestsStatusOptions,
        request_locked: true,
      },
    })
  }

  const handleBulkReject = () => {
    if (selectedRequests.size === 0) return
    if (!confirm(`Are you sure you want to reject ${selectedRequests.size} requests?`)) return
    bulkUpdateMutation.mutate({
      ids: Array.from(selectedRequests),
      updates: { status: 'declined' as BunkRequestsStatusOptions },
    })
  }

  // Validated update handler - checks for conflicts before applying
  const handleValidatedUpdate = useCallback(
    (request: BunkRequestsResponse, updates: Partial<BunkRequestsResponse>) => {
      // Only validate if changing target or type (potential conflict fields)
      if (updates.requestee_id !== undefined || updates.request_type !== undefined) {
        const newRequesteeId = updates.requestee_id ?? request.requestee_id
        const newType = updates.request_type ?? request.request_type

        validateChange({
          requestId: request.id,
          requesterId: request.requester_id,
          newRequesteeId,
          newType,
          sessionId: request.session_id,
        })

        // Check if validation found conflicts
        if (conflicts.length > 0) {
          const conflict = conflicts[0]
          if (conflict) {
            setConflictingRequest(conflict.conflictingRequest)
            setPendingUpdate({ id: request.id, updates, request })
            return // Don't proceed with update, show conflict dialog instead
          }
        }
      }

      // No conflict, proceed with update
      updateRequestMutation.mutate({ id: request.id, updates })
    },
    [validateChange, conflicts, updateRequestMutation]
  )

  // Handle conflict resolution - proceed with update despite conflict
  const handleProceedDespiteConflict = useCallback(() => {
    if (pendingUpdate) {
      updateRequestMutation.mutate({
        id: pendingUpdate.id,
        updates: pendingUpdate.updates,
      })
      clearConflicts()
      setPendingUpdate(null)
      setConflictingRequest(null)
    }
  }, [pendingUpdate, updateRequestMutation, clearConflicts])

  // Handle conflict resolution - merge instead
  const handleMergeConflict = useCallback(() => {
    if (pendingUpdate && conflictingRequest) {
      // Open merge modal with the two conflicting requests
      setSelectedRequests(new Set([pendingUpdate.id, conflictingRequest.id]))
      setShowMergeModal(true)
      clearConflicts()
      setPendingUpdate(null)
      setConflictingRequest(null)
    }
  }, [pendingUpdate, conflictingRequest, clearConflicts])

  // Cancel conflict resolution
  const handleCancelConflict = useCallback(() => {
    clearConflicts()
    setPendingUpdate(null)
    setConflictingRequest(null)
  }, [clearConflicts])

  const getConfidenceColor = (score: number) => {
    if (score >= CONFIDENCE_AUTO_ACCEPT)
      return 'text-forest-700 bg-forest-50 dark:text-forest-300 dark:bg-forest-900/30'
    if (score >= CONFIDENCE_RESOLVED)
      return 'text-forest-600 bg-forest-50/70 dark:text-forest-400 dark:bg-forest-900/20'
    if (score >= 0.5) return 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30'
    return 'text-bark-700 bg-bark-50 dark:text-bark-300 dark:bg-bark-900/30'
  }

  // Get confidence indicator icon based on score
  const getConfidenceIndicator = (score: number) => {
    if (score >= CONFIDENCE_AUTO_ACCEPT) {
      return <CheckCheck className="mr-1 inline h-3 w-3" /> // Double check for high confidence
    }
    if (score >= CONFIDENCE_RESOLVED) {
      return <CheckCircle className="mr-1 inline h-3 w-3" /> // Single check for standard
    }
    return null // No indicator for low confidence
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            Pending
          </span>
        )
      case 'resolved':
        return (
          <span className="bg-forest-100 text-forest-800 dark:bg-forest-900/40 dark:text-forest-200 rounded-full px-2.5 py-1 text-xs font-medium">
            Resolved
          </span>
        )
      case 'declined':
        return (
          <span className="bg-bark-100 text-bark-800 dark:bg-bark-900/40 dark:text-bark-200 rounded-full px-2.5 py-1 text-xs font-medium">
            Declined
          </span>
        )
      default:
        return (
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
            {status}
          </span>
        )
    }
  }

  const getRequestTypeLabel = (type: string) => {
    switch (type) {
      case 'bunk_with':
        return 'Bunk With'
      case 'not_bunk_with':
        return 'Not Bunk With'
      case 'age_preference':
        return 'Age Preference'
      default:
        return type
    }
  }

  const requestTypes = ['bunk_with', 'not_bunk_with', 'age_preference']

  // Count active filters for the filter toggle badge
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.lowConfidenceOnly || filters.needsReviewOnly) count++
    if (filters.requestTypes.length > 0) count++
    if (filters.statuses.length !== 3 || filters.showResolved) count++
    return count
  }, [
    filters.lowConfidenceOnly,
    filters.needsReviewOnly,
    filters.requestTypes.length,
    filters.statuses.length,
    filters.showResolved,
  ])

  // Get preview of selected request names for bulk action bar
  const getSelectedNamesPreview = useCallback(
    (maxDisplay: number = 2) => {
      const selectedReqs = sortedRequests.filter((r) => selectedRequests.has(r.id))
      const names = selectedReqs.map((r) => {
        const person = personMap.get(r.requester_id)
        if (person) {
          const firstName = person.first_name || ''
          const lastName = person.last_name || ''
          return `${firstName} ${lastName.charAt(0)}.`.trim()
        }
        return `#${r.requester_id}`
      })

      if (names.length === 0) return ''
      if (names.length <= maxDisplay) return names.join(', ')
      const displayed = names.slice(0, maxDisplay).join(', ')
      const remaining = names.length - maxDisplay
      return `${displayed} +${remaining}`
    },
    [sortedRequests, selectedRequests, personMap]
  )

  // Keyboard handler for Escape to close filters
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && filtersExpanded) {
        setFiltersExpanded(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [filtersExpanded])

  return (
    <>
      <div className="card-lodge overflow-hidden">
        {/* Compact Header Bar - Always visible */}
        <div className="border-border border-b p-3 sm:p-4">
          <div className="flex items-center gap-3">
            {/* Title with review badge */}
            <div className="flex flex-shrink-0 items-center gap-2">
              <Filter className="text-primary h-5 w-5" />
              <h2 className="font-display text-foreground hidden text-lg font-semibold sm:block">
                Requests
              </h2>
              {reviewCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {reviewCount}
                </span>
              )}
            </div>

            {/* Search - Always visible */}
            <div className="relative max-w-xs flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
              <input
                type="text"
                placeholder="Search..."
                value={filters.searchQuery}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    searchQuery: e.target.value,
                  }))
                }
                className="input-lodge w-full py-2 pl-9 text-sm"
              />
            </div>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-expanded={filtersExpanded}
              aria-controls="filter-panel"
              className={clsx(
                'flex touch-manipulation items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                filtersExpanded
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                    filtersExpanded
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-primary text-primary-foreground'
                  )}
                >
                  {activeFilterCount}
                </span>
              )}
              {filtersExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {/* Create Button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex touch-manipulation items-center gap-2 px-3 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </button>

            {/* Total count */}
            <div className="text-muted-foreground hidden flex-shrink-0 text-xs sm:block">
              {sortedRequests.length} total
            </div>
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        <div
          id="filter-panel"
          className={clsx(
            'border-border bg-forest-50/30 dark:bg-forest-900/40 overflow-hidden border-b transition-all duration-200 ease-out',
            filtersExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="space-y-4 p-4 sm:p-6">
            {/* Row 1: Confidence Segmented Buttons */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-bark-600 dark:text-bark-300 w-20 text-xs font-semibold">
                Confidence
              </span>
              <div className="bg-muted/50 dark:bg-muted/30 border-border/50 flex items-center gap-1 rounded-xl border p-1">
                <button
                  aria-pressed={!filters.lowConfidenceOnly && !filters.needsReviewOnly}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      lowConfidenceOnly: false,
                      needsReviewOnly: false,
                    }))
                  }
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
                    !filters.lowConfidenceOnly && !filters.needsReviewOnly
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                  )}
                >
                  All
                </button>
                <button
                  aria-pressed={filters.lowConfidenceOnly}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      lowConfidenceOnly: true,
                      needsReviewOnly: false,
                    }))
                  }
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
                    filters.lowConfidenceOnly
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                  )}
                >
                  Low Confidence
                </button>
                <button
                  aria-pressed={filters.needsReviewOnly}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      lowConfidenceOnly: false,
                      needsReviewOnly: true,
                    }))
                  }
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
                    filters.needsReviewOnly
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                  )}
                >
                  Needs Review
                </button>
              </div>
            </div>

            {/* Row 2: Request Types as Pills */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-bark-600 dark:text-bark-300 w-20 text-xs font-semibold">
                Types
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {requestTypes.map((type) => {
                  const isSelected = filters.requestTypes.includes(type)
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          requestTypes: isSelected
                            ? prev.requestTypes.filter((t) => t !== type)
                            : [...prev.requestTypes, type],
                        }))
                      }}
                      role="button"
                      aria-pressed={isSelected}
                      className={clsx(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                        isSelected
                          ? 'bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700'
                          : 'text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground bg-transparent'
                      )}
                    >
                      {isSelected && <CheckCircle className="mr-1.5 inline h-3 w-3" />}
                      {getRequestTypeLabel(type)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Row 3: Status Pills + Show Resolved */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-bark-600 dark:text-bark-300 w-20 text-xs font-semibold">
                Status
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {['pending', 'declined'].map((status) => {
                  const isSelected = filters.statuses.includes(status)
                  return (
                    <button
                      key={status}
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          statuses: isSelected
                            ? prev.statuses.filter((s) => s !== status)
                            : [...prev.statuses, status],
                        }))
                      }}
                      role="button"
                      aria-pressed={isSelected}
                      className={clsx(
                        'rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-all',
                        isSelected
                          ? 'bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700'
                          : 'text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground bg-transparent'
                      )}
                    >
                      {isSelected && <CheckCircle className="mr-1.5 inline h-3 w-3" />}
                      {status}
                    </button>
                  )
                })}
                <div className="border-border ml-1 flex items-center gap-2 border-l pl-2">
                  <button
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        showResolved: !prev.showResolved,
                      }))
                    }
                    role="button"
                    aria-pressed={filters.showResolved}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                      filters.showResolved
                        ? 'bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700'
                        : 'text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground bg-transparent'
                    )}
                  >
                    {filters.showResolved && <CheckCircle className="mr-1.5 inline h-3 w-3" />}
                    Show Resolved
                  </button>
                  {filters.showResolved && (
                    <select
                      value={filters.resolvedConfidenceFilter}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          resolvedConfidenceFilter: e.target.value as ResolvedConfidenceFilter,
                        }))
                      }
                      className="input-lodge px-2 py-1.5 text-sm"
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
          <div className="bg-forest-50/40 dark:bg-forest-900/40 border-border sticky top-0 z-10 hidden border-b md:block">
            <div className="request-table-grid">
              <div className="flex items-center gap-2 px-3 py-3">
                <input
                  type="checkbox"
                  checked={
                    selectedRequests.size === sortedRequests.length && sortedRequests.length > 0
                  }
                  onChange={toggleAllSelection}
                  className="rounded"
                />
                <ChevronRight className="text-muted-foreground h-4 w-4" />
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left text-sm font-medium"
                onClick={() => handleSort('requester')}
              >
                <div className="flex items-center gap-1">
                  Requester
                  {sortBy === 'requester' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left text-sm font-medium"
                onClick={() => handleSort('request')}
              >
                <div className="flex items-center gap-1">
                  Request
                  {sortBy === 'request' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left text-sm font-medium"
                onClick={() => handleSort('disposition')}
              >
                <div className="flex items-center gap-1">
                  Disposition
                  {sortBy === 'disposition' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center text-sm font-medium"
                onClick={() => handleSort('priority')}
              >
                <div className="flex items-center justify-center gap-1">
                  Priority
                  {sortBy === 'priority' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center text-sm font-medium"
                onClick={() => handleSort('confidence')}
              >
                <div className="flex items-center justify-center gap-1">
                  Confidence
                  {sortBy === 'confidence' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center text-sm font-medium"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center justify-center gap-1">
                  Status
                  {sortBy === 'status' && (
                    <span className="text-primary">
                      {sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-muted-foreground px-4 py-3 text-right text-sm font-medium">
                Actions
              </div>
            </div>
          </div>

          {/* Mobile Header */}
          <div className="bg-forest-50/40 dark:bg-forest-900/40 border-border flex items-center justify-between border-b px-4 py-3 md:hidden">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={
                  selectedRequests.size === sortedRequests.length && sortedRequests.length > 0
                }
                onChange={toggleAllSelection}
                className="h-5 w-5 rounded"
              />
              <span className="text-sm font-medium">Select All</span>
            </div>
            <span className="text-muted-foreground text-sm">{sortedRequests.length} requests</span>
          </div>

          {/* Table Body */}
          <div
            ref={scrollContainerRef}
            className="relative overflow-auto"
            style={{
              height: '600px',
              overscrollBehaviorY: 'contain',
            }}
          >
            {isLoading ? (
              <div className="text-muted-foreground flex items-center justify-center py-8">
                Loading requests...
              </div>
            ) : sortedRequests.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center py-8">
                No requests match the current filters
              </div>
            ) : (
              <>
                {/* Mobile Card Layout */}
                <div className="pb-[100px] md:hidden">
                  {sortedRequests.map((request) => {
                    const requester = personMap.get(request.requester_id)
                    const isExpanded = expandedRows.has(request.id)

                    return (
                      <div key={request.id}>
                        <div className="request-card-mobile hover:bg-muted/30 transition-colors">
                          {/* Checkbox */}
                          <div className="card-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedRequests.has(request.id)}
                              onChange={() => toggleRequestSelection(request.id)}
                              className="h-5 w-5 rounded"
                            />
                          </div>

                          {/* Main info: Requester name and type */}
                          <div className="card-main">
                            <button
                              onClick={() => setSelectedCamperId(String(request.requester_id))}
                              className="hover:text-primary text-left font-medium transition-colors hover:underline"
                            >
                              {requester
                                ? `${requester.first_name || ''} ${requester.last_name || ''}`
                                : `Person ${request.requester_id}`}
                            </button>
                            <div className="text-muted-foreground mt-0.5 text-xs">
                              {getRequestTypeLabel(request.request_type)}
                            </div>
                          </div>

                          {/* Badges: Confidence & Status */}
                          <div className="card-badges">
                            <span
                              className={clsx(
                                'flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                getConfidenceColor(request.confidence_score)
                              )}
                            >
                              {getConfidenceIndicator(request.confidence_score)}
                              {(request.confidence_score * 100).toFixed(0)}%
                            </span>
                            {getStatusBadge(request.status)}
                            {request.disposition_reason && (
                              <span
                                className={clsx(
                                  'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                  getDispositionClasses(request.disposition_reason)
                                )}
                              >
                                {request.disposition_reason.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>

                          {/* Request target info */}
                          <div className="card-request">
                            <EditableRequestTarget
                              requestType={request.request_type}
                              currentPersonId={request.requestee_id}
                              agePreferenceTarget={request.age_preference_target}
                              sessionId={sessionId}
                              year={year}
                              requesterCmId={request.requester_id}
                              onChange={(updates) => {
                                const pbUpdates: Partial<BunkRequestsResponse> = {}
                                if (updates.requestee_id !== undefined) {
                                  pbUpdates.requestee_id = updates.requestee_id ?? 0
                                }
                                if (updates.age_preference_target !== undefined) {
                                  pbUpdates.age_preference_target = updates.age_preference_target
                                }
                                if (updates.requestee_id && updates.requestee_id > 0) {
                                  pbUpdates.status = 'resolved' as BunkRequestsStatusOptions
                                  pbUpdates.confidence_score = 1.0
                                }
                                handleValidatedUpdate(request, pbUpdates)
                              }}
                              disabled={request.request_locked || false}
                              originalText={request.original_text}
                              requestedPersonName={request.requested_person_name}
                              parseNotes={request.parse_notes}
                              onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                              personMap={personMap}
                            />
                          </div>

                          {/* Actions */}
                          <div className="card-actions">
                            <button
                              onClick={() => toggleRowExpansion(request.id, request)}
                              className="hover:bg-muted touch-manipulation rounded-lg p-2 transition-colors"
                              title="View details"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-5 w-5" />
                              ) : (
                                <ChevronRight className="h-5 w-5" />
                              )}
                            </button>
                            {request.status === 'resolved' && request.request_locked && (
                              <button
                                onClick={() =>
                                  updateRequestMutation.mutate({
                                    id: request.id,
                                    updates: { request_locked: false },
                                  })
                                }
                                className="hover:bg-primary/10 text-primary touch-manipulation rounded-lg p-2 transition-colors"
                                title="Unprotect"
                              >
                                <Shield className="h-5 w-5" />
                              </button>
                            )}
                            {hasMultipleSources(request) && (
                              <button
                                onClick={() => {
                                  setRequestToSplit(request)
                                  setShowSplitModal(true)
                                }}
                                className="touch-manipulation rounded-lg p-2 text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
                                title="Split merged request"
                              >
                                <Scissors className="h-5 w-5" />
                              </button>
                            )}
                            <button
                              onClick={() =>
                                updateRequestMutation.mutate({
                                  id: request.id,
                                  updates: {
                                    status: 'resolved' as BunkRequestsStatusOptions,
                                    request_locked: true,
                                  },
                                })
                              }
                              className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 touch-manipulation rounded-lg p-2 transition-colors"
                              title="Approve"
                            >
                              <CheckCircle className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Reject this request?')) {
                                  updateRequestMutation.mutate({
                                    id: request.id,
                                    updates: {
                                      status: 'declined' as BunkRequestsStatusOptions,
                                    },
                                  })
                                }
                              }}
                              className="hover:bg-destructive/10 text-destructive touch-manipulation rounded-lg p-2 transition-colors"
                              title="Reject"
                            >
                              <XCircle className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded details - mobile */}
                        {isExpanded && (
                          <div className="bg-parchment-50/50 dark:bg-forest-950/20 border-border border-b px-4 py-3">
                            <div className="space-y-2 text-sm">
                              <div>
                                <span className="font-medium">Priority:</span>{' '}
                                <EditablePriority
                                  value={request.priority}
                                  onChange={(newPriority) => {
                                    updateRequestMutation.mutate({
                                      id: request.id,
                                      updates: { priority: newPriority },
                                    })
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
                                  <span className="text-muted-foreground">
                                    {request.original_text}
                                  </span>
                                </div>
                              )}
                              {request.parse_notes && (
                                <div>
                                  <span className="font-medium">Notes:</span>{' '}
                                  <span className="text-muted-foreground">
                                    {request.parse_notes}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Desktop Table Layout */}
                <div className="hidden min-w-[1064px] pb-[200px] md:block">
                  {sortedRequests.map((request) => {
                    const requester = personMap.get(request.requester_id)
                    const isExpanded = expandedRows.has(request.id)

                    return (
                      <div
                        key={request.id}
                        className={clsx(
                          'border-b transition-colors',
                          selectedRequests.has(request.id)
                            ? 'bg-primary/5 hover:bg-primary/10'
                            : 'hover:bg-muted/30'
                        )}
                      >
                        <div className="request-table-grid">
                          <div className="flex items-center gap-1 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedRequests.has(request.id)}
                              onChange={() => toggleRequestSelection(request.id)}
                              className="rounded"
                            />
                            <button
                              onClick={() => toggleRowExpansion(request.id, request)}
                              className="hover:bg-muted rounded-lg p-1.5 transition-colors"
                              title="View details"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center px-4 py-3">
                            <button
                              onClick={() => setSelectedCamperId(String(request.requester_id))}
                              className="hover:text-primary cursor-pointer truncate text-left font-medium transition-colors hover:underline"
                              title="View camper details"
                            >
                              {requester
                                ? `${requester.first_name || ''} ${requester.last_name || ''}`
                                : `Person ${request.requester_id}`}
                            </button>
                          </div>
                          <div className="flex items-center px-4 py-3">
                            <EditableRequestTarget
                              requestType={request.request_type}
                              currentPersonId={request.requestee_id}
                              agePreferenceTarget={request.age_preference_target}
                              sessionId={sessionId}
                              year={year}
                              requesterCmId={request.requester_id}
                              onChange={(updates) => {
                                // Convert null to 0 for PocketBase (0 means "no value")
                                const pbUpdates: Partial<BunkRequestsResponse> = {}
                                if (updates.requestee_id !== undefined) {
                                  pbUpdates.requestee_id = updates.requestee_id ?? 0
                                }
                                if (updates.age_preference_target !== undefined) {
                                  pbUpdates.age_preference_target = updates.age_preference_target
                                }
                                // When resolving, also mark as resolved
                                if (updates.requestee_id && updates.requestee_id > 0) {
                                  pbUpdates.status = 'resolved' as BunkRequestsStatusOptions
                                  pbUpdates.confidence_score = 1.0
                                }
                                handleValidatedUpdate(request, pbUpdates)
                              }}
                              disabled={request.request_locked || false}
                              originalText={request.original_text}
                              requestedPersonName={request.requested_person_name}
                              parseNotes={request.parse_notes}
                              onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                              personMap={personMap}
                            />
                          </div>
                          <div className="flex items-center gap-1 px-4 py-3">
                            {request.disposition_reason ? (
                              <span
                                className={clsx(
                                  'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                  getDispositionClasses(request.disposition_reason)
                                )}
                                title={request.disposition_reason}
                              >
                                {request.disposition_reason.replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {request.is_reciprocal && (
                              <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
                                Recip
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-center px-4 py-3">
                            <EditablePriority
                              value={request.priority}
                              onChange={(newPriority) => {
                                updateRequestMutation.mutate({
                                  id: request.id,
                                  updates: { priority: newPriority },
                                })
                              }}
                              disabled={false} // Allow priority changes even for resolved requests
                            />
                          </div>
                          <div className="flex items-center justify-center px-4 py-3">
                            <span
                              className={clsx(
                                'flex items-center rounded-full px-2 py-1 text-xs font-medium',
                                getConfidenceColor(request.confidence_score)
                              )}
                            >
                              {getConfidenceIndicator(request.confidence_score)}
                              {(request.confidence_score * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex items-center justify-center px-4 py-3">
                            {getStatusBadge(request.status)}
                          </div>
                          <div className="flex items-center justify-end px-4 py-3">
                            <div className="flex min-w-[100px] items-center justify-end gap-1">
                              {request.status === 'resolved' && request.request_locked && (
                                <button
                                  onClick={() =>
                                    updateRequestMutation.mutate({
                                      id: request.id,
                                      updates: {
                                        request_locked: false,
                                      },
                                    })
                                  }
                                  className="hover:bg-primary/10 text-primary rounded-lg p-1.5 opacity-80 transition-colors hover:opacity-100"
                                  title="Click to unprotect and allow editing"
                                >
                                  <Shield className="h-4 w-4" />
                                </button>
                              )}
                              {hasMultipleSources(request) && (
                                <button
                                  onClick={() => {
                                    setRequestToSplit(request)
                                    setShowSplitModal(true)
                                  }}
                                  className="rounded-lg p-1.5 text-amber-600 opacity-80 transition-colors hover:bg-amber-100 hover:opacity-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
                                  title="Split merged request"
                                >
                                  <Scissors className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={() =>
                                  updateRequestMutation.mutate({
                                    id: request.id,
                                    updates: {
                                      status: 'resolved' as BunkRequestsStatusOptions,
                                      request_locked: true,
                                    },
                                  })
                                }
                                className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 rounded-lg p-1.5 opacity-80 transition-colors hover:opacity-100"
                                title="Approve"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('Are you sure you want to reject this request?')) {
                                    updateRequestMutation.mutate({
                                      id: request.id,
                                      updates: {
                                        status: 'declined' as BunkRequestsStatusOptions,
                                      },
                                    })
                                  }
                                }}
                                className="hover:bg-destructive/10 text-destructive rounded-lg p-1.5 opacity-80 transition-colors hover:opacity-100"
                                title="Reject"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="bg-parchment-50/50 dark:bg-forest-950/20 border-border border-t px-4 py-4">
                            <div className="ml-10 max-w-3xl space-y-3">
                              {/* Merged Request: Show individual sources */}
                              {hasMultipleSources(request) &&
                              expandedMergedRequestId === request.id ? (
                                <>
                                  <div>
                                    <h4 className="text-foreground mb-2 text-sm font-semibold">
                                      Contributing Sources
                                    </h4>
                                    {isLoadingExpandedSourceLinks ? (
                                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading source details...
                                      </div>
                                    ) : expandedSourceLinks.length > 0 ? (
                                      <div className="space-y-3">
                                        {expandedSourceLinks.map((source, idx) => {
                                          return (
                                            <div
                                              key={source.original_request_id || idx}
                                              className={clsx(
                                                'rounded-lg border p-3',
                                                source.is_primary
                                                  ? 'border-primary/30 bg-primary/5'
                                                  : 'border-border bg-muted/20'
                                              )}
                                            >
                                              <div className="mb-1 flex items-center gap-2">
                                                <span className="text-sm font-medium">
                                                  {formatSourceField(source.source_field)}
                                                </span>
                                                {source.is_primary && (
                                                  <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium">
                                                    <Star className="h-3 w-3" />
                                                    Primary
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-muted-foreground text-sm">
                                                {source.original_content ?? (
                                                  <span className="italic">No original text</span>
                                                )}
                                              </p>
                                              <p className="text-muted-foreground bg-muted/50 mt-1.5 rounded px-2 py-1 text-xs">
                                                <span className="font-medium">Parse notes:</span>{' '}
                                                {source.parse_notes ?? (
                                                  <span className="italic">No parse notes</span>
                                                )}
                                              </p>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      // Fallback to request-level data if no source links found
                                      <p className="text-muted-foreground text-sm italic">
                                        Source details not available
                                      </p>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <>
                                  {/* Single Source Request: Original display */}
                                  <div>
                                    <h4 className="text-foreground mb-1 text-sm font-semibold">
                                      Source Field & Content
                                    </h4>
                                    {(() => {
                                      // Get field name(s) with proper fallback chain:
                                      // 1. source_fields (for merged requests - array)
                                      // 2. source_field (single field)
                                      // 3. ai_p1_reasoning.csv_source_field (AI processing)
                                      interface AiReasoningWithField {
                                        csv_source_field?: string
                                      }

                                      const sourceFields = request.source_fields
                                      const singleField = request.source_field
                                      const aiField =
                                        request.ai_p1_reasoning &&
                                        typeof request.ai_p1_reasoning === 'object' &&
                                        'csv_source_field' in request.ai_p1_reasoning
                                          ? ((request.ai_p1_reasoning as AiReasoningWithField)
                                              .csv_source_field ?? '')
                                          : ''

                                      // Determine display field name
                                      let fieldName: string
                                      if (Array.isArray(sourceFields) && sourceFields.length > 1) {
                                        // Merged request: show all source fields combined
                                        fieldName = sourceFields
                                          .map((f) => formatSourceField(f))
                                          .join(' + ')
                                      } else {
                                        // Single source: use first available field
                                        const firstSourceField = Array.isArray(sourceFields)
                                          ? sourceFields[0]
                                          : undefined
                                        const field =
                                          (firstSourceField ?? singleField) || aiField || ''
                                        fieldName = field
                                          ? formatSourceField(field)
                                          : 'Unknown Field'
                                      }

                                      return (
                                        <p className="text-sm">
                                          <span className="font-medium">{fieldName}:</span>{' '}
                                          <span className="text-muted-foreground">
                                            {request.original_text || (
                                              <span className="italic">No original text</span>
                                            )}
                                          </span>
                                        </p>
                                      )
                                    })()}
                                  </div>

                                  {/* Parse Notes - always show for single source */}
                                  <div>
                                    <h4 className="text-foreground mb-1 text-sm font-semibold">
                                      Parse Notes
                                    </h4>
                                    <p className="text-muted-foreground text-sm">
                                      {request.parse_notes || (
                                        <span className="italic">No parse notes</span>
                                      )}
                                    </p>
                                  </div>
                                </>
                              )}

                              {/* Type (moved from column) */}
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">Type:</span>
                                <EditableRequestType
                                  value={request.request_type}
                                  onChange={(newType) => {
                                    const updates: Partial<BunkRequestsResponse> = {
                                      request_type: newType as BunkRequestsResponse['request_type'],
                                    }
                                    if (newType === 'age_preference') {
                                      delete updates.requestee_id
                                    } else {
                                      delete updates.age_preference_target
                                    }
                                    handleValidatedUpdate(request, updates)
                                  }}
                                  disabled={request.request_locked || false}
                                />
                              </div>

                              {/* Metadata */}
                              <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                                <span>Source: {request.source}</span>
                                {request.is_reciprocal && (
                                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
                                    Reciprocal
                                  </span>
                                )}
                                {request.disposition_reason && (
                                  <span
                                    className={clsx(
                                      'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                      getDispositionClasses(request.disposition_reason)
                                    )}
                                  >
                                    {request.disposition_reason.replace(/_/g, ' ')}
                                  </span>
                                )}
                                {request.resolution_method && (
                                  <span>
                                    via{' '}
                                    <span className="font-medium">
                                      {request.resolution_method.replace(/_/g, ' ')}
                                    </span>
                                  </span>
                                )}
                                <span>
                                  Created: {new Date(request.created).toLocaleDateString()}
                                </span>
                              </div>

                              {/* Protection status - show when applicable */}
                              {request.request_locked && request.status === 'resolved' && (
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-primary flex items-center gap-1.5 font-medium">
                                    <Shield className="h-3 w-3" />
                                    Protected due to manual approval
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Help Text - Hidden on mobile to save space, shown on larger screens */}
        <div className="bg-forest-50/50 dark:bg-forest-900/50 border-border hidden border-t p-4 sm:block sm:p-6">
          <div className="flex gap-3">
            <AlertCircle className="text-forest-600 dark:text-forest-400 mt-0.5 h-5 w-5 flex-shrink-0" />
            <div className="text-forest-800 dark:text-forest-200 space-y-3 text-sm">
              <div>
                <p className="mb-1.5 font-medium">Confidence:</p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-forest-700 bg-forest-50 dark:text-forest-300 dark:bg-forest-900/30 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                    <CheckCheck className="mr-1 h-3 w-3" /> 95%+ Auto-resolved
                  </span>
                  <span className="text-forest-600 bg-forest-50/70 dark:text-forest-400 dark:bg-forest-900/20 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                    <CheckCircle className="mr-1 h-3 w-3" /> 85-94% Spot-check
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    &lt;85% Review needed
                  </span>
                </div>
              </div>
              <div>
                <p className="mb-1.5 font-medium">Disposition Reasons:</p>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                    exact match
                  </span>
                  <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    needs review
                  </span>
                  <span className="inline-flex rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">
                    target not attending
                  </span>
                  <span className="bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold">
                    other
                  </span>
                  <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
                    Recip
                  </span>
                </div>
              </div>
              <div>
                <p className="mb-1 font-medium">Review Guidelines:</p>
                <ul className="text-forest-700 dark:text-forest-300 ml-2 list-inside list-disc space-y-1">
                  <li>Focus on pending requests first — these need attention</li>
                  <li>Use "Spot Check (85-94%)" filter to review borderline resolved requests</li>
                  <li>Check parse notes for ambiguous requests that need clarification</li>
                  <li>Use bulk actions to quickly process similar requests</li>
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">Action Meanings:</p>
                <ul className="text-forest-700 dark:text-forest-300 ml-2 list-inside list-disc space-y-1">
                  <li>
                    <strong>Approve (✓):</strong> Confirms match, auto-protects from sync
                  </li>
                  <li>
                    <strong>Reject (✗):</strong> Marks as invalid (wrong match, not attending, etc.)
                  </li>
                  <li>
                    <strong>Protected (🛡️):</strong> Preserves manual approvals across syncs
                  </li>
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
              setShowMergeModal(false)
              setSelectedRequests(new Set())
              toast.success('Requests merged successfully')
            }}
          />
        )}

        {/* Split Request Modal */}
        {showSplitModal && requestToSplit && (
          <SplitRequestModal
            isOpen={showSplitModal}
            onClose={() => {
              setShowSplitModal(false)
              setRequestToSplit(null)
            }}
            request={requestToSplit}
            sourceLinks={sourceLinks}
            isLoadingSourceLinks={isLoadingSourceLinks}
            onSplitComplete={() => {
              setShowSplitModal(false)
              setRequestToSplit(null)
              toast.success('Request split successfully')
            }}
          />
        )}

        {/* Conflict Resolution Dialog */}
        {conflictingRequest && pendingUpdate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-background w-full max-w-md rounded-xl p-6 shadow-lg">
              <div className="mb-4 flex items-center gap-3">
                <AlertCircle className="h-6 w-6 text-amber-500" />
                <h3 className="text-lg font-semibold">Conflict Detected</h3>
              </div>
              <p className="text-muted-foreground mb-4 text-sm">
                This change would create a duplicate request. A request for the same person already
                exists:
              </p>
              <div className="bg-muted mb-4 rounded-lg p-3">
                <div className="text-sm">
                  <span className="font-medium">Type:</span>{' '}
                  {conflictingRequest.request_type.replace('_', ' ')}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Source:</span> {conflictingRequest.source_field}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleCancelConflict}
                  className="border-border hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMergeConflict}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                >
                  <GitMerge className="h-4 w-4" />
                  Merge Requests
                </button>
                <button
                  onClick={handleProceedDespiteConflict}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
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
          'fixed right-0 bottom-0 left-0 z-50',
          'bg-background/95 border-border border-t shadow-lg backdrop-blur-sm',
          'transition-transform duration-300 ease-out will-change-transform',
          selectedRequests.size > 0 ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            {/* Selection info */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="text-foreground flex items-center gap-2 text-sm font-medium">
                <Users className="text-primary h-4 w-4 flex-shrink-0" />
                <span>{selectedRequests.size} selected</span>
              </div>
              {selectedRequests.size > 0 && (
                <span className="text-muted-foreground hidden truncate text-sm sm:block">
                  • {getSelectedNamesPreview()}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkApprove}
                disabled={selectedRequests.size === 0}
                className="bg-forest-600 hover:bg-forest-700 flex min-h-[44px] touch-manipulation items-center gap-2 rounded-xl px-4 py-2 font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Approve</span>
              </button>
              {mergeEligibility.canMerge && (
                <button
                  onClick={() => setShowMergeModal(true)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex min-h-[44px] touch-manipulation items-center gap-2 rounded-xl px-4 py-2 font-medium shadow-sm transition-colors"
                  title="Merge these two requests into one"
                >
                  <GitMerge className="h-4 w-4" />
                  <span className="hidden sm:inline">Merge</span>
                </button>
              )}
              <button
                onClick={handleBulkReject}
                disabled={selectedRequests.size === 0}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 flex min-h-[44px] touch-manipulation items-center gap-2 rounded-xl px-4 py-2 font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Reject</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
