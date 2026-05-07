import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { formatSourceField } from '../utils/formatSourceField'
import { sourceFromField } from '../utils/sourceFromField'
import { invalidateRequestQueries } from '../utils/queryKeys'
import { highlightSourceText } from '../utils/highlightSourceText'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  Filter,
  CheckCircle,
  CheckCheck,
  XCircle,
  ChevronDown,
  ChevronUp,
  Search,
  AlertCircle,
  Shield,
  Plus,
  GitMerge,
  Scissors,
  Users,
  Loader2,
  Star,
  Undo2,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { pb } from '../lib/pocketbase'
import { useUndoStack } from '../hooks/useUndoStack'
// Virtual scrolling removed for better dropdown compatibility
import type {
  BunkRequestsResponse,
  PersonsResponse,
  BunkRequestsStatusOptions,
} from '../types/pocketbase-types'
import clsx from 'clsx'
import {
  getDispositionClasses,
  formatDispositionReason,
  formatReason,
  shouldShowReasonInStatus,
  CONFIDENCE_AUTO_ACCEPT,
  CONFIDENCE_RESOLVED,
  MUTUAL_BADGE_CLASSES,
} from '../utils/dispositionColors'
import EditableRequestType from './EditableRequestType'
import EditableRequestTarget from './EditableRequestTarget'
import { computeTypeUpdate, computeTargetUpdate } from './requestEditableHelpers'
import EditablePriority from './EditablePriority'
import CreateRequestModal from './CreateRequestModal'
import CamperDetailsPanel from './CamperDetailsPanel'
import { CamperRequestSummary } from './CamperRequestSummary'
import MergeRequestsModal from './MergeRequestsModal'
import SplitRequestModal from './SplitRequestModal'
import { ConfirmActionPopover } from './ConfirmActionPopover'
import { useOptimisticValidation } from '../hooks/useOptimisticValidation'
import { formatGradeOrdinal } from '../utils/gradeUtils'

interface RequestReviewPanelProps {
  sessionId: number
  relatedSessionIds?: number[] // Additional session IDs to include (sub-sessions, AG sessions)
  year: number
  sessionName?: string | undefined // Session display name (e.g., "TOC2") — passed to EditableRequestTarget
}

interface FilterState {
  requestTypes: string[]
  statuses: string[]
  searchQuery: string
}

