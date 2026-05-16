import { useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  GitCompare,
  ArrowLeftRight,
  Users,
  UserCheck,
  Home,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  LayoutGrid,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Percent,
  Table2,
  Download,
} from 'lucide-react'
import clsx from 'clsx'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { pb } from '../lib/pocketbase'
import type {
  SavedScenariosResponse,
  BunkAssignmentsDraftResponse,
  BunkAssignmentsResponse,
  PersonsResponse,
  BunksResponse,
  BunkPlansResponse,
  CampSessionsResponse,
  LockedGroupsResponse,
  LockedGroupMembersResponse,
  AttendeesResponse,
} from '../types/pocketbase-types'
import { useYear } from '../hooks/useCurrentYear'
import { useAuth } from '../contexts/AuthContext'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { queryKeys, userDataOptions, syncDataOptions } from '../utils/queryKeys'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { findSessionByUrlSegment } from '../utils/sessionUtils'
import {
  compareCamperByName,
  sortCampersByName,
  getAvailableBunkAreas,
  type BunkArea,
  type LockGroupSummary,
} from '../utils/scenarioComparisonUtils'
import { solverService } from '../services/solver'
import { QueryGuard } from '../components/QueryGuard'
import type { Session } from '../types/app-types'
import { buildCsvContent, downloadCsv, slugify, todayIso } from '../utils/csvExport'
import { buildMovedRows, MOVED_CSV_HEADERS } from '../utils/csvExportHelpers'

// Expanded member type for locked_group_members with attendee.person (double-expanded).
type ExpandedGroupMember = LockedGroupMembersResponse & {
  expand?: {
    attendee?: AttendeesResponse & {
      expand?: {
        person?: { id: string; cm_id: number }
      }
    }
  }
}

/**
 * Fetch locked groups and their members for a given scenario+session, then
 * return a Map of personCmId → LockGroupSummary.
 */
// Returns serializable entries (Array<[cmId, summary]>) — NOT a Map.
// React Query's default structural sharing strips the Map prototype on
// refetch, so we keep the cache value as a plain array and rebuild the
// Map at the hook boundary.
async function fetchGroupEntries(
  scenarioId: string,
  sessionPbId: string,
  year: number
): Promise<Array<[number, LockGroupSummary]>> {
  const groups = await pb.collection('locked_groups').getFullList<LockedGroupsResponse>({
    filter: pb.filter('scenario = {:scenario} && session = {:session} && year = {:year}', {
      scenario: scenarioId,
      session: sessionPbId,
      year,
    }),
    sort: 'created',
  })

  if (groups.length === 0) return []

  const groupIds = groups.map((g) => g.id)
  const filterParts = groupIds.map((_, i) => `group = {:g${i}}`)
  const filterParams = groupIds.reduce((acc, id, i) => ({ ...acc, [`g${i}`]: id }), {})
  const filter = pb.filter(filterParts.join(' || '), filterParams)

  const members = await pb.collection('locked_group_members').getFullList<ExpandedGroupMember>({
    filter,
    expand: 'attendee,attendee.person',
  })

  // Build group id → summary
  const summaryById = new Map<string, LockGroupSummary>()
  for (const g of groups) {
    summaryById.set(g.id, { id: g.id, name: g.name, color: g.color, memberCmIds: [] })
  }
  for (const m of members) {
    // Use the double-expanded person.cm_id — the expand key is 'attendee,attendee.person',
    // so cm_id is guaranteed present on the typed expand (unlike person_id which is a
    // top-level field whose PocketBase serialization is version-specific).
    const personCmId = m.expand?.attendee?.expand?.person?.cm_id
    const groupSummary = summaryById.get(m.group)
    if (personCmId && groupSummary) {
      groupSummary.memberCmIds.push(personCmId)
    }
  }

  // Flatten to entries — one entry per (cm_id, group) pair.
  const entries: Array<[number, LockGroupSummary]> = []
  for (const summary of summaryById.values()) {
    for (const cmId of summary.memberCmIds) {
      entries.push([cmId, summary])
    }
  }
  return entries
}

// Types for comparison
interface CamperAssignment {
  personId: string
  personCmId: number
  name: string
  firstName: string
  lastName: string
  age: number
  grade: number
  gender: string
  bunkId: string
  bunkName: string
  bunkPlanId: string
}

interface ComparisonResult {
  moved: Array<{
    camper: CamperAssignment
    fromBunk: { id: string; name: string }
    toBunk: { id: string; name: string }
  }>
  newlyAssigned: Array<{
    camper: CamperAssignment
    toBunk: { id: string; name: string }
  }>
  newlyUnassigned: Array<{
    camper: CamperAssignment
    fromBunk: { id: string; name: string }
  }>
  unchanged: CamperAssignment[]
  metrics: {
    totalCampers: { left: number; right: number }
    movedCount: number
    newlyAssignedCount: number
    newlyUnassignedCount: number
    unchangedCount: number
    changePercentage: number
  }
}

interface BunkComparison {
  bunkId: string
  bunkName: string
  leftCampers: CamperAssignment[]
  rightCampers: CamperAssignment[]
  movedIn: Array<{ camper: CamperAssignment; fromBunk: string }>
  movedOut: Array<{ camper: CamperAssignment; toBunk: string }>
}

// Validation score types
export interface ValidationStatistics {
  total_requests: number
  satisfied_requests: number
  request_satisfaction_rate: number
  // Stage 3a material (hard) parent requests — raw counts kept for drill-down.
  material_parent_requests: number
  satisfied_material_parent_requests: number
  material_parent_request_satisfaction_rate: number
  campers_with_unsatisfied_material_parent_requests: number
  // Stage 3a best-effort (soft) parent requests — not shown on score card.
  best_effort_parent_requests: number
  satisfied_best_effort_parent_requests: number
  best_effort_parent_request_satisfaction_rate: number
  // Staff fields, distinct from parent.
  staff_requests: number
  satisfied_staff_requests: number
  staff_request_satisfaction_rate: number
  campers_with_unsatisfied_staff_requests: number
  negative_request_violations: number
  assigned_campers: number
  unassigned_campers: number
  isolation_risks: number
  // TG-6: camper-level two-tier MP coverage.
  mp_campers_total: number
  mp_campers_with_at_least_one_satisfied: number
  mp_campers_with_all_satisfied: number
}

export interface ValidationResult {
  statistics: ValidationStatistics
  issues: Array<{ severity: string; type: string; message: string }>
}

type ViewMode = 'split' | 'changes'
type ChangeFilter = 'all' | 'moved' | 'newly-assigned' | 'newly-unassigned'

/** Returns the export button label that matches the active change filter. */
// eslint-disable-next-line react-refresh/only-export-components -- pure utility, exported for tests
export function getExportButtonLabel(filter: 'moved' | 'all'): string {
  return filter === 'moved' ? 'Export Moved' : 'Export All'
}

/** Returns the export button tooltip that matches the active change filter. */
// eslint-disable-next-line react-refresh/only-export-components -- pure utility, exported for tests
export function getExportButtonTitle(filter: 'moved' | 'all'): string {
  return filter === 'moved' ? 'Export moved campers to CSV' : 'Export all campers to CSV'
}

function useGroupMap(
  scenarioId: string,
  sessionPbId: string,
  currentYear: number,
  user: ReturnType<typeof useAuth>['user']
) {
  const { data: groupEntries = [] } = useQuery({
    queryKey: queryKeys.lockedGroups(scenarioId, sessionPbId, currentYear),
    queryFn: () => fetchGroupEntries(scenarioId, sessionPbId, currentYear),
    ...userDataOptions,
    enabled: !!user && scenarioId !== 'production' && scenarioId !== '' && !!sessionPbId,
  })
  // Rebuild Map at hook boundary so the page can use `.get`. Entries are
  // serializable; the Map is a render-time derived value.
  return useMemo(() => new Map(groupEntries), [groupEntries])
}