import { sortRequests, DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from './requestSort'
import type { SortColumn } from './requestSort'

export default function RequestReviewPanel({
  sessionId,
  relatedSessionIds = [],
  year,
  sessionName,
}: RequestReviewPanelProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const undoStack = useUndoStack()
  // Task 7: Default filter/sort constants and localStorage persistence
  const storageKey = `kindred-requests-filters-${sessionId}`
  const defaultFilters: FilterState = useMemo(
    () => ({
      requestTypes: [],
      statuses: ['pending'],
      searchQuery: '',
    }),
    []
  )
  // Sort is not persisted across refreshes — staff asked (April 2026) for
  // the grade-grouped view to return on page load even if they clicked a
  // column header during the session.
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortColumn>(DEFAULT_SORT_BY)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(DEFAULT_SORT_ORDER)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [requestToSplit, setRequestToSplit] = useState<BunkRequestsResponse | null>(null)
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [confirmPopover, setConfirmPopover] = useState<{
    action: 'approve' | 'decline'
    anchorRect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
    requestId: string
  } | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<{
    action: 'approve' | 'decline'
    count: number
  } | null>(null)
  const bulkConfirmRef = useRef<HTMLDivElement>(null)
  const bulkConfirmPreviousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (bulkConfirm) {
      bulkConfirmPreviousFocusRef.current = document.activeElement as HTMLElement | null
      const buttons = bulkConfirmRef.current?.querySelectorAll<HTMLElement>('button')
      buttons?.[buttons.length - 1]?.focus()
    } else {
      bulkConfirmPreviousFocusRef.current?.focus()
      bulkConfirmPreviousFocusRef.current = null
    }
  }, [bulkConfirm])

  function openConfirmPopover(
    e: React.MouseEvent<HTMLButtonElement>,
    action: 'approve' | 'decline',
    requestId: string
  ): void {
    e.stopPropagation()
    setConfirmPopover({ action, anchorRect: e.currentTarget.getBoundingClientRect(), requestId })
  }
  const [filters, setFilters] = useState<FilterState>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.filters) {
          return {
            requestTypes: parsed.filters.requestTypes ?? defaultFilters.requestTypes,
            statuses: parsed.filters.statuses ?? defaultFilters.statuses,
            searchQuery: parsed.filters.searchQuery ?? defaultFilters.searchQuery,
          }
        }
      }
    } catch {
      // Ignore parse errors, fall through to defaults
    }
    return defaultFilters
  })

  // Persist filters to localStorage on changes. Sort state is intentionally
  // excluded so the grade-grouped default is restored on every page load.
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          filters: {
            requestTypes: filters.requestTypes,
            statuses: filters.statuses,
            searchQuery: filters.searchQuery,
          },
        })
      )
    } catch {
      // Ignore quota errors
    }
  }, [storageKey, filters])

  // Rehydrate filters/sort when sessionId changes (component stays mounted via Activity)
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    // Session changed — reload filters from localStorage or reset to
    // defaults. Sort is always reset to the grade-grouped default; it is
    // not persisted per the staff-feedback feature.
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.filters) {
          setFilters({
            requestTypes: parsed.filters.requestTypes ?? defaultFilters.requestTypes,
            statuses: parsed.filters.statuses ?? defaultFilters.statuses,
            searchQuery: parsed.filters.searchQuery ?? defaultFilters.searchQuery,
          })
        } else {
          setFilters(defaultFilters)
        }
      } else {
        setFilters(defaultFilters)
      }
    } catch {
      setFilters(defaultFilters)
    }
    setSortBy(DEFAULT_SORT_BY)
    setSortOrder(DEFAULT_SORT_ORDER)
    // Clear selection state from previous session
    setSelectedRequests(new Set())
    setExpandedRows(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Query key only includes server-side filters (sent to PocketBase).
  // Client-side filters (search) are applied in filteredRequests memo.
  const queryKeyFilters = useMemo(
    () => ({
      requestTypes: filters.requestTypes,
      statuses: filters.statuses,
    }),
    [filters.requestTypes, filters.statuses]
  )

  // Staff-review exemption: this fetch intentionally does NOT hard-pin
  // status = "resolved". RequestReviewPanel exists to surface pending
  // and declined rows for staff approval; the status filter is dynamic,
  // driven by `filters.statuses` below.
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['bunk-requests', sessionId, relatedSessionIds, year, queryKeyFilters],
    queryFn: async () => {
      // Build filter for primary session and all related sessions
      const allSessionIds = [sessionId, ...relatedSessionIds]
      const sessionFilter = allSessionIds.map((id) => `session_id = ${id}`).join(' || ')
      // Filter out absorbed requests (those that have been merged into another request)
      let filterStr = `(${sessionFilter}) && year = ${year} && (merged_into = "" || merged_into = null)`

      // Add status filter
      if (filters.statuses.length > 0) {
        const statusFilter = filters.statuses.map((s) => `status = '${s}'`).join(' || ')
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

  // Staff-review exemption: absorbed-request lookup for the split modal.
  // Merged-away rows scoped by merged_into, used by staff to undo a merge.
  // These never feed satisfaction views, alerts, badges, or dots.
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

    return sortRequests(filtered, personMap, sortBy, sortOrder)
  }, [requests, sortBy, sortOrder, personMap, filters.searchQuery])

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
  interface UpdateRequestVars {
    id: string
    updates: Partial<BunkRequestsResponse>
    suppressToast?: boolean
  }

  const updateRequestMutation = useMutation<BunkRequestsResponse, Error, UpdateRequestVars>({
    mutationFn: async ({ id, updates }: UpdateRequestVars) => {
      return pb.collection('bunk_requests').update(id, updates)
    },
    onSuccess: (_data, variables) => {
      invalidateRequestQueries(queryClient)
      if (!variables.suppressToast) {
        toast.success('Request updated')
      }
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
      invalidateRequestQueries(queryClient)
      toast.success('Requests updated')
      setSelectedRequests(new Set())
    },
    onError: () => {
      toast.error('Failed to update requests')
    },
  })

  const handleConfirmCancel = useCallback(() => setConfirmPopover(null), [setConfirmPopover])

  const handleAction = useCallback(
    ({
      id,
      updates,
      labelVerb,
    }: {
      id: string
      updates: Partial<BunkRequestsResponse>
      labelVerb: string
    }) => {
      const req = requests.find((r: BunkRequestsResponse) => r.id === id)
      if (!req) return
      const priorStatus = req.status
      const priorLocked = req.request_locked

      const requesterPerson = personMap.get(req.requester_id)
      const requesterName = requesterPerson
        ? `${requesterPerson.first_name ?? ''} ${requesterPerson.last_name ?? ''}`.trim()
        : `#${req.requester_id}`

      updateRequestMutation.mutate(
        { id, updates, suppressToast: true },
        {
          onSuccess: () => {
            undoStack.push({
              id,
              label: `Reverted ${labelVerb} of ${requesterName}`,
              inverse: async () => {
                await pb
                  .collection('bunk_requests')
                  .update(id, { status: priorStatus, request_locked: priorLocked })
                invalidateRequestQueries(queryClient)
              },
            })
          },
        }
      )
    },
    [requests, personMap, undoStack, updateRequestMutation, queryClient]
  )

  const handleApprove = (id: string) =>
    handleAction({
      id,
      updates: { status: 'resolved' as BunkRequestsStatusOptions, request_locked: true },
      labelVerb: 'approval',
    })

  const handleReject = (id: string) =>
    handleAction({
      id,
      updates: { status: 'declined' as BunkRequestsStatusOptions, request_locked: false },
      labelVerb: 'decline',
    })

  const handleBulkConfirm = useCallback(
    (action: 'approve' | 'decline') => {
      const ids = Array.from(selectedRequests)
      if (ids.length === 0) return
      const priors = ids
        .map((id) => requests.find((r: BunkRequestsResponse) => r.id === id))
        .filter((r): r is BunkRequestsResponse => Boolean(r))
        .map((r) => ({ id: r.id, status: r.status, request_locked: r.request_locked }))
      const updates: Partial<BunkRequestsResponse> =
        action === 'approve'
          ? { status: 'resolved' as BunkRequestsStatusOptions, request_locked: true }
          : { status: 'declined' as BunkRequestsStatusOptions, request_locked: false }
      const labelVerb = action === 'approve' ? 'approval' : 'decline'
      bulkUpdateMutation.mutate(
        { ids, updates },
        {
          onSuccess: () => {
            if (priors.length === 0) return
            undoStack.push({
              id: `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              label: `Reverted ${labelVerb} of ${priors.length} request${priors.length === 1 ? '' : 's'}`,
              inverse: async () => {
                await Promise.all(
                  priors.map((p) =>
                    pb
                      .collection('bunk_requests')
                      .update(p.id, { status: p.status, request_locked: p.request_locked })
                  )
                )
                invalidateRequestQueries(queryClient)
              },
            })
          },
        }
      )
    },
    [selectedRequests, requests, bulkUpdateMutation, undoStack, queryClient]
  )

  // Handlers
  // Collapse a row by id (mirrors the delete branch of toggleRowExpansion).
  // Used by toggleRowExpansion and by the approve/decline confirm handler
  // (feedback #11: after processing a row the expanded state must be cleared
  // so the expandedRows Set doesn't bloat across successive actions).
  const collapseRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setExpandedMergedRequestId((currentId) => (currentId === id ? null : currentId))
  }, [])

  const toggleRowExpansion = useCallback(
    (id: string, request?: BunkRequestsResponse) => {
      setExpandedRows((prev) => {
        if (prev.has(id)) {
          // Delegate to the collapse helper (handled below via collapseRow's
          // own setState path). Returning prev here and calling collapseRow
          // would double-dispatch; inline the delete to keep behavior stable.
          const next = new Set(prev)
          next.delete(id)
          setExpandedMergedRequestId((currentId) => (currentId === id ? null : currentId))
          return next
        }
        const next = new Set(prev)
        next.add(id)
        // Trigger lazy loading for merged requests
        if (request && hasMultipleSources(request)) {
          setExpandedMergedRequestId(id)
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
    setBulkConfirm({ action: 'approve', count: selectedRequests.size })
  }

  const handleBulkReject = () => {
    if (selectedRequests.size === 0) return
    setBulkConfirm({ action: 'decline', count: selectedRequests.size })
  }

  // Validated update handler - checks for conflicts before applying
  const handleValidatedUpdate = useCallback(
    (request: BunkRequestsResponse, updates: Partial<BunkRequestsResponse>) => {
      // Only validate if changing target or type (potential conflict fields)
      if (updates.requestee_id !== undefined || updates.request_type !== undefined) {
        const newRequesteeId =
          updates.requestee_id !== undefined ? updates.requestee_id : request.requestee_id
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

            {/* Create Button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex touch-manipulation items-center gap-2 px-3 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </button>

            {/* Undo Button — appears when undo stack is non-empty */}
            {undoStack.canUndo && (
              <button
                onClick={() => {
                  const entry = undoStack.pop()
                  if (!entry) return
                  entry.inverse().then(
                    () => {
                      toast.success(entry.label)
                    },
                    () => {
                      // On failure, push it back so user can retry
                      undoStack.push(entry)
                      toast.error('Undo failed — try again')
                    }
                  )
                }}
                disabled={updateRequestMutation.isPending}
                className="btn-secondary flex touch-manipulation items-center gap-1.5 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                title={undoStack.peek()?.label ?? 'Undo last action'}
                aria-label={`Undo (${undoStack.stackSize})`}
              >
                <Undo2 className="h-4 w-4" />
                <span>Undo ({undoStack.stackSize})</span>
              </button>
            )}

            {/* Total count */}
            <div className="text-muted-foreground hidden flex-shrink-0 text-xs sm:block">
              {sortedRequests.length} total
            </div>
          </div>
        </div>

        {/* Filter Bar — always visible, single row */}
        <div className="border-border border-b px-4 py-2">
          <div className="flex flex-wrap items-center gap-4">
            {/* Status checkboxes — first */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-semibold">Status:</span>
              {['pending', 'declined', 'resolved'].map((status) => {
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
                      'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-all',
                      isSelected
                        ? 'bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700'
                        : 'text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground bg-transparent'
                    )}
                  >
                    {isSelected && <CheckCircle className="mr-1 inline h-3 w-3" />}
                    {status}
                  </button>
                )
              })}
            </div>

            {/* Request type checkboxes — second */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-semibold">Type:</span>
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
                      'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                      isSelected
                        ? 'bg-forest-100 dark:bg-forest-900/50 text-forest-800 dark:text-forest-200 border-forest-300 dark:border-forest-700'
                        : 'text-muted-foreground border-border hover:border-forest-300 dark:hover:border-forest-700 hover:text-foreground bg-transparent'
                    )}
                  >
                    {isSelected && <CheckCircle className="mr-1 inline h-3 w-3" />}
                    {getRequestTypeLabel(type)}
                  </button>
                )
              })}
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
              <div className="text-muted-foreground px-4 py-3 text-left text-sm font-medium">
                Type
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
                      <div key={request.id} data-request-row-id={request.id}>
                        <div
                          className="request-card-mobile hover:bg-muted/50 cursor-pointer transition-colors"
                          data-testid="request-card-mobile"
                          onClick={() => toggleRowExpansion(request.id, request)}
                        >
                          {/* Checkbox */}
                          <div className="card-checkbox" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedRequests.has(request.id)}
                              onChange={() => toggleRequestSelection(request.id)}
                              className="h-5 w-5 rounded"
                            />
                          </div>

                          {/* Main info: Requester name and type */}
                          <div className="card-main">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedCamperId(String(request.requester_id))
                                }}
                                className="hover:text-primary min-w-0 text-left font-medium transition-colors hover:underline"
                              >
                                {requester
                                  ? `${requester.first_name || ''} ${requester.last_name || ''}`
                                  : `Person ${request.requester_id}`}
                                {requester?.grade != null && requester.grade > 0 && (
                                  <span className="text-muted-foreground ml-1 text-xs font-normal">
                                    ({formatGradeOrdinal(requester.grade)})
                                  </span>
                                )}
                              </button>
                              {request.is_reciprocal && (
                                <span className={MUTUAL_BADGE_CLASSES}>mutual</span>
                              )}
                            </div>
                            <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <EditableRequestType
                                value={request.request_type}
                                onChange={(newType) =>
                                  handleValidatedUpdate(
                                    request,
                                    computeTypeUpdate(
                                      newType as BunkRequestsResponse['request_type']
                                    )
                                  )
                                }
                                disabled={request.request_locked}
                              />
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
                            <div className="flex flex-col items-end gap-0.5">
                              {getStatusBadge(request.status)}
                              {shouldShowReasonInStatus(
                                request.status,
                                request.disposition_reason
                              ) && (
                                <span
                                  data-testid="status-reason-line"
                                  className="text-muted-foreground max-w-[8rem] truncate text-right text-[11px]"
                                >
                                  {formatReason(request.disposition_reason)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Request target info */}
                          <div className="card-request" onClick={(e) => e.stopPropagation()}>
                            <EditableRequestTarget
                              requestType={request.request_type}
                              currentPersonId={request.requestee_id}
                              agePreferenceTarget={request.age_preference_target}
                              sessionId={sessionId}
                              year={year}
                              requesterCmId={request.requester_id}
                              onChange={(updates) => {
                                handleValidatedUpdate(request, computeTargetUpdate(updates))
                              }}
                              disabled={request.request_locked}
                              originalText={request.original_text}
                              requestedPersonName={request.requested_person_name}
                              parseNotes={request.parse_notes}
                              onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                              personMap={personMap}
                              sessionName={sessionName}
                            />
                            {(() => {
                              const targetPerson =
                                request.requestee_id > 0
                                  ? personMap.get(request.requestee_id)
                                  : undefined
                              return targetPerson?.grade != null && targetPerson.grade > 0 ? (
                                <span className="text-muted-foreground ml-1 text-xs">
                                  ({formatGradeOrdinal(targetPerson.grade)})
                                </span>
                              ) : null
                            })()}
                          </div>

                          {/* Actions */}
                          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
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
                              onClick={(e) => openConfirmPopover(e, 'approve', request.id)}
                              className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 touch-manipulation rounded-lg p-2 transition-colors"
                              title="Approve"
                            >
                              <CheckCircle className="h-5 w-5" />
                            </button>
                            <button
                              onClick={(e) => openConfirmPopover(e, 'decline', request.id)}
                              className="hover:bg-destructive/10 text-destructive touch-manipulation rounded-lg p-2 transition-colors"
                              title="Reject"
                            >
                              <XCircle className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded details - mobile */}
                        {isExpanded && (
                          <div
                            className="bg-parchment-50/50 dark:bg-forest-950/20 border-border border-b px-4 py-3"
                            data-testid="request-row-expanded-content"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                                <span className="text-muted-foreground">
                                  {request.source_field
                                    ? sourceFromField(request.source_field)
                                    : request.source}
                                </span>
                              </div>
                              {request.original_text && (
                                <div>
                                  <span className="font-medium">Original:</span>{' '}
                                  <span className="text-muted-foreground">
                                    {highlightSourceText(
                                      request.original_text,
                                      request.source_fragment
                                    )}
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
                            <div className="mt-3 border-t pt-3">
                              <CamperRequestSummary
                                requesterCmId={request.requester_id}
                                year={year}
                                currentRequestId={request.id}
                                requesterName={
                                  requester
                                    ? `${requester.first_name} ${requester.last_name}`.trim()
                                    : undefined
                                }
                              />
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
                        data-request-row-id={request.id}
                        className={clsx(
                          'cursor-pointer border-b transition-colors',
                          selectedRequests.has(request.id)
                            ? 'bg-primary/5 hover:bg-primary/10'
                            : 'hover:bg-muted/50'
                        )}
                        onClick={() => toggleRowExpansion(request.id, request)}
                      >
                        <div className="request-table-grid">
                          <div
                            className="flex items-center justify-center px-3 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedRequests.has(request.id)}
                              onChange={() => toggleRequestSelection(request.id)}
                              className="rounded"
                            />
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 px-4 py-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedCamperId(String(request.requester_id))
                              }}
                              className="hover:text-primary cursor-pointer truncate text-left font-medium transition-colors hover:underline"
                              title="View camper details"
                            >
                              {requester
                                ? `${requester.first_name || ''} ${requester.last_name || ''}`
                                : `Person ${request.requester_id}`}
                              {requester?.grade != null && requester.grade > 0 && (
                                <span className="text-muted-foreground ml-1 text-xs font-normal">
                                  ({formatGradeOrdinal(requester.grade)})
                                </span>
                              )}
                            </button>
                            {request.is_reciprocal && (
                              <span className={MUTUAL_BADGE_CLASSES}>mutual</span>
                            )}
                          </div>
                          <div
                            className="flex items-center px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EditableRequestTarget
                              requestType={request.request_type}
                              currentPersonId={request.requestee_id}
                              agePreferenceTarget={request.age_preference_target}
                              sessionId={sessionId}
                              year={year}
                              requesterCmId={request.requester_id}
                              onChange={(updates) => {
                                handleValidatedUpdate(request, computeTargetUpdate(updates))
                              }}
                              disabled={request.request_locked}
                              originalText={request.original_text}
                              requestedPersonName={request.requested_person_name}
                              parseNotes={request.parse_notes}
                              onViewCamper={(personCmId) => setSelectedCamperId(String(personCmId))}
                              personMap={personMap}
                              sessionName={sessionName}
                            />
                            {(() => {
                              const targetPerson =
                                request.requestee_id > 0
                                  ? personMap.get(request.requestee_id)
                                  : undefined
                              return targetPerson?.grade != null && targetPerson.grade > 0 ? (
                                <span className="text-muted-foreground ml-1 text-xs">
                                  ({formatGradeOrdinal(targetPerson.grade)})
                                </span>
                              ) : null
                            })()}
                          </div>
                          <div
                            className="flex items-center px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EditableRequestType
                              value={request.request_type}
                              onChange={(newType) =>
                                handleValidatedUpdate(
                                  request,
                                  computeTypeUpdate(newType as BunkRequestsResponse['request_type'])
                                )
                              }
                              disabled={request.request_locked}
                            />
                          </div>
                          <div
                            className="flex items-center justify-center px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                          <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-3">
                            {getStatusBadge(request.status)}
                            {shouldShowReasonInStatus(
                              request.status,
                              request.disposition_reason
                            ) && (
                              <span
                                data-testid="status-reason-line"
                                className="text-muted-foreground max-w-full truncate text-[11px]"
                              >
                                {formatReason(request.disposition_reason)}
                              </span>
                            )}
                          </div>
                          <div
                            className="flex items-center justify-end px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                                onClick={(e) => openConfirmPopover(e, 'approve', request.id)}
                                className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 rounded-lg p-1.5 opacity-80 transition-colors hover:opacity-100"
                                title="Approve"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={(e) => openConfirmPopover(e, 'decline', request.id)}
                                className="hover:bg-destructive/10 text-destructive rounded-lg p-1.5 opacity-80 transition-colors hover:opacity-100"
                                title="Reject"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div
                            className="bg-parchment-50/50 dark:bg-forest-950/20 border-border border-t px-4 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="ml-10 grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
                              <div className="max-w-3xl space-y-3">
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
                                                  {source.original_content?.trim() ? (
                                                    source.original_content
                                                  ) : (
                                                    <span className="italic">No original text</span>
                                                  )}
                                                </p>
                                                <p className="text-muted-foreground bg-muted/50 mt-1.5 rounded px-2 py-1 text-xs">
                                                  <span className="font-medium">
                                                    Processing Notes (AI Generated):
                                                  </span>{' '}
                                                  {source.parse_notes?.trim() ? (
                                                    source.parse_notes
                                                  ) : (
                                                    <span className="italic">
                                                      No AI intent notes
                                                    </span>
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
                                        Bunking Related Notes
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
                                        if (
                                          Array.isArray(sourceFields) &&
                                          sourceFields.length > 1
                                        ) {
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
                                              {highlightSourceText(
                                                request.original_text,
                                                request.source_fragment
                                              ) || <span className="italic">No original text</span>}
                                            </span>
                                          </p>
                                        )
                                      })()}
                                    </div>

                                    {/* Processing Notes - always show for single source */}
                                    <div>
                                      <h4 className="text-foreground mb-1 text-sm font-semibold">
                                        Processing Notes (AI Generated)
                                      </h4>
                                      <p className="text-muted-foreground text-sm">
                                        {request.parse_notes || (
                                          <span className="italic">No AI intent notes</span>
                                        )}
                                      </p>
                                    </div>
                                  </>
                                )}

                                {/* Metadata */}
                                <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                                  <span>
                                    Source:{' '}
                                    {request.source_field
                                      ? sourceFromField(request.source_field)
                                      : request.source}
                                  </span>
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
                              <div className="max-w-xl">
                                <CamperRequestSummary
                                  requesterCmId={request.requester_id}
                                  year={year}
                                  currentRequestId={request.id}
                                  requesterName={
                                    requester
                                      ? `${requester.first_name} ${requester.last_name}`.trim()
                                      : undefined
                                  }
                                />
                              </div>
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
                  {(['exact_match', 'needs_review', 'target_not_attending', 'other'] as const).map(
                    (reason) => (
                      <span
                        key={reason}
                        className={clsx(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          getDispositionClasses(reason)
                        )}
                      >
                        {formatDispositionReason(reason)}
                      </span>
                    )
                  )}
                  <span className={MUTUAL_BADGE_CLASSES}>mutual</span>
                </div>
              </div>
              <div>
                <p className="mb-1 font-medium">Review Guidelines:</p>
                <ul className="text-forest-700 dark:text-forest-300 ml-2 list-inside list-disc space-y-1">
                  <li>Focus on pending requests first — these need attention</li>
                  <li>Filter by status to review resolved or declined requests</li>
                  <li>Check AI intent notes for ambiguous requests that need clarification</li>
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

      <ConfirmActionPopover
        isOpen={!!confirmPopover}
        anchorRect={confirmPopover?.anchorRect ?? { top: 0, left: 0, width: 0, height: 0 }}
        action={confirmPopover?.action ?? 'approve'}
        onConfirm={() => {
          if (!confirmPopover) return
          const { action, requestId } = confirmPopover
          if (action === 'approve') {
            handleApprove(requestId)
          } else {
            handleReject(requestId)
          }
          collapseRow(requestId)
          setConfirmPopover(null)
        }}
        onCancel={handleConfirmCancel}
      />

      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setBulkConfirm(null)} />
          <div
            ref={bulkConfirmRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-label"
            className="bg-card border-border relative mx-4 w-full max-w-sm rounded-xl border p-6 shadow-xl"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBulkConfirm(null)
                return
              }
              if (e.key === 'Tab') {
                const buttons = Array.from(
                  bulkConfirmRef.current?.querySelectorAll<HTMLElement>('button') ?? []
                )
                if (buttons.length === 0) return
                e.preventDefault()
                const idx = buttons.indexOf(document.activeElement as HTMLElement)
                if (e.shiftKey) {
                  buttons[idx <= 0 ? buttons.length - 1 : idx - 1]?.focus()
                } else {
                  buttons[idx >= buttons.length - 1 ? 0 : idx + 1]?.focus()
                }
              }
            }}
          >
            <p id="bulk-confirm-label" className="text-foreground mb-5 text-base font-medium">
              {bulkConfirm.action === 'approve'
                ? `Confirm approving ${bulkConfirm.count} request${bulkConfirm.count === 1 ? '' : 's'}?`
                : `Confirm declining ${bulkConfirm.count} request${bulkConfirm.count === 1 ? '' : 's'}?`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                className="text-muted-foreground hover:bg-muted rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleBulkConfirm(bulkConfirm.action)
                  setBulkConfirm(null)
                }}
                className={
                  bulkConfirm.action === 'approve'
                    ? 'bg-forest-600 hover:bg-forest-700 dark:bg-forest-700 dark:hover:bg-forest-600 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors'
                    : 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'
                }
              >
                {bulkConfirm.action === 'approve' ? 'Approve' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