export default function ScenarioComparisonPage() {
  const { sessionId: sessionUrlSegment } = useParams<{ sessionId: string }>()
  const currentYear = useYear()
  const { user, isLoading: authLoading } = useAuth()
  const { fetchWithAuth } = useApiWithAuth()

  // State for scenario selection
  const [leftScenarioId, setLeftScenarioId] = useState<string>('production')
  const [rightScenarioId, setRightScenarioId] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all')
  const [selectedBunkArea, setSelectedBunkArea] = useState<BunkArea>('all')

  // Fetch all sessions for the current year to resolve the URL segment
  const { data: allSessions = [] } = useQuery({
    queryKey: queryKeys.sessions(currentYear),
    queryFn: async () => {
      const result = await pb.collection('camp_sessions').getFullList<CampSessionsResponse>({
        filter: `year = ${currentYear} && (session_type = "main" || session_type = "embedded")`,
        sort: 'name',
      })
      // Convert to Session type
      return result.map((s) => ({
        id: s.id,
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type,
        start_date: s.start_date,
        end_date: s.end_date,
        year: s.year,
        parent_id: s.parent_id,
      })) as Session[]
    },
    ...syncDataOptions,
    enabled: !!user,
  })

  // Resolve session from URL segment
  const session = useMemo(() => {
    if (!sessionUrlSegment || allSessions.length === 0) return null
    return findSessionByUrlSegment(allSessions, sessionUrlSegment)
  }, [sessionUrlSegment, allSessions])

  // Get session CM ID for queries
  const sessionCmId = session?.cm_id ?? 0

  // Fetch saved scenarios for this session
  const { data: scenarios = [] } = useQuery({
    queryKey: queryKeys.savedScenarios(sessionCmId, currentYear),
    queryFn: async () => {
      const result = await pb.collection('saved_scenarios').getFullList<SavedScenariosResponse>({
        filter: `session.cm_id = ${sessionCmId} && year = ${currentYear}`,
        sort: '-created',
        expand: 'session',
      })
      return result
    },
    ...userDataOptions,
    enabled: !!user && sessionCmId > 0,
  })

  // Fetch production assignments (bunk_assignments)
  const { data: productionAssignments = [] } = useQuery({
    queryKey: ['production-assignments', sessionCmId, currentYear],
    queryFn: async () => {
      const result = await pb.collection('bunk_assignments').getFullList<
        BunkAssignmentsResponse<{
          person: PersonsResponse
          bunk: BunksResponse
          bunk_plan: BunkPlansResponse
        }>
      >({
        filter: pb.filter('session.cm_id = {:sessionCmId} && year = {:year}', {
          sessionCmId,
          year: currentYear,
        }),
        expand: 'person,bunk,bunk_plan',
      })
      return result
    },
    ...syncDataOptions,
    enabled: !!user && sessionCmId > 0,
  })

  // Fetch draft assignments for selected scenario
  const { data: leftDraftAssignments = [] } = useQuery({
    queryKey: ['draft-assignments', leftScenarioId, sessionCmId, currentYear],
    queryFn: async () => {
      if (leftScenarioId === 'production') return []
      const result = await pb.collection('bunk_assignments_draft').getFullList<
        BunkAssignmentsDraftResponse<{
          person: PersonsResponse
          bunk: BunksResponse
          bunk_plan: BunkPlansResponse
        }>
      >({
        filter: pb.filter('scenario = {:scenario} && year = {:year}', {
          scenario: leftScenarioId,
          year: currentYear,
        }),
        expand: 'person,bunk,bunk_plan',
      })
      return result
    },
    ...userDataOptions,
    enabled: !!user && leftScenarioId !== 'production' && leftScenarioId !== '',
  })

  const { data: rightDraftAssignments = [] } = useQuery({
    queryKey: ['draft-assignments', rightScenarioId, sessionCmId, currentYear],
    queryFn: async () => {
      if (rightScenarioId === 'production') return []
      const result = await pb.collection('bunk_assignments_draft').getFullList<
        BunkAssignmentsDraftResponse<{
          person: PersonsResponse
          bunk: BunksResponse
          bunk_plan: BunkPlansResponse
        }>
      >({
        filter: pb.filter('scenario = {:scenario} && year = {:year}', {
          scenario: rightScenarioId,
          year: currentYear,
        }),
        expand: 'person,bunk,bunk_plan',
      })
      return result
    },
    ...userDataOptions,
    enabled: !!user && rightScenarioId !== 'production' && rightScenarioId !== '',
  })

  // PocketBase session ID (needed for locked-group queries)
  const sessionPbId = session?.id ?? ''

  // Fetch locked-group → member maps for each scenario.
  // Production has no locked groups (they are scenario-specific draft data).
  const leftGroupMap = useGroupMap(leftScenarioId, sessionPbId, currentYear, user)
  const rightGroupMap = useGroupMap(rightScenarioId, sessionPbId, currentYear, user)

  // Fetch validation scores for both scenarios
  const isReady =
    Boolean(leftScenarioId) && Boolean(rightScenarioId) && leftScenarioId !== rightScenarioId

  const {
    data: leftValidation,
    isLoading: isLeftValidationLoading,
    error: leftValidationError,
  } = useQuery<ValidationResult>({
    queryKey: queryKeys.scenarioValidation(leftScenarioId, sessionCmId, currentYear),
    queryFn: async (): Promise<ValidationResult> => {
      const scenarioId = leftScenarioId === 'production' ? undefined : leftScenarioId
      const result = await solverService.validateBunking(
        sessionCmId.toString(),
        currentYear,
        scenarioId,
        fetchWithAuth
      )
      return result as unknown as ValidationResult
    },
    ...userDataOptions,
    enabled: Boolean(user) && sessionCmId > 0 && isReady,
  })

  const {
    data: rightValidation,
    isLoading: isRightValidationLoading,
    error: rightValidationError,
  } = useQuery<ValidationResult>({
    queryKey: queryKeys.scenarioValidation(rightScenarioId, sessionCmId, currentYear),
    queryFn: async (): Promise<ValidationResult> => {
      const scenarioId = rightScenarioId === 'production' ? undefined : rightScenarioId
      const result = await solverService.validateBunking(
        sessionCmId.toString(),
        currentYear,
        scenarioId,
        fetchWithAuth
      )
      return result as unknown as ValidationResult
    },
    ...userDataOptions,
    enabled: Boolean(user) && sessionCmId > 0 && isReady,
  })

  const isValidationLoading = isLeftValidationLoading || isRightValidationLoading
  const validationError = leftValidationError ?? rightValidationError ?? null

  // Type for expanded assignment
  interface ExpandedAssignment {
    expand?: {
      person?: PersonsResponse
      bunk?: BunksResponse
      bunk_plan?: BunkPlansResponse
    }
    bunk_plan?: string
  }

  // Transform assignments to unified format (stable callback since it's a pure function)
  const normalizeAssignments = useCallback(
    (assignments: ExpandedAssignment[]): CamperAssignment[] => {
      return assignments
        .filter((a) => a.expand?.person && a.expand.bunk)
        .map((a) => {
          const person = a.expand?.person
          const bunk = a.expand?.bunk
          if (!person || !bunk) {
            // This should never happen due to the filter above, but TypeScript needs the guard
            throw new Error('Missing expand data')
          }
          const firstName = person.preferred_name || person.first_name
          return {
            personId: person.id,
            personCmId: person.cm_id,
            name: `${firstName} ${person.last_name}`,
            firstName,
            lastName: person.last_name,
            age: person.age ?? 0,
            grade: person.grade ?? 0,
            gender: person.gender ?? '',
            bunkId: bunk.id,
            bunkName: bunk.name,
            bunkPlanId: a.bunk_plan ?? '',
          }
        })
    },
    []
  )

  // Get left and right assignments
  const leftAssignments = useMemo(() => {
    if (leftScenarioId === 'production') {
      return normalizeAssignments(productionAssignments as ExpandedAssignment[])
    }
    return normalizeAssignments(leftDraftAssignments as ExpandedAssignment[])
  }, [leftScenarioId, productionAssignments, leftDraftAssignments, normalizeAssignments])

  const rightAssignments = useMemo(() => {
    if (rightScenarioId === 'production') {
      return normalizeAssignments(productionAssignments as ExpandedAssignment[])
    }
    return normalizeAssignments(rightDraftAssignments as ExpandedAssignment[])
  }, [rightScenarioId, productionAssignments, rightDraftAssignments, normalizeAssignments])

  // Lookup Maps used by both `comparison` below and by FriendGroupPopover
  // to resolve friend-group members. Keyed by personCmId.
  const leftByPerson = useMemo(
    () => new Map(leftAssignments.map((a) => [a.personCmId, a])),
    [leftAssignments]
  )
  const rightByPerson = useMemo(
    () => new Map(rightAssignments.map((a) => [a.personCmId, a])),
    [rightAssignments]
  )

  // Compute comparison result
  const comparison = useMemo((): ComparisonResult => {
    const moved: ComparisonResult['moved'] = []
    const newlyAssigned: ComparisonResult['newlyAssigned'] = []
    const newlyUnassigned: ComparisonResult['newlyUnassigned'] = []
    const unchanged: CamperAssignment[] = []

    // Check all campers in left scenario
    for (const [personCmId, leftCamper] of leftByPerson) {
      const rightCamper = rightByPerson.get(personCmId)

      if (!rightCamper) {
        // Camper was assigned in left but not in right (became unassigned)
        newlyUnassigned.push({
          camper: leftCamper,
          fromBunk: { id: leftCamper.bunkId, name: leftCamper.bunkName },
        })
      } else if (leftCamper.bunkId !== rightCamper.bunkId) {
        // Camper moved to different bunk
        moved.push({
          camper: rightCamper,
          fromBunk: { id: leftCamper.bunkId, name: leftCamper.bunkName },
          toBunk: { id: rightCamper.bunkId, name: rightCamper.bunkName },
        })
      } else {
        // Camper unchanged
        unchanged.push(leftCamper)
      }
    }

    // Check for newly assigned campers in right scenario
    for (const [personCmId, rightCamper] of rightByPerson) {
      if (!leftByPerson.has(personCmId)) {
        newlyAssigned.push({
          camper: rightCamper,
          toBunk: { id: rightCamper.bunkId, name: rightCamper.bunkName },
        })
      }
    }

    const totalChanges = moved.length + newlyAssigned.length + newlyUnassigned.length
    const totalInvolved = Math.max(leftByPerson.size, rightByPerson.size)

    // Sort change lists alphabetically by camper name (last, then first) so both
    // sides of the comparison present a stable, scannable order.
    const sortByCamper = <T extends { camper: CamperAssignment }>(arr: T[]): T[] =>
      arr.slice().sort((a, b) => compareCamperByName(a.camper, b.camper))

    return {
      moved: sortByCamper(moved),
      newlyAssigned: sortByCamper(newlyAssigned),
      newlyUnassigned: sortByCamper(newlyUnassigned),
      unchanged: sortCampersByName(unchanged),
      metrics: {
        totalCampers: {
          left: leftByPerson.size,
          right: rightByPerson.size,
        },
        movedCount: moved.length,
        newlyAssignedCount: newlyAssigned.length,
        newlyUnassignedCount: newlyUnassigned.length,
        unchangedCount: unchanged.length,
        changePercentage: totalInvolved > 0 ? Math.round((totalChanges / totalInvolved) * 100) : 0,
      },
    }
  }, [leftByPerson, rightByPerson])

  // Get all unique bunks for split view
  const allBunks = useMemo(() => {
    const bunkMap = new Map<string, { id: string; name: string; gender: string }>()

    ;[...leftAssignments, ...rightAssignments].forEach((a) => {
      if (!bunkMap.has(a.bunkId)) {
        const gender = a.bunkName.startsWith('B-')
          ? 'M'
          : a.bunkName.startsWith('G-')
            ? 'F'
            : a.bunkName.startsWith('AG-')
              ? 'Mixed'
              : 'Unknown'
        bunkMap.set(a.bunkId, { id: a.bunkId, name: a.bunkName, gender })
      }
    })

    return Array.from(bunkMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [leftAssignments, rightAssignments])

  // Determine which area-filter buttons are meaningful given the bunks in scope.
  // Hides "ag" entirely when no AG (Mixed-gender) cabins are present (#24).
  const availableBunkAreas = useMemo(() => getAvailableBunkAreas(allBunks), [allBunks])

  // If the persisted selection is no longer valid (e.g. a data refresh removed
  // all AG bunks while "ag" was active), treat it as "all" for this render.
  // Computing during render avoids the setState-in-effect anti-pattern.
  const effectiveBunkArea: BunkArea = availableBunkAreas.includes(selectedBunkArea)
    ? selectedBunkArea
    : 'all'

  // Filter bunks by selected area
  const filteredBunks = useMemo(() => {
    return allBunks.filter((bunk) => {
      if (effectiveBunkArea === 'all') return true
      if (effectiveBunkArea === 'boys') return bunk.gender === 'M'
      if (effectiveBunkArea === 'girls') return bunk.gender === 'F'
      return bunk.gender === 'Mixed'
    })
  }, [allBunks, effectiveBunkArea])

  // Create bunk comparison data with movement tracking
  const bunkComparisons = useMemo((): BunkComparison[] => {
    return filteredBunks.map((bunk) => {
      const leftCampers = Array.from(leftByPerson.values()).filter((a) => a.bunkId === bunk.id)
      const rightCampers = Array.from(rightByPerson.values()).filter((a) => a.bunkId === bunk.id)

      const leftPersonIds = new Set(leftCampers.map((c) => c.personCmId))
      const rightPersonIds = new Set(rightCampers.map((c) => c.personCmId))

      // Track moved in with their origin
      const movedIn = rightCampers
        .filter((c) => !leftPersonIds.has(c.personCmId))
        .map((c) => {
          const prevAssignment = leftByPerson.get(c.personCmId)
          return {
            camper: c,
            fromBunk: prevAssignment?.bunkName ?? '(Unassigned)',
          }
        })

      // Track moved out with their destination
      const movedOut = leftCampers
        .filter((c) => !rightPersonIds.has(c.personCmId))
        .map((c) => {
          const nextAssignment = rightByPerson.get(c.personCmId)
          return {
            camper: c,
            toBunk: nextAssignment?.bunkName ?? '(Unassigned)',
          }
        })

      return {
        bunkId: bunk.id,
        bunkName: bunk.name,
        leftCampers: sortCampersByName(leftCampers),
        rightCampers: sortCampersByName(rightCampers),
        movedIn,
        movedOut,
      }
    })
  }, [filteredBunks, leftByPerson, rightByPerson])

  // Filter changes based on selected filter
  const filteredChanges = useMemo(() => {
    switch (changeFilter) {
      case 'moved':
        return {
          moved: comparison.moved,
          newlyAssigned: [],
          newlyUnassigned: [],
        }
      case 'newly-assigned':
        return {
          moved: [],
          newlyAssigned: comparison.newlyAssigned,
          newlyUnassigned: [],
        }
      case 'newly-unassigned':
        return {
          moved: [],
          newlyAssigned: [],
          newlyUnassigned: comparison.newlyUnassigned,
        }
      default:
        return {
          moved: comparison.moved,
          newlyAssigned: comparison.newlyAssigned,
          newlyUnassigned: comparison.newlyUnassigned,
        }
    }
  }, [comparison, changeFilter])

  const leftScenarioName =
    leftScenarioId === 'production'
      ? 'CampMinder (Production)'
      : (scenarios.find((s) => s.id === leftScenarioId)?.name ?? 'Select scenario')

  const rightScenarioName =
    rightScenarioId === 'production'
      ? 'CampMinder (Production)'
      : (scenarios.find((s) => s.id === rightScenarioId)?.name ?? 'Select scenario')

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="spinner-lodge h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Header - matches card-lodge style with rounded corners, dark mode aware */}
      <header className="bg-forest-800 dark:bg-forest-900 shadow-lodge-lg sticky top-0 z-20 mx-4 mt-4 rounded-2xl text-white">
        <div className="px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            {/* Back button and title */}
            <div className="flex items-center gap-4">
              <Link
                to={`/summer/session/${sessionUrlSegment}/bunks`}
                className="btn-ghost rounded-xl p-2 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="font-display flex items-center gap-3 text-xl font-bold">
                  <GitCompare className="h-6 w-6 text-amber-400" />
                  Scenario Comparison
                </h1>
                <p className="text-sm text-white/60">Compare bunk assignments between scenarios</p>
              </div>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-2 rounded-xl bg-white/10 p-1">
              {[
                {
                  mode: 'split' as ViewMode,
                  icon: LayoutGrid,
                  label: 'Split View',
                },
                {
                  mode: 'changes' as ViewMode,
                  icon: Table2,
                  label: 'Changes Table',
                },
              ].map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    viewMode === mode
                      ? 'text-forest-800 bg-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                  title={label}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Scenario Selectors */}
      <div className="bg-background border-border sticky top-0 z-10 mt-4 border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-8">
            {/* Left Scenario */}
            <div className="w-full flex-1">
              <label className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
                Compare From (Before)
              </label>
              <Listbox value={leftScenarioId} onChange={setLeftScenarioId}>
                <div className="relative">
                  <ListboxButton className="listbox-button font-medium">
                    <span className="truncate">
                      {leftScenarioId === 'production'
                        ? 'CampMinder (Production)'
                        : (scenarios.find((s) => s.id === leftScenarioId)?.name ?? 'Select...')}
                    </span>
                    <ChevronDown className="text-muted-foreground h-5 w-5 flex-shrink-0" />
                  </ListboxButton>
                  <ListboxOptions className="listbox-options w-full">
                    <ListboxOption
                      value="production"
                      className="listbox-option border-2 border-dashed border-amber-400 bg-amber-50/40 font-semibold dark:bg-amber-900/20"
                    >
                      ⬩ CampMinder (Production)
                    </ListboxOption>
                    {scenarios.length > 0 && (
                      <div className="text-muted-foreground border-border mt-1 border-t px-4 py-1.5 text-xs font-semibold tracking-wider uppercase">
                        Draft Scenarios
                      </div>
                    )}
                    {scenarios.map((s) => (
                      <ListboxOption
                        key={s.id}
                        value={s.id}
                        disabled={s.id === rightScenarioId}
                        className="listbox-option"
                      >
                        {s.name}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>

            {/* Arrow indicator */}
            <div className="flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <ArrowRight className="h-6 w-6 text-amber-600" />
              </div>
            </div>

            {/* Right Scenario */}
            <div className="w-full flex-1">
              <label className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
                Compare To (After)
              </label>
              <Listbox value={rightScenarioId} onChange={setRightScenarioId}>
                <div className="relative">
                  <ListboxButton className="listbox-button font-medium">
                    <span className={clsx('truncate', !rightScenarioId && 'text-muted-foreground')}>
                      {!rightScenarioId
                        ? 'Select a scenario...'
                        : rightScenarioId === 'production'
                          ? 'CampMinder (Production)'
                          : (scenarios.find((s) => s.id === rightScenarioId)?.name ?? 'Select...')}
                    </span>
                    <ChevronDown className="text-muted-foreground h-5 w-5 flex-shrink-0" />
                  </ListboxButton>
                  <ListboxOptions className="listbox-options w-full">
                    <ListboxOption
                      value="production"
                      disabled={leftScenarioId === 'production'}
                      className="listbox-option"
                    >
                      CampMinder (Production)
                    </ListboxOption>
                    {scenarios.length > 0 && (
                      <div className="text-muted-foreground border-border mt-1 border-t px-4 py-1.5 text-xs font-semibold tracking-wider uppercase">
                        Draft Scenarios
                      </div>
                    )}
                    {scenarios.map((s) => (
                      <ListboxOption
                        key={s.id}
                        value={s.id}
                        disabled={s.id === leftScenarioId}
                        className="listbox-option"
                      >
                        {s.name}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {!isReady ? (
          /* Empty state */
          <div className="card-lodge p-12 text-center">
            <div className="bg-forest-100 dark:bg-forest-900/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full">
              <GitCompare className="text-forest-500 h-10 w-10" />
            </div>
            <h2 className="font-display text-foreground mb-3 text-2xl font-bold">
              Select Two Scenarios to Compare
            </h2>
            <p className="text-muted-foreground mx-auto max-w-md">
              Choose a "before" and "after" scenario above to see what changed. You can compare
              production data with any draft scenario.
            </p>
          </div>
        ) : (
          <>
            {/* Validation Score Comparison - Detailed breakdown */}
            <ValidationSection
              isLoading={isValidationLoading}
              error={validationError}
              leftValidation={leftValidation}
              rightValidation={rightValidation}
              leftScenarioName={leftScenarioName}
              rightScenarioName={rightScenarioName}
              leftScenarioId={leftScenarioId}
              rightScenarioId={rightScenarioId}
            />

            {/* Metrics Summary */}
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <MetricCard
                label="Total Campers"
                value={comparison.metrics.totalCampers.right}
                sublabel={`${comparison.metrics.totalCampers.left} before`}
                icon={Users}
                color="forest"
              />
              <MetricCard
                label="Moved"
                value={comparison.metrics.movedCount}
                icon={ArrowLeftRight}
                color="amber"
                trend={comparison.metrics.movedCount > 0 ? 'neutral' : undefined}
              />
              <MetricCard
                label="Change Rate"
                value={`${comparison.metrics.changePercentage}%`}
                sublabel={`${comparison.metrics.unchangedCount} unchanged`}
                icon={UserCheck}
                color="bark"
              />
              <MetricCard
                label="New Assignments"
                value={comparison.metrics.newlyAssignedCount}
                sublabel={
                  comparison.metrics.newlyUnassignedCount > 0
                    ? `${comparison.metrics.newlyUnassignedCount} unassigned`
                    : undefined
                }
                icon={Percent}
                color="green"
              />
            </div>

            {/* Area Filter (for split view) */}
            {viewMode === 'split' && (
              <div className="mb-4 flex items-center gap-2">
                <Filter className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground mr-2 text-sm">Area:</span>
                {availableBunkAreas.map((area) => (
                  <button
                    key={area}
                    onClick={() => setSelectedBunkArea(area)}
                    className={clsx(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                      effectiveBunkArea === area
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {area === 'all'
                      ? 'All'
                      : area === 'boys'
                        ? 'Boys'
                        : area === 'girls'
                          ? 'Girls'
                          : 'AG'}
                  </button>
                ))}
              </div>
            )}

            {/* Change Filter (for changes view) */}
            {viewMode === 'changes' && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Filter className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground mr-2 text-sm">Show:</span>
                {[
                  { id: 'all' as ChangeFilter, label: 'All Changes' },
                  {
                    id: 'moved' as ChangeFilter,
                    label: `Moved (${comparison.metrics.movedCount})`,
                  },
                  {
                    id: 'newly-assigned' as ChangeFilter,
                    label: `New (${comparison.metrics.newlyAssignedCount})`,
                  },
                  {
                    id: 'newly-unassigned' as ChangeFilter,
                    label: `Gone (${comparison.metrics.newlyUnassignedCount})`,
                  },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setChangeFilter(filter.id)}
                    className={clsx(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                      changeFilter === filter.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
                {/* Export moved campers when on Moved filter */}
                {(changeFilter === 'moved' || changeFilter === 'all') &&
                  filteredChanges.moved.length > 0 && (
                    <button
                      onClick={() => {
                        const movedEntries = filteredChanges.moved.map((change) => ({
                          personCmId: change.camper.personCmId,
                          firstName: change.camper.firstName,
                          lastName: change.camper.lastName,
                          bunkName: change.toBunk.name,
                          sessionName: session?.name ?? '',
                          age: change.camper.age,
                          grade: change.camper.grade,
                          priorBunkName: change.fromBunk.name,
                        }))
                        const rows = buildMovedRows(movedEntries)
                        const csv = buildCsvContent([...MOVED_CSV_HEADERS], rows)
                        const sessionPart = session?.name ? `-${slugify(session.name)}` : ''
                        downloadCsv(
                          csv,
                          `scenario-moved-${slugify(leftScenarioName)}-vs-${slugify(rightScenarioName)}${sessionPart}-${todayIso()}.csv`
                        )
                      }}
                      className="bg-muted/50 text-muted-foreground hover:bg-muted ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
                      title={getExportButtonTitle(changeFilter as 'moved' | 'all')}
                    >
                      <Download className="h-4 w-4" />
                      <span>{getExportButtonLabel(changeFilter as 'moved' | 'all')}</span>
                    </button>
                  )}
              </div>
            )}

            {/* Split View */}
            {viewMode === 'split' && (
              <div className="space-y-4">
                {bunkComparisons.map((bunkComp) => (
                  <BunkComparisonCard
                    key={bunkComp.bunkId}
                    comparison={bunkComp}
                    leftLabel={leftScenarioName}
                    rightLabel={rightScenarioName}
                    leftGroupMap={leftGroupMap}
                    rightGroupMap={rightGroupMap}
                    leftCamperById={leftByPerson}
                    rightCamperById={rightByPerson}
                  />
                ))}
              </div>
            )}

            {/* Changes Table View */}
            {viewMode === 'changes' && (
              <div className="card-lodge overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase">
                        Camper
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase">
                        Grade
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase">
                        Change
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase">
                        From
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase">
                        To
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {filteredChanges.moved.map((change) => (
                      <tr key={`moved-${change.camper.personCmId}`} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="text-muted-foreground px-4 py-3 text-sm">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            <ArrowLeftRight className="h-3 w-3" />
                            Moved
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{change.fromBunk.name}</td>
                        <td className="px-4 py-3 text-sm">{change.toBunk.name}</td>
                      </tr>
                    ))}
                    {filteredChanges.newlyAssigned.map((change) => (
                      <tr
                        key={`assigned-${change.camper.personCmId}`}
                        className="hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="text-muted-foreground px-4 py-3 text-sm">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-forest-100 dark:bg-forest-900/30 text-forest-700 dark:text-forest-400 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Assigned
                          </span>
                        </td>
                        <td className="text-muted-foreground px-4 py-3 text-sm">—</td>
                        <td className="px-4 py-3 text-sm">{change.toBunk.name}</td>
                      </tr>
                    ))}
                    {filteredChanges.newlyUnassigned.map((change) => (
                      <tr
                        key={`unassigned-${change.camper.personCmId}`}
                        className="hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="text-muted-foreground px-4 py-3 text-sm">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-bark-100 dark:bg-bark-800/30 text-bark-700 dark:text-bark-400 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            Unassigned
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{change.fromBunk.name}</td>
                        <td className="text-muted-foreground px-4 py-3 text-sm">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredChanges.moved.length === 0 &&
                  filteredChanges.newlyAssigned.length === 0 &&
                  filteredChanges.newlyUnassigned.length === 0 && (
                    <div className="text-muted-foreground p-8 text-center">
                      No changes to display
                    </div>
                  )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// One percentage stat tile inside ValidationScoreCard.
function StatBlock({
  label,
  pct,
  satisfied,
  total,
}: {
  label: string
  pct: number
  satisfied: number
  total: number
}) {
  let pctColorClass: string
  if (pct >= 80) pctColorClass = 'text-forest-600'
  else if (pct >= 60) pctColorClass = 'text-amber-600'
  else pctColorClass = 'text-red-600'

  return (
    <div>
      <div className="text-muted-foreground text-xs tracking-wider uppercase">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={clsx('text-xl font-bold', pctColorClass)}>{pct}%</span>
        <span className="text-muted-foreground text-xs">
          ({satisfied}/{total})
        </span>
      </div>
    </div>
  )
}

// ValidationSection — QueryGuard boundary for validation score comparison.
// Handles loading / error / empty / success states so that ValidationScoreCard
// only needs to render the success case.

export interface ValidationSectionProps {
  isLoading: boolean
  error: Error | null
  leftValidation: ValidationResult | null | undefined
  rightValidation: ValidationResult | null | undefined
  leftScenarioName: string
  rightScenarioName: string
  leftScenarioId?: string
  rightScenarioId?: string
}

export function ValidationSection({
  isLoading,
  error,
  leftValidation,
  rightValidation,
  leftScenarioName,
  rightScenarioName,
  leftScenarioId,
  rightScenarioId,
}: ValidationSectionProps) {
  return (
    <QueryGuard
      isLoading={isLoading}
      error={error}
      data={leftValidation ?? rightValidation}
      label="validation"
      emptyMessage="No validation data available"
    >
      {() => (
        <div className="card-lodge mb-6 overflow-hidden">
          {/* Tinted header band — matches SolverProgressModal pattern */}
          <div className="border-border bg-forest-50 dark:bg-forest-900/20 flex items-center gap-2 border-b px-4 py-3">
            <CheckCircle2 className="text-forest-600 dark:text-forest-400 h-5 w-5" />
            <h3 className="text-forest-900 dark:text-forest-100 font-semibold">
              Validation Details
            </h3>
          </div>
          <div className="bg-muted/20 grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            {/* Left Scenario Score */}
            <ValidationScoreCard
              label={leftScenarioName}
              validation={leftValidation}
              side="left"
              isProduction={leftScenarioId === 'production'}
            />
            {/* Right Scenario Score */}
            <ValidationScoreCard
              label={rightScenarioName}
              validation={rightValidation}
              side="right"
              isProduction={rightScenarioId === 'production'}
            />
          </div>
        </div>
      )}
    </QueryGuard>
  )
}

// Validation Score Card Component - detailed validation stats
export interface ValidationScoreCardProps {
  label: string
  validation: ValidationResult | null | undefined
  side: 'left' | 'right'
  /** When true, applies a dashed-amber border to signal this is the live CampMinder snapshot. */
  isProduction?: boolean
}

export function ValidationScoreCard({
  label,
  validation,
  side,
  isProduction = false,
}: ValidationScoreCardProps) {
  // Note: loading / error / empty states are handled by the parent ValidationSection
  // (QueryGuard boundary). This component only renders in the success path.
  // null/undefined validation means the individual side has no data yet — render
  // a neutral placeholder within the already-visible success card.
  if (!validation) {
    return (
      <div className="border-muted rounded-xl border-2 border-dashed p-4">
        <div className="text-muted-foreground mb-2 truncate text-sm font-medium">{label}</div>
        <div className="text-muted-foreground/60 text-sm">Not available</div>
      </div>
    )
  }

  const stats = validation.statistics

  // Camper-level two-tier MP coverage (TG-6).
  const mpTotal = stats.mp_campers_total ?? 0
  const atLeastOnePct =
    mpTotal > 0
      ? Math.round(((stats.mp_campers_with_at_least_one_satisfied ?? 0) / mpTotal) * 100)
      : 0
  const allMpPct =
    mpTotal > 0 ? Math.round(((stats.mp_campers_with_all_satisfied ?? 0) / mpTotal) * 100) : 0

  const staffPct = Math.round((stats.staff_request_satisfaction_rate ?? 0) * 100)

  return (
    <div
      className={clsx(
        'rounded-xl border-2 p-4',
        isProduction
          ? 'border-dashed border-amber-400 bg-amber-50/40 dark:bg-amber-900/20'
          : side === 'left'
            ? 'border-bark-200 bg-bark-50 dark:border-bark-700 dark:bg-bark-900/20'
            : 'border-forest-200 bg-forest-50 dark:border-forest-700 dark:bg-forest-900/20'
      )}
    >
      <div className="mb-3 truncate text-sm font-semibold">{label}</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* Two-tier camper-level MP coverage — hero tiles */}
        <div>
          <div className="text-muted-foreground text-xs tracking-wider uppercase">
            At least one request
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className={clsx(
                'text-xl font-bold',
                atLeastOnePct >= 80
                  ? 'text-forest-600'
                  : atLeastOnePct >= 60
                    ? 'text-amber-600'
                    : 'text-red-600'
              )}
            >
              {atLeastOnePct}%
            </span>
            <span className="text-muted-foreground text-xs">
              {stats.mp_campers_with_at_least_one_satisfied ?? 0} / {mpTotal} campers
            </span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs tracking-wider uppercase">All requests</div>
          <div className="flex items-baseline gap-1">
            <span
              className={clsx(
                'text-xl font-bold',
                allMpPct >= 80
                  ? 'text-forest-600'
                  : allMpPct >= 60
                    ? 'text-amber-600'
                    : 'text-red-600'
              )}
            >
              {allMpPct}%
            </span>
            <span className="text-muted-foreground text-xs">
              {stats.mp_campers_with_all_satisfied ?? 0} / {mpTotal} campers
            </span>
          </div>
        </div>
        {/* Staff requests */}
        <StatBlock
          label="Staff requests"
          pct={staffPct}
          satisfied={stats.satisfied_staff_requests}
          total={stats.staff_requests}
        />
        {/* Families to call (negative request violations) */}
        <div>
          <div className="text-muted-foreground text-xs tracking-wider uppercase">
            Families to call
          </div>
          <div
            className={clsx(
              'text-xl font-bold',
              stats.negative_request_violations > 0 ? 'text-red-600' : 'text-forest-600'
            )}
          >
            {stats.negative_request_violations}
          </div>
        </div>
        {/* Isolated campers */}
        <div>
          <div className="text-muted-foreground text-xs tracking-wider uppercase">
            Isolated campers
          </div>
          <div
            className={clsx(
              'text-xl font-bold',
              stats.isolation_risks > 0 ? 'text-amber-600' : 'text-forest-600'
            )}
          >
            {stats.isolation_risks}
          </div>
        </div>
      </div>
    </div>
  )
}

// Metric Card Component
interface MetricCardProps {
  label: string
  value: string | number
  sublabel?: string | undefined
  icon: React.ElementType
  color: 'forest' | 'amber' | 'green' | 'red' | 'bark'
  trend?: 'up' | 'down' | 'neutral' | undefined
}

function MetricCard({ label, value, sublabel, icon: Icon, color, trend }: MetricCardProps) {
  const colorClasses = {
    forest: 'bg-forest-100 dark:bg-forest-900/30 text-forest-600 dark:text-forest-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    green: 'bg-forest-100 dark:bg-forest-900/30 text-forest-600 dark:text-forest-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    bark: 'bg-bark-100 dark:bg-bark-800/30 text-bark-600 dark:text-bark-400',
  }

  return (
    <div className="card-lodge p-4">
      <div className="mb-2 flex items-start justify-between">
        <div
          className={clsx(
            'flex h-10 w-10 items-center justify-center rounded-xl',
            colorClasses[color]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <div
            className={clsx(
              'flex items-center gap-1 text-xs font-medium',
              trend === 'up' && 'text-forest-600',
              trend === 'down' && 'text-red-600',
              trend === 'neutral' && 'text-amber-600'
            )}
          >
            {trend === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend === 'down' && <TrendingDown className="h-3 w-3" />}
            {trend === 'neutral' && <Minus className="h-3 w-3" />}
          </div>
        )}
      </div>
      <div className="stat-card-value text-2xl">{value}</div>
      <div className="text-muted-foreground mt-1 text-xs">{label}</div>
      {sublabel && <div className="text-muted-foreground/70 mt-0.5 text-xs">{sublabel}</div>}
    </div>
  )
}

// Bunk Comparison Card (Split View)
interface BunkComparisonCardProps {
  comparison: BunkComparison
  leftLabel: string
  rightLabel: string
  leftGroupMap: Map<number, LockGroupSummary>
  rightGroupMap: Map<number, LockGroupSummary>
  leftCamperById: Map<number, CamperAssignment>
  rightCamperById: Map<number, CamperAssignment>
}

function BunkComparisonCard({
  comparison,
  leftLabel,
  rightLabel,
  leftGroupMap,
  rightGroupMap,
  leftCamperById,
  rightCamperById,
}: BunkComparisonCardProps) {
  const hasChanges = comparison.movedIn.length > 0 || comparison.movedOut.length > 0
  const movedInIds = new Set(comparison.movedIn.map((c) => c.camper.personCmId))
  const movedOutIds = new Set(comparison.movedOut.map((c) => c.camper.personCmId))

  // Build lookup for movement destinations
  const movedOutDestinations = new Map(
    comparison.movedOut.map((c) => [c.camper.personCmId, c.toBunk])
  )
  const movedInOrigins = new Map(comparison.movedIn.map((c) => [c.camper.personCmId, c.fromBunk]))

  return (
    <div
      className={clsx(
        'card-lodge overflow-hidden transition-all',
        hasChanges && 'ring-2 ring-amber-400/50'
      )}
    >
      {/* Bunk Header */}
      <div
        className={clsx(
          'border-border flex items-center justify-between border-b px-4 py-3',
          hasChanges ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-muted/50'
        )}
      >
        <div className="flex items-center gap-3">
          <Home className="text-muted-foreground h-5 w-5" />
          <h3 className="text-lg font-semibold">{comparison.bunkName}</h3>
          {hasChanges && (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200">
              Changed
            </span>
          )}
        </div>
        <div className="text-muted-foreground text-sm">
          {comparison.leftCampers.length} → {comparison.rightCampers.length} campers
        </div>
      </div>

      {/* Split Content */}
      <div className="divide-border grid grid-cols-2 divide-x">
        {/* Left Side (Before) */}
        <div className="p-4">
          <div className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
            {leftLabel}
          </div>
          <div className="space-y-1.5">
            {comparison.leftCampers.length === 0 ? (
              <div className="text-muted-foreground py-2 text-sm italic">Empty</div>
            ) : (
              comparison.leftCampers.map((camper) => (
                <CamperPill
                  key={camper.personCmId}
                  camper={camper}
                  status={movedOutIds.has(camper.personCmId) ? 'moved-out' : 'unchanged'}
                  destination={movedOutDestinations.get(camper.personCmId)}
                  group={leftGroupMap.get(camper.personCmId)}
                  camperById={leftCamperById}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Side (After) */}
        <div className="p-4">
          <div className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
            {rightLabel}
          </div>
          <div className="space-y-1.5">
            {comparison.rightCampers.length === 0 ? (
              <div className="text-muted-foreground py-2 text-sm italic">Empty</div>
            ) : (
              comparison.rightCampers.map((camper) => (
                <CamperPill
                  key={camper.personCmId}
                  camper={camper}
                  status={movedInIds.has(camper.personCmId) ? 'moved-in' : 'unchanged'}
                  origin={movedInOrigins.get(camper.personCmId)}
                  group={rightGroupMap.get(camper.personCmId)}
                  camperById={rightCamperById}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// FriendGroupPopover — same-side member list shown on CamperPill hover.
// Rendered via createPortal to document.body so it isn't clipped by the bunk
// card's overflow-hidden wrapper when the pill is near the bottom of the list.
export interface FriendGroupPopoverProps {
  group: LockGroupSummary
  camperById: Map<number, CamperAssignment>
  anchorRect: { top: number; left: number; bottom: number } | null
}

export function FriendGroupPopover({ group, camperById, anchorRect }: FriendGroupPopoverProps) {
  const rows = group.memberCmIds
    .map((cmId) => ({ cmId, camper: camperById.get(cmId) }))
    .sort((a, b) => {
      const an = a.camper?.name ?? '￿'
      const bn = b.camper?.name ?? '￿'
      return an.localeCompare(bn)
    })

  const style: React.CSSProperties = anchorRect
    ? { top: `${anchorRect.bottom + 4}px`, left: `${anchorRect.left}px` }
    : {}

  return createPortal(
    <div
      data-testid="friend-group-popover"
      role="tooltip"
      aria-label={`Friend group: ${group.name}`}
      className="border-border/60 bg-popover pointer-events-none fixed z-[100] min-w-[200px] rounded-lg border p-3 shadow-lg"
      style={style}
    >
      <div className="border-border/40 mb-2 flex items-center gap-2 border-b pb-2">
        <span
          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        <span className="text-sm font-semibold">{group.name}</span>
      </div>
      <ul className="space-y-1">
        {rows.map(({ cmId, camper }) => (
          <li
            key={cmId}
            data-testid="friend-group-member"
            className={clsx('text-sm', !camper && 'text-muted-foreground italic')}
          >
            {camper?.name ?? '<unknown camper>'}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  )
}

// Camper Pill Component with origin/destination info and optional friend-group dot
export interface CamperPillProps {
  camper: CamperAssignment
  status: 'unchanged' | 'moved-in' | 'moved-out'
  origin?: string | undefined // Where they came from (for moved-in)
  destination?: string | undefined // Where they went (for moved-out)
  group?: LockGroupSummary | undefined
  camperById: Map<number, CamperAssignment>
}

export function CamperPill({
  camper,
  status,
  origin,
  destination,
  group,
  camperById,
}: CamperPillProps) {
  const pillRef = useRef<HTMLDivElement | null>(null)
  const [anchorRect, setAnchorRect] = useState<{
    top: number
    left: number
    bottom: number
  } | null>(null)
  const showPopover = anchorRect !== null && group !== undefined

  const handleMouseEnter = () => {
    const rect = pillRef.current?.getBoundingClientRect()
    if (rect) {
      setAnchorRect({ top: rect.top, left: rect.left, bottom: rect.bottom })
    } else {
      setAnchorRect({ top: 0, left: 0, bottom: 0 })
    }
  }

  return (
    <div
      ref={pillRef}
      data-testid="camper-pill"
      className={clsx(
        'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all',
        status === 'unchanged' && 'bg-muted/50',
        status === 'moved-in' &&
          'bg-forest-100 dark:bg-forest-900/30 ring-forest-300 dark:ring-forest-700 ring-1',
        status === 'moved-out' &&
          'bg-red-50 opacity-75 ring-1 ring-red-200 dark:bg-red-900/20 dark:ring-red-800'
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setAnchorRect(null)}
    >
      {group?.color && (
        <span
          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-label={group.name ? `Friend group: ${group.name}` : 'Friend group'}
        />
      )}
      <span className={clsx('font-medium', status === 'moved-out' && 'line-through')}>
        {camper.name}
      </span>
      <span className="text-muted-foreground text-xs">{formatGradeOrdinal(camper.grade)}</span>
      {/* Show origin for moved-in campers */}
      {status === 'moved-in' && origin && (
        <span className="text-forest-600 dark:text-forest-400 ml-auto flex items-center gap-1 text-xs">
          <ArrowLeft className="h-3 w-3" />
          <span className="opacity-80">{origin}</span>
        </span>
      )}
      {/* Show destination for moved-out campers */}
      {status === 'moved-out' && destination && (
        <span className="ml-auto flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <ArrowRight className="h-3 w-3" />
          <span className="opacity-80">{destination}</span>
        </span>
      )}
      {showPopover && (
        <FriendGroupPopover group={group} camperById={camperById} anchorRect={anchorRect} />
      )}
    </div>
  )
}
