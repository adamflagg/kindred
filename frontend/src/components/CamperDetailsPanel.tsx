import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Calendar,
  Heart,
  ChevronDown,
  ChevronRight,
  MapPin,
  TreePine,
  Home,
  Users,
  ExternalLink,
  MessageSquareQuote,
} from 'lucide-react'
import { ParentStaffDivider, AgePreferenceDivider } from './camper/RequestSectionDividers'
import FirstPickBadge from './camper/FirstPickBadge'
import { pb } from '../lib/pocketbase'
import { StatusBadge } from './StatusBadge'
import {
  getGenderIdentityDisplay,
  getGenderCategory,
  getGenderBadgeClasses,
  formatGenderShort,
} from '../utils/genderUtils'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { formatAge } from '../utils/age'
import {
  getSessionDisplayNameFromString,
  getSessionShortName as getSessionShortNameUtil,
} from '../utils/sessionDisplay'
import { buildSummerSessionTypeFilter } from '../constants/sessionTypes'
import { isAtCampSession } from '../utils/sessionTypePredicates'
import type {
  PersonsResponse,
  AttendeesResponse,
  BunkRequestsResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../types/pocketbase-types'
import { Collections } from '../types/pocketbase-types'
import { toAppCamper } from '../utils/transforms'
import { isConfirmedRequest } from '../utils/bunkRequest'
import { partitionRequestsBySource } from '../utils/partitionRequestsBySource'
import {
  resolveBadgeBucket,
  evaluateRequest,
  buildSatisfactionLookup,
  type BunkmateInfo,
} from '../utils/satisfactionLookup'
import type { RequestBucket, SatisfactionEntry } from '../types/satisfaction'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import { useOriginalBunkData } from '../hooks/camper/useOriginalBunkData'
import { useYear } from '../hooks/useCurrentYear'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { CampMinderIcon } from './icons'
import { getAvatarColor, getInitial } from '../utils/avatarUtils'
import { getLocationDisplay } from '../utils/addressUtils'
import { sortEnrolledFirst } from '../utils/enrollmentSort'
import { BunkRequestRow } from './BunkRequestRow'
import { CamperCohortsSection } from './CamperCohortsSection'
import {
  getStatusIndicator,
  filterEnrollmentsByStatus,
  toDisplayList,
} from '../utils/enrollmentFilter'
import { CamperAlertSection } from './CamperAlertSection'
import { AllCamperRequestsModal } from './AllCamperRequestsModal'
import { useLockGroupContext } from '../contexts/LockGroupContext'
import { buildCamperAlerts } from '../utils/camperAlertUtils'
import { useBunkRequestContext } from '../hooks'
import { queryKeys } from '../utils/queryKeys'

// Panel-augmented bunk request: extends the PB `BunkRequestsResponse` (the
// shape `BunkRequestRow` consumes) with the same `requestedPersonName`
// enrichment as the canonical `EnhancedBunkRequest`, plus `targetPerson` so
// the row can render the avatar/name without re-querying. The `pbToEnhanced`
// helper below converts between the PB shape and the app-types
// `EnhancedBunkRequest` shape that `evaluateRequest` accepts — fields the
// satisfaction code reads
// (`request_type`, `requestee_id`, `age_preference_target`, `id`, `status`)
// are identical between the two shapes, so the conversion is structural.
type PanelBunkRequest = BunkRequestsResponse & {
  requestedPersonName?: string | undefined
  targetPerson: PersonsResponse | null
}

function pbToEnhanced(req: PanelBunkRequest): EnhancedBunkRequest {
  return req as unknown as EnhancedBunkRequest
}

// Type for expanded records with relations
interface ExpandedSession {
  session_type?: string
  id?: string
  cm_id?: number
  name?: string
}

interface ExpandedPerson {
  cm_id?: number
  grade?: number
}

interface ExpandedBunk {
  cm_id?: number
  name?: string
}

interface ExpandedAssignment {
  session?: ExpandedSession
  person?: ExpandedPerson
  bunk?: ExpandedBunk
}

// Animation state machine - replaces isOpen/isClosing booleans
type AnimationPhase = 'entering' | 'exiting'

interface CamperDetailsPanelProps {
  camperId: string
  onClose: () => void
  embedded?: boolean
  requestClose?: boolean // When true, triggers animated close
  /**
   * Roster of campers in the selected camper's currently-assigned bunk.
   * Required for accurate unsatisfied-requests alert parity with CamperCard.
   * Omit (or pass empty) when the panel is rendered outside a bunk-aware
   * context (graph modals, embedded right-panel) — alert will then mirror
   * the conservative "self-only" view.
   */
  bunkCampers?: BunkmateInfo[]
  /**
   * Scenario-aware bunk assignment from the parent (e.g. BunkingBoardByArea
   * holds active-scenario state in `selected.assigned_bunk_cm_id`). When
   * provided, it overrides the PB-fetched live assignment for alert
   * computation — so a kid placed in a scenario but unassigned in prod still
   * shows the unsatisfied-requests row that fires on the bunking board.
   * Omit from session-agnostic callers (graph modals, full-page camper view)
   * to fall back to the live PB assignment.
   */
  assignedBunkCmId?: number | null
  /**
   * Active-view roster lookup. When provided alongside `assignedBunkCmId`,
   * the modal computes per-request satisfaction client-side from the active
   * view (live or scenario) instead of issuing the PB-backed
   * `useSatisfactionData` query. Callback returns the bunk cm_id for `cmId`
   * in the active view, or null if unassigned. Omit from session-agnostic
   * callers (graph modals, full-page camper view) to fall back to the live
   * PB query.
   */
  getBunkForPerson?: (cmId: number) => number | null
}

// Interface for historical records
interface HistoricalRecord {
  year: number
  sessionName: string
  sessionType: string
  bunkName: string
  attendeeStatus?: string
}

// Interface for current-year enrollment (one per attendee record)
interface CurrentEnrollment {
  sessionName: string
  sessionType: string
  sessionCmId: number
  bunkName: string | null
  attendeeStatus?: string
}

// Hoisted out of CamperDetailsPanel render to avoid React unmounting/remounting
// the section header (and losing focus / replaying animations) on every parent
// re-render.
const SECTION_HEADER_COLOR_CLASSES = {
  forest: 'bg-forest-50 dark:bg-forest-900/60 text-forest-700 dark:text-forest-100',
  amber: 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-100',
  pink: 'bg-pink-50 dark:bg-pink-900/60 text-pink-700 dark:text-pink-100',
  stone: 'bg-stone-100 dark:bg-stone-700/60 text-stone-700 dark:text-stone-100',
} as const

function SectionHeader({
  title,
  icon: Icon,
  isExpanded,
  onToggle,
  badge,
  accentColor = 'forest',
}: {
  title: string
  icon: React.ElementType
  isExpanded: boolean
  onToggle: () => void
  badge?: string | number
  accentColor?: keyof typeof SECTION_HEADER_COLOR_CLASSES
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-xl p-2.5 transition-all duration-200 hover:scale-[1.01] ${SECTION_HEADER_COLOR_CLASSES[accentColor]}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-bold tracking-wider uppercase">{title}</span>
        {badge !== undefined && (
          <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[10px] font-bold dark:bg-black/20">
            {badge}
          </span>
        )}
      </div>
      <ChevronDown
        className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

export default function CamperDetailsPanel({
  camperId,
  onClose,
  embedded = false,
  requestClose = false,
  bunkCampers,
  assignedBunkCmId,
  getBunkForPerson,
}: CamperDetailsPanelProps) {
  // Internal close state enables slide-out animation before unmount.
  // handleClose sets this to true, which triggers the exit animation.
  // When the animation finishes, handleAnimationEnd calls the real onClose() to unmount.
  const [isClosing, setIsClosing] = useState(false)
  const animationPhase: AnimationPhase = requestClose || isClosing ? 'exiting' : 'entering'
  const currentYear = useYear()

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    requests: true,
    history: true,
    siblings: true,
    bunkRequestForm: true,
    doNotShareBunkWith: true,
    staffNotes: true,
  })

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Handle animation completion - call onClose when exit animation finishes
  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Only respond to exit animations completing on the panel itself.
      // Check both animationPhase and animationName for safety,
      // but allow animationName to be empty (JSDOM/test environments).
      if (animationPhase === 'exiting') {
        const name = e.animationName || ''
        if (!name || name.includes('Out')) {
          onClose()
        }
      }
    },
    [animationPhase, onClose]
  )

  // Fetch camper details + all current-year enrollments
  const { data: camperData, isLoading: camperLoading } = useQuery({
    queryKey: queryKeys.camperDetails(camperId, currentYear),
    queryFn: async () => {
      const personId = parseInt(camperId)
      const persons = await pb.collection('persons').getFullList({
        filter: `cm_id = ${personId} && year = ${currentYear}`,
      })

      if (persons.length === 0) throw new Error('Person not found')
      const person = persons[0] as PersonsResponse

      const sessionTypeFilter = buildSummerSessionTypeFilter()
      const attendees = await pb.collection('attendees').getFullList<AttendeesResponse>({
        filter: `person_id = ${personId} && year = ${currentYear} && (${sessionTypeFilter})`,
        expand: 'session',
      })

      const dummyAttendee = {
        id: '',
        person: person.id,
        person_id: personId,
        session: '',
        enrollment_date: new Date().toISOString(),
        status: 'none' as const,
        status_id: 1,
        year: currentYear,
        collectionId: '',
        collectionName: Collections.Attendees,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      } as unknown as AttendeesResponse

      if (attendees.length === 0) {
        return {
          camper: toAppCamper(person, dummyAttendee),
          enrollments: [] as CurrentEnrollment[],
        }
      }

      // Sort enrolled first, then by session type priority
      attendees.sort((a, b) => {
        const aSession = (a.expand as { session?: ExpandedSession } | undefined)?.session
        const bSession = (b.expand as { session?: ExpandedSession } | undefined)?.session
        return sortEnrolledFirst(a.status, aSession?.session_type, b.status, bSession?.session_type)
      })

      // Build enrollments list from ALL attendee records
      const enrollments: CurrentEnrollment[] = []
      const primaryAttendee = attendees[0]
      let primarySession: ExpandedSession | null = null
      let primaryAssignment = null
      let primaryBunk: ExpandedBunk | null = null

      for (const att of attendees) {
        const expAtt = att.expand as { session?: ExpandedSession } | undefined
        const sess = expAtt?.session ?? null

        let bunkName: string | null = null
        let assignment = null
        if (att.session) {
          const assignments = await pb.collection('bunk_assignments').getFullList({
            filter: `person = "${person.id}" && session = "${att.session}" && year = ${currentYear}`,
            expand: 'bunk',
          })
          assignment = assignments.length > 0 ? assignments[0] : null
          const expAssign = assignment?.expand as { bunk?: ExpandedBunk } | undefined
          bunkName = expAssign?.bunk?.name ?? null
        }

        enrollments.push({
          sessionName: sess?.name ?? 'Unknown',
          sessionType: sess?.session_type ?? '',
          sessionCmId: sess?.cm_id ?? 0,
          bunkName,
          attendeeStatus: att.status,
        })

        // First attendee is primary (used for the main camper card)
        if (att === primaryAttendee) {
          primarySession = sess
          primaryAssignment = assignment
          const expAssign = primaryAssignment?.expand as { bunk?: ExpandedBunk } | undefined
          primaryBunk = expAssign?.bunk ?? null
        }
      }

      const camper = toAppCamper(
        person,
        primaryAttendee ?? dummyAttendee,
        primaryAssignment,
        primaryBunk as BunksResponse | null,
        primarySession as CampSessionsResponse | null
      )

      return { camper, enrollments }
    },
    retry: false,
  })

  const camper = camperData?.camper
  const allEnrollments = camperData?.enrollments ?? []
  // Show enrolled sessions only; if none enrolled, show best non-enrolled as fallback
  const currentEnrollments = toDisplayList(
    filterEnrollmentsByStatus(allEnrollments, (e) => e.attendeeStatus)
  )

  // Fetch person data for siblings query
  const { data: person } = useQuery({
    queryKey: queryKeys.personForSiblings(camperId, currentYear),
    queryFn: async () => {
      const personId = parseInt(camperId)
      const persons = await pb.collection<PersonsResponse>('persons').getList(1, 1, {
        filter: `cm_id = ${personId} && year = ${currentYear}`,
      })
      return persons.items[0] ?? null
    },
    enabled: !!camperId,
  })

  // Fetch historical bunking data
  const { data: historicalData = [] } = useQuery({
    queryKey: queryKeys.camperHistory(camperId, currentYear),
    queryFn: async () => {
      const personCmId = parseInt(camperId)
      const filter = `person.cm_id = ${personCmId} && year < ${currentYear}`
      const assignments = await pb.collection('bunk_assignments').getFullList({
        filter,
        expand: 'person,session,bunk',
        sort: '-year',
      })

      return assignments
        .filter((record) => {
          const expanded = record.expand as ExpandedAssignment | undefined
          const session = expanded?.session
          return session ? isAtCampSession(session) : false
        })
        .map((record) => {
          const expanded = record.expand as ExpandedAssignment | undefined
          return {
            year: record.year,
            sessionName: expanded?.session?.name ?? '',
            sessionType: expanded?.session?.session_type ?? '',
            bunkName: expanded?.bunk?.name ?? 'Unassigned',
          }
        })
    },
    enabled: !!camper,
  })

  // Fetch bunk requests
  const { data: bunkRequests = [] } = useQuery<PanelBunkRequest[]>({
    queryKey: queryKeys.personBunkRequests(camper?.person_cm_id, currentYear),
    queryFn: async (): Promise<PanelBunkRequest[]> => {
      if (!camper?.person_cm_id) throw new Error('No camper person ID')

      // Panel surfaces only resolved rows. Pending (e.g. SAME_AGE
      // staff-review) and declined rows are shown via RequestReviewPanel.
      const filter = `requester_id = ${camper.person_cm_id} && year = ${currentYear} && status = "resolved"`
      const requests = await pb.collection('bunk_requests').getFullList<BunkRequestsResponse>({
        filter,
        sort: '-is_first_requested,request_type',
      })

      const requestedPersonCmIds = new Set<number>()
      requests.forEach((req) => {
        if (req.requestee_id && req.requestee_id > 0) {
          requestedPersonCmIds.add(req.requestee_id)
        }
      })

      const personMap = new Map<number, PersonsResponse>()
      if (requestedPersonCmIds.size > 0) {
        const personFilter = Array.from(requestedPersonCmIds)
          .map((id) => `cm_id = ${id}`)
          .join(' || ')
        const persons = await pb.collection('persons').getFullList<PersonsResponse>({
          filter: `(${personFilter}) && year = ${currentYear}`,
        })
        persons.forEach((p) => personMap.set(p.cm_id, p))
      }

      return requests.map((req): PanelBunkRequest => {
        const person =
          req.requestee_id && req.requestee_id > 0 ? personMap.get(req.requestee_id) : undefined
        return {
          ...req,
          requestedPersonName: person
            ? `${person.first_name} ${person.last_name}`
            : // Use requested_person_name for unmatched requests (negative IDs or no match)
              req.requested_person_name
              ? `${req.requested_person_name} (unresolved)`
              : undefined,
          targetPerson: person ?? null,
          metadata: (req.metadata as Record<string, unknown> | undefined) ?? {},
        }
      })
    },
    enabled: !!camper?.person_cm_id,
  })

  // Fetch siblings
  const { data: siblings = [] } = useQuery({
    queryKey: queryKeys.camperSiblingsPanel(person?.household_id, camperId, currentYear),
    queryFn: async () => {
      const personCmId = parseInt(camperId)
      if (!person?.household_id || person.household_id === 0) return []

      const siblingFilter = `household_id = ${person.household_id} && cm_id != ${personCmId} && grade > 0 && year = ${currentYear}`
      let siblingPersons: PersonsResponse[]
      try {
        siblingPersons = await pb.collection<PersonsResponse>('persons').getFullList({
          filter: siblingFilter,
          sort: '-birthdate',
        })
      } catch {
        return []
      }

      if (siblingPersons.length === 0) return []

      const siblingsWithEnrollment = await Promise.all(
        siblingPersons.map(async (siblingPerson) => {
          const sessionTypeFilter = buildSummerSessionTypeFilter()
          const enrollmentFilter = `person_id = ${siblingPerson.cm_id} && year = ${currentYear} && (${sessionTypeFilter})`

          try {
            const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
              filter: enrollmentFilter,
              expand: 'session',
              $autoCancel: false,
            })

            if (attendees.length === 0) return null

            const sortedAttendees = attendees.sort((a, b) => {
              const aExpand = a.expand as { session?: ExpandedSession } | undefined
              const bExpand = b.expand as { session?: ExpandedSession } | undefined
              const aType = aExpand?.session?.session_type ?? 'unknown'
              const bType = bExpand?.session?.session_type ?? 'unknown'
              return sortEnrolledFirst(a.status, aType, b.status, bType)
            })

            const primaryAttendee = sortedAttendees[0]
            if (!primaryAttendee) return null
            const primaryExpand = primaryAttendee.expand as
              | { session?: ExpandedSession }
              | undefined
            const session = primaryExpand?.session

            let bunkName = null
            if (session) {
              try {
                const assignments = await pb
                  .collection<BunkAssignmentsResponse>('bunk_assignments')
                  .getFullList({
                    filter: `person = "${siblingPerson.id || ''}" && session = "${session.id ?? ''}" && year = ${currentYear}`,
                    expand: 'bunk',
                    $autoCancel: false,
                  })
                if (assignments.length > 0 && assignments[0]) {
                  const assignmentExpand = assignments[0].expand as
                    | { bunk?: ExpandedBunk }
                    | undefined
                  bunkName = assignmentExpand?.bunk?.name ?? null
                }
              } catch {
                /* continue without bunk */
              }
            }

            return { ...siblingPerson, session, bunkName, attendeeStatus: primaryAttendee.status }
          } catch {
            return null
          }
        })
      )

      return siblingsWithEnrollment.filter((s) => s !== null)
    },
    enabled: !!(person?.household_id && person.household_id > 0),
  })

  // Original parent-sourced bunk-request form text (CSV import, normalized
  // per-field). Re-uses the same hook the full-page camper detail does so the
  // sidebar reads the same source of truth via `requester.cm_id`.
  const { originalBunkData } = useOriginalBunkData(camper?.person_cm_id, currentYear)

  // Trigger close - for embedded mode, call directly; for slide panel, start exit animation
  const handleClose = useCallback(() => {
    if (embedded) {
      onClose()
    } else {
      setIsClosing(true)
    }
  }, [embedded, onClose])

  // Dismiss overlay with Escape key (non-embedded mode only). When mounted
  // inside a Modal, both listen on `document` for Escape — we register in
  // the capture phase and stop propagation so the panel closes first and
  // the underlying modal stays open (LIFO close behaviour).
  useEffect(() => {
    if (embedded || isClosing) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      handleClose()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [embedded, isClosing, handleClose])

  // Helper: get location from person's discrete address columns
  const location = getLocationDisplay(
    person?.normalized_city ?? person?.address_city,
    person?.address_state
  )

  const getSessionShortName = () => {
    return getSessionShortNameUtil(camper?.expand?.session ?? undefined)
  }

  /** Short display name for an enrollment's session — same util as the header. */
  const getEnrollmentShortName = (enrollment: CurrentEnrollment): string => {
    return (
      getSessionShortNameUtil({
        session_type: enrollment.sessionType,
        name: enrollment.sessionName,
      }) ?? 'Unknown'
    )
  }

  // Lock group context — used to compute friend-group alert and layout
  const { getCamperLockState, getCamperLockGroup, getGroupMembers, isActionBarVisible } =
    useLockGroupContext()
  const actionBarBottom = isActionBarVisible ? 'bottom-20' : 'bottom-0'

  // State for the manage-all-requests modal (opened from alert row click)
  const [isAllRequestsModalOpen, setIsAllRequestsModalOpen] = useState(false)

  // ── Satisfaction data ────────────────────────────────────────────────────
  // Two paths:
  //   1. Scenario-aware caller (BunkingBoardByArea) passes `getBunkForPerson`
  //      and `assignedBunkCmId` — we compute synchronously from the active
  //      view, so the pill matches whatever's on screen (live or draft).
  //   2. Session-agnostic callers (graph modals, full-page view) — read from
  //      BunkRequestProvider's /api/satisfaction response (no extra fetch).
  // Defined ABOVE the early-return paths to keep hook order stable.
  const hasClientView = getBunkForPerson != null

  // Derived request partitions — declared here so renderContent() (defined below)
  // and the embedded early-return both see them. Previously these were declared
  // after the embedded-mode return, causing a TDZ ReferenceError in that path.
  // Partition the PanelBunkRequest objects directly (they satisfy PartitionableRequest
  // and are what BunkRequestRow expects). pbToEnhanced is only used for the
  // satisfaction-computation hooks which accept EnhancedBunkRequest.
  const {
    parent: parentRows,
    staff: staffRows,
    age: ageRows,
  } = useMemo(() => partitionRequestsBySource(bunkRequests), [bunkRequests])

  // ── Build alert catalog from the SAME source CamperCard uses ───────────────
  // Placed before early returns so useMemo is called unconditionally (Rules of Hooks).
  // We pull `getSatisfiedRequestInfo` from BunkRequestProvider — the same fn
  // CamperCard calls — so the orange-triangle trigger on the board and the
  // yellow row in this sidebar are computed by one shared code path. Do NOT
  // reintroduce a parallel calculation here.
  const { getSatisfiedRequestInfo } = useBunkRequestContext()
  const lockState = getCamperLockState(camper?.person_cm_id ?? 0)
  const lockGroup = getCamperLockGroup(camper?.person_cm_id ?? 0)
  const lockGroupSize = lockGroup ? getGroupMembers(lockGroup.id).length : 0
  // Default to self-only when caller doesn't pass a roster (graph modals,
  // embedded right-panel) — matches CamperCard's same fallback.
  const effectiveBunkCampers: BunkmateInfo[] =
    bunkCampers && bunkCampers.length > 0
      ? bunkCampers
      : camper
        ? [{ cmId: camper.person_cm_id, grade: camper.grade }]
        : []
  const bunkCampersKey = effectiveBunkCampers.map((c) => `${c.cmId}:${c.grade ?? ''}`).join(',')

  // Path 1 — draft drag preview, synchronous from in-memory state.
  // Uses the TS predicate (evaluateRequest), guarded against drift from the
  // Python counterpart by the shared-fixture parity tests.
  //
  // We deliberately do NOT early-return when `assignedBunkCmId == null`. The
  // unassigned-requester case is handled inside `evaluateRequest` (returns
  // `status='unknown'` → no pill), which matches the drag-preview UX intent.
  // Falling through to `pbLookup` here would render persisted red "Requester
  // not assigned" pills during an active drag — see `evaluateRequest`'s
  // JSDoc on the 4-state SatisfactionStatus.
  const clientLookup = useMemo<((id: string) => SatisfactionEntry) | null>(() => {
    if (!hasClientView || !camper) return null
    const requesterBunkmates = effectiveBunkCampers.filter((c) => c.cmId !== camper.person_cm_id)
    const adapted = new Map<string, SatisfactionEntry>()
    for (const req of bunkRequests) {
      const targetBunkCmId =
        req.requestee_id && req.requestee_id > 0
          ? (getBunkForPerson?.(req.requestee_id) ?? null)
          : null
      const result = evaluateRequest({
        request: pbToEnhanced(req),
        requesterBunkCmId: assignedBunkCmId ?? null,
        requesterBunkmates,
        targetBunkCmId,
        requesterGrade: camper.grade,
      })
      // Adapt SatisfactionStatus → {satisfied, detail}.
      let satisfied: boolean | null
      if (result.status === 'satisfied') satisfied = true
      else if (result.status === 'not_satisfied') satisfied = false
      else satisfied = null // 'unknown' / 'checking'
      adapted.set(req.id, { satisfied, detail: result.detail ?? null })
    }
    return (id: string) => adapted.get(id) ?? { satisfied: null, detail: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasClientView,
    assignedBunkCmId,
    bunkCampersKey,
    bunkRequests,
    camper?.person_cm_id,
    camper?.grade,
    getBunkForPerson,
  ])

  // Path 2 — read directly from BunkRequestProvider, no PB fetch.
  // Replaces the deleted useSatisfactionData call entirely. Backend rows
  // surface even when the camper is unassigned (`detail="Requester not
  // assigned"` for every row); honest rendering matches the API contract.
  const pbLookup = useMemo<(id: string) => SatisfactionEntry>(() => {
    if (!camper) return () => ({ satisfied: null, detail: null })
    const info = getSatisfiedRequestInfo(camper.person_cm_id)
    return buildSatisfactionLookup(info.per_request)
  }, [camper, getSatisfiedRequestInfo])

  const getRequestSatisfaction = clientLookup ?? pbLookup

  // Prefer scenario-aware assignment from the parent (e.g. BunkingBoardByArea
  // passes the active scenario's bunk). Falls back to the live PB assignment
  // for session-agnostic callers (graph modals, full-page camper view).
  const effectiveAssignedBunkCmId = assignedBunkCmId ?? camper?.assigned_bunk_cm_id ?? null

  // Compute satisfaction info once — both bucketByRequestId and camperAlerts consume it.
  const satInfo = useMemo(
    () => getSatisfiedRequestInfo(camper?.person_cm_id ?? 0),
    [camper?.person_cm_id, getSatisfiedRequestInfo]
  )

  // Per-row bucket lookup so age-pref P/S badges read the centralized
  // classification (CamperSatisfaction.per_request[i].bucket) instead of
  // re-deriving from raw source_field/source — same pattern as
  // BunkingStatusPanel (#1159).
  const bucketByRequestId = useMemo(
    () => new Map<string, RequestBucket>(satInfo.per_request.map((p) => [p.request_id, p.bucket])),
    [satInfo]
  )

  const camperAlerts = useMemo(
    () =>
      buildCamperAlerts({
        assignedBunkCmId: effectiveAssignedBunkCmId,
        requestInfo: satInfo,
        lockState,
        lockGroupSize,
      }),
    [effectiveAssignedBunkCmId, satInfo, lockState, lockGroupSize]
  )

  // Loading state
  if (camperLoading) {
    return embedded ? (
      <div className="card-lodge flex min-h-[300px] items-center justify-center p-8">
        <div className="spinner-lodge"></div>
      </div>
    ) : (
      <>
        <div
          data-testid="panel-backdrop"
          className="pointer-events-none fixed inset-0 z-[59]"
          onClick={handleClose}
          aria-hidden="true"
        />
        <div
          data-panel="camper-details"
          className={`bg-card shadow-lodge-xl border-border fixed top-0 right-0 z-[60] flex w-[28rem] items-center justify-center border-l transition-[bottom] duration-200 ease-out ${
            animationPhase === 'entering' ? 'animate-slide-in-right' : 'animate-slide-out-right'
          } ${actionBarBottom}`}
          onAnimationEnd={handleAnimationEnd}
        >
          <div className="spinner-lodge"></div>
        </div>
      </>
    )
  }

  // Not found state
  if (!camper) {
    return embedded ? (
      <div className="card-lodge p-6">
        <div className="text-muted-foreground text-center">Camper not found</div>
      </div>
    ) : (
      <>
        <div
          data-testid="panel-backdrop"
          className="pointer-events-none fixed inset-0 z-[59]"
          onClick={handleClose}
          aria-hidden="true"
        />
        <div
          data-panel="camper-details"
          className={`bg-card shadow-lodge-xl border-border fixed top-0 right-0 z-[60] w-[28rem] border-l p-6 transition-[bottom] duration-200 ease-out ${
            animationPhase === 'entering' ? 'animate-slide-in-right' : 'animate-slide-out-right'
          } ${actionBarBottom}`}
          onAnimationEnd={handleAnimationEnd}
        >
          <div className="text-muted-foreground text-center">Camper not found</div>
        </div>
      </>
    )
  }

  // Status indicator for single-enrollment display (computed once, used in JSX)
  const singleIndicator =
    currentEnrollments.length === 1
      ? getStatusIndicator(currentEnrollments[0]?.attendeeStatus)
      : null

  // Render the panel content
  const renderContent = () => (
    <div className={embedded ? 'space-y-3' : 'flex-1 space-y-4 overflow-auto'}>
      {/* Quick Stats Bar */}
      <div className="bg-forest-900/50 border-forest-600/20 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {location && (
            <div className="text-forest-100 flex items-center gap-1.5">
              <MapPin className="text-forest-300 h-3 w-3" />
              <span>{location}</span>
            </div>
          )}
          <div className="text-forest-100 flex items-center gap-1.5">
            <TreePine className="text-forest-300 h-3 w-3" />
            <span>
              {camper.years_at_camp ?? 0} {(camper.years_at_camp ?? 0) === 1 ? 'year' : 'years'}
            </span>
          </div>
          {currentEnrollments.length > 1 ? (
            currentEnrollments.map((enrollment) => {
              const indicator = getStatusIndicator(enrollment.attendeeStatus)
              return (
                <div
                  key={enrollment.sessionCmId}
                  className="text-forest-100 flex items-center gap-1.5"
                >
                  <Calendar className="text-forest-300 h-3 w-3" />
                  <span>
                    {getEnrollmentShortName(enrollment)}
                    {indicator ? (
                      <span
                        className={`ml-1.5 inline-flex rounded px-1 py-0.5 text-[9px] leading-none font-bold ${indicator.colorClass}`}
                      >
                        {indicator.letter}
                      </span>
                    ) : enrollment.bunkName ? (
                      <>
                        {' '}
                        <Home className="text-forest-300 inline h-3 w-3" /> {enrollment.bunkName}
                      </>
                    ) : (
                      <span className="text-amber-300"> (unassigned)</span>
                    )}
                  </span>
                </div>
              )
            })
          ) : singleIndicator ? (
            <div className="text-forest-100 flex items-center gap-1.5">
              <Calendar className="text-forest-300 h-3 w-3" />
              <span>
                {getSessionShortName()}
                <span
                  className={`ml-1.5 inline-flex rounded px-1 py-0.5 text-[9px] leading-none font-bold ${singleIndicator.colorClass}`}
                >
                  {singleIndicator.letter}
                </span>
              </span>
            </div>
          ) : (
            <>
              {camper.expand?.assigned_bunk && (
                <div className="text-forest-100 flex items-center gap-1.5">
                  <Home className="text-forest-300 h-3 w-3" />
                  <span>{camper.expand.assigned_bunk.name}</span>
                </div>
              )}
              {getSessionShortName() && (
                <div className="text-forest-100 flex items-center gap-1.5">
                  <Calendar className="text-forest-300 h-3 w-3" />
                  <span>{getSessionShortName()}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4">
        {/* ── Alerts (mirrored from bunking-board camper card) ────────────── */}
        {camperAlerts.length > 0 && (
          <CamperAlertSection
            alerts={camperAlerts}
            onRequestAlertClick={() => setIsAllRequestsModalOpen(true)}
          />
        )}

        {/* AllCamperRequestsModal — opened from request-related alert rows */}
        <AllCamperRequestsModal
          isOpen={isAllRequestsModalOpen}
          onClose={() => setIsAllRequestsModalOpen(false)}
          requesterCmId={camper.person_cm_id}
          requesterName={camper.name}
          year={currentYear}
          currentRequestId={null}
        />

        {/* Cohort Rows: "Also from [X]: N campers" — school/congregation/city */}
        {camper.person_cm_id && camper.session_cm_id > 0 && (
          <CamperCohortsSection
            personCmId={camper.person_cm_id}
            sessionCmId={camper.session_cm_id}
            year={currentYear}
            selfDisplayName={camper.preferred_name?.trim() || camper.first_name || 'this camper'}
            hasMultipleEnrollments={currentEnrollments.length > 1}
          />
        )}

        {/* Bunking Preferences - Compact view (R3: Parent → Staff → Age partition) */}
        {bunkRequests.length > 0 && (
          <section>
            <SectionHeader
              title="Bunking Preferences"
              icon={Heart}
              isExpanded={expandedSections.requests}
              onToggle={() => toggleSection('requests')}
              badge={bunkRequests.length}
              accentColor="forest"
            />
            {expandedSections.requests &&
              (parentRows.length > 0 || staffRows.length > 0 || ageRows.length > 0) && (
                <div className="mt-2 space-y-1">
                  {/* Parent ↑ │ ⬇ Staff divider between the two peer groups, plus a
                      quieter "Age preference" divider above the age tail section. */}
                  {parentRows.map((req) => {
                    const sat = getRequestSatisfaction(req.id)
                    return (
                      <BunkRequestRow
                        key={req.id}
                        request={req}
                        targetPerson={req.targetPerson ?? null}
                        showSatisfaction={isConfirmedRequest(req)}
                        satisfied={sat.satisfied}
                        detail={sat.detail}
                        badge={
                          <FirstPickBadge isFirstRequested={req.is_first_requested ?? false} />
                        }
                      />
                    )
                  })}

                  {parentRows.length > 0 && staffRows.length > 0 && <ParentStaffDivider />}
                  {staffRows.map((req) => {
                    const sat = getRequestSatisfaction(req.id)
                    return (
                      <BunkRequestRow
                        key={req.id}
                        request={req}
                        targetPerson={req.targetPerson ?? null}
                        showSatisfaction={isConfirmedRequest(req)}
                        satisfied={sat.satisfied}
                        detail={sat.detail}
                      />
                    )
                  })}

                  {ageRows.length > 0 && (parentRows.length > 0 || staffRows.length > 0) && (
                    <AgePreferenceDivider />
                  )}
                  {ageRows.map((req) => {
                    const sat = getRequestSatisfaction(req.id)
                    const { isMaterialAgePref, isStaffBadge } = resolveBadgeBucket(
                      bucketByRequestId.get(req.id),
                      req
                    )
                    return (
                      <BunkRequestRow
                        key={req.id}
                        request={req}
                        showSatisfaction={true}
                        satisfied={sat.satisfied}
                        detail={sat.detail}
                        isMaterialAgePreference={isMaterialAgePref}
                        staffAgeBadge={isStaffBadge}
                      />
                    )
                  })}
                </div>
              )}
          </section>
        )}

        {/* Camp Journey Timeline - Compact */}
        {(historicalData.length > 0 || camper.expand?.session) && (
          <section>
            <SectionHeader
              title="Camp Journey"
              icon={TreePine}
              isExpanded={expandedSections.history}
              onToggle={() => toggleSection('history')}
              badge={camper.years_at_camp ?? historicalData.length + 1}
              accentColor="forest"
            />
            {expandedSections.history && (
              <div className="relative mt-2">
                {/* Timeline line */}
                <div className="bg-forest-200 dark:bg-forest-800 absolute top-1 bottom-1 left-[5px] w-0.5" />

                <div className="space-y-1.5">
                  {/* Current year - show all enrollments */}
                  {currentEnrollments.length > 0
                    ? currentEnrollments.map((enrollment, idx) => {
                        const indicator = getStatusIndicator(enrollment.attendeeStatus)
                        return (
                          <div
                            key={`current-${enrollment.sessionCmId}`}
                            className="relative flex items-center gap-2.5"
                          >
                            <div
                              className={`relative z-10 h-3 w-3 flex-shrink-0 rounded-full ring-2 ${
                                indicator
                                  ? 'bg-amber-400 ring-amber-100 dark:bg-amber-600 dark:ring-amber-900'
                                  : 'bg-forest-600 ring-forest-100 dark:ring-forest-900'
                              }`}
                            />
                            <span className="text-forest-700 dark:text-forest-300 w-11 text-sm font-bold">
                              {idx === 0 ? currentYear : ''}
                            </span>
                            <span className="text-muted-foreground truncate text-xs">
                              {getEnrollmentShortName(enrollment)}
                            </span>
                            {indicator ? (
                              <span
                                className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] leading-none font-bold ${indicator.colorClass}`}
                                title={enrollment.attendeeStatus}
                              >
                                {indicator.letter}
                              </span>
                            ) : (
                              <>
                                <span className="text-muted-foreground text-xs">·</span>
                                <span
                                  className={`truncate text-xs ${enrollment.bunkName ? 'text-foreground font-medium' : 'text-amber-600 italic'}`}
                                >
                                  {enrollment.bunkName ?? 'Unassigned'}
                                </span>
                              </>
                            )}
                            {idx === 0 && !indicator && (
                              <span className="bg-forest-600 ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white">
                                Now
                              </span>
                            )}
                          </div>
                        )
                      })
                    : camper.expand?.session && (
                        <div className="relative flex items-center gap-2.5">
                          <div className="bg-forest-600 ring-forest-100 dark:ring-forest-900 relative z-10 h-3 w-3 flex-shrink-0 rounded-full ring-2" />
                          <span className="text-forest-700 dark:text-forest-300 w-11 text-sm font-bold">
                            {currentYear}
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {getSessionShortName()}
                          </span>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span
                            className={`truncate text-xs ${camper.expand.assigned_bunk ? 'text-foreground font-medium' : 'text-amber-600 italic'}`}
                          >
                            {camper.expand.assigned_bunk?.name ?? 'Unassigned'}
                          </span>
                          <span className="bg-forest-600 ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white">
                            Now
                          </span>
                        </div>
                      )}

                  {/* Historical years */}
                  {historicalData.map((record: HistoricalRecord, idx: number) => (
                    <div
                      key={`${record.year}-${idx}`}
                      className="relative flex items-center gap-2.5 opacity-75"
                    >
                      <div className="bg-forest-300 dark:bg-forest-700 relative z-10 h-3 w-3 flex-shrink-0 rounded-full" />
                      <span className="text-foreground w-11 text-sm font-semibold">
                        {record.year}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {getSessionDisplayNameFromString(record.sessionName, record.sessionType)}
                      </span>
                      <span className="text-muted-foreground text-xs">·</span>
                      <span
                        className={`truncate text-xs ${record.bunkName === 'Unassigned' ? 'text-amber-600 italic' : 'text-foreground'}`}
                      >
                        {record.bunkName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Siblings */}
        {siblings.length > 0 && (
          <section>
            <SectionHeader
              title="Siblings"
              icon={Users}
              isExpanded={expandedSections.siblings}
              onToggle={() => toggleSection('siblings')}
              badge={siblings.length}
              accentColor="pink"
            />
            {expandedSections.siblings && (
              <div className="mt-2 space-y-2">
                {siblings.map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={`/camper/${sibling.cm_id}`}
                    onClick={handleClose}
                    className="bg-muted/30 hover:bg-muted/50 hover:border-border group flex items-center gap-2.5 rounded-xl border border-transparent p-2.5 transition-all"
                  >
                    <div
                      className={`h-8 w-8 rounded-lg ${getAvatarColor(sibling.gender)} flex flex-shrink-0 items-center justify-center shadow-sm`}
                    >
                      <span className="font-display text-xs font-bold text-white">
                        {getInitial(sibling.first_name)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 flex items-center gap-1.5 truncate text-sm font-medium">
                        <span>
                          {sibling.preferred_name || sibling.first_name} {sibling.last_name}
                        </span>
                        <StatusBadge status={sibling.attendeeStatus} />
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[10px]">
                        <span>{formatAge(getDisplayAgeForYear(sibling, currentYear) ?? 0)}</span>
                        <span>•</span>
                        <span>{formatGradeOrdinal(sibling.grade)}</span>
                        {sibling.bunkName && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-0.5">
                              <Home className="h-2.5 w-2.5" />
                              {sibling.bunkName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-forest-600 h-4 w-4 flex-shrink-0 transition-colors" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Bunk Request Form — parent-sourced form input, expanded by default (quick-ref).
            Shows the share_bunk_with field only; full 5-field CSV is
            available on the manage-requests modal, the requests row expansion,
            and the full-page bunk-csv view. */}
        {originalBunkData?.share_bunk_with?.trim() && (
          <section>
            <SectionHeader
              title="Bunk Request Form"
              icon={MessageSquareQuote}
              isExpanded={expandedSections.bunkRequestForm}
              onToggle={() => toggleSection('bunkRequestForm')}
              accentColor="amber"
            />
            {expandedSections.bunkRequestForm && (
              <div className="mt-2 pl-1">
                <blockquote className="text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap italic dark:border-amber-500/60 dark:bg-amber-900/20">
                  {originalBunkData.share_bunk_with}
                </blockquote>
              </div>
            )}
          </section>
        )}

        {/* Do NOT Share Bunk With — parent-sourced negative preference, expanded by default. */}
        {originalBunkData?.do_not_share_bunk_with?.trim() && (
          <section>
            <SectionHeader
              title="Do NOT Share Bunk With"
              icon={MessageSquareQuote}
              isExpanded={expandedSections.doNotShareBunkWith}
              onToggle={() => toggleSection('doNotShareBunkWith')}
              accentColor="amber"
            />
            {expandedSections.doNotShareBunkWith && (
              <div className="mt-2 pl-1">
                <blockquote className="text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap italic dark:border-amber-500/60 dark:bg-amber-900/20">
                  {originalBunkData.do_not_share_bunk_with}
                </blockquote>
              </div>
            )}
          </section>
        )}

        {/* Staff Notes — combines internal_bunk_notes + bunking_notes_notes,
            expanded by default. Each present text renders as its own stacked
            blockquote inside the same section. */}
        {(() => {
          const hasInternalNotes = (originalBunkData?.internal_bunk_notes?.trim() ?? '') !== ''
          const hasBunkingNotes = (originalBunkData?.bunking_notes_notes?.trim() ?? '') !== ''
          if (!hasInternalNotes && !hasBunkingNotes) return null
          return (
            <section>
              <SectionHeader
                title="Staff Notes"
                icon={MessageSquareQuote}
                isExpanded={expandedSections.staffNotes}
                onToggle={() => toggleSection('staffNotes')}
                accentColor="amber"
              />
              {expandedSections.staffNotes && (
                <div className="mt-2 space-y-2 pl-1">
                  {hasInternalNotes && (
                    <blockquote className="text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap italic dark:border-amber-500/60 dark:bg-amber-900/20">
                      {originalBunkData?.internal_bunk_notes}
                    </blockquote>
                  )}
                  {hasBunkingNotes && (
                    <blockquote className="text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap italic dark:border-amber-500/60 dark:bg-amber-900/20">
                      {originalBunkData?.bunking_notes_notes}
                    </blockquote>
                  )}
                </div>
              )}
            </section>
          )
        })()}
      </div>
    </div>
  )

  // Render footer
  const renderFooter = () => (
    <div
      className={
        embedded ? 'space-y-2 px-4 pt-3 pb-4' : 'border-border bg-card space-y-2 border-t p-4'
      }
    >
      <div className="flex gap-2">
        <Link
          to={`/camper/${camper.person_cm_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary flex flex-1 items-center justify-center gap-1.5 py-2 text-center text-sm"
        >
          Full Details
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Link>
        <a
          href={`https://system.campminder.com/ui/person/Record#${camper.person_cm_id}:${currentYear}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex flex-1 items-center justify-center gap-1.5 py-2 text-sm"
        >
          <CampMinderIcon className="h-4 w-4" />
          <span>CampMinder</span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </div>
      {!embedded && (
        <button onClick={handleClose} className="btn-ghost w-full py-2 text-sm">
          Close
        </button>
      )}
    </div>
  )

  // Embedded mode
  if (embedded) {
    return (
      <div className="bg-card shadow-lodge-lg flex h-full flex-col overflow-hidden rounded-2xl">
        {/* Compact Header */}
        <div className="from-forest-700 via-forest-800 to-forest-900 flex-shrink-0 bg-gradient-to-br p-4 text-white">
          <div className="flex items-start gap-3">
            <div
              className={`h-12 w-12 rounded-xl ${getAvatarColor(camper.gender)} flex flex-shrink-0 items-center justify-center shadow-lg ring-2 ring-white/20`}
            >
              <span className="font-display text-lg font-bold text-white">
                {getInitial(camper.first_name)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-bold">
                    {camper.first_name}
                    {camper.preferred_name && camper.preferred_name !== camper.first_name && (
                      <span className="font-normal text-white/90 italic">
                        {' '}
                        "{camper.preferred_name.replace(/^["']|["']$/g, '')}"{' '}
                      </span>
                    )}
                    {(!camper.preferred_name || camper.preferred_name === camper.first_name) && ' '}
                    {camper.last_name}
                  </h2>
                  <StatusBadge status={camper.attendee_status} />
                </div>
                <button
                  onClick={handleClose}
                  aria-label="Close panel"
                  className="-mr-1 rounded-lg p-1.5 transition-colors hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="text-forest-100 mt-1 flex items-center gap-2 text-xs">
                <span>{formatGenderShort(camper.gender)}</span>
                <span>•</span>
                <span>{camper.pronouns ?? 'No Preference'}</span>
                <span>•</span>
                <span>{formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)}</span>
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    camper.gender === 'M'
                      ? 'bg-sky-400/20 text-sky-200'
                      : camper.gender === 'F'
                        ? 'bg-pink-400/20 text-pink-200'
                        : 'bg-purple-400/20 text-purple-200'
                  }`}
                >
                  {getGenderIdentityDisplay(camper)}
                </span>
              </div>
              <div className="text-forest-100 mt-0.5 flex items-center gap-2 text-xs">
                <span>
                  {formatGradeOrdinal(camper.grade)}
                  {camper.school ? ` @ ${camper.school}` : ''}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">{renderContent()}</div>
        {renderFooter()}
      </div>
    )
  }

  // Slide-in panel with semi-transparent backdrop for click-outside close
  // Uses CSS animations instead of transitions for React Compiler compatibility
  return (
    <>
      {/* Backdrop - click to close panel */}
      <div
        data-testid="panel-backdrop"
        className="pointer-events-none fixed inset-0 z-[59]"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        data-panel="camper-details"
        className={`bg-card shadow-lodge-xl border-border fixed top-0 right-0 z-[60] w-[28rem] border-l transition-[bottom] duration-200 ease-out ${
          animationPhase === 'entering' ? 'animate-slide-in-right' : 'animate-slide-out-right'
        } ${actionBarBottom}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="flex h-full flex-col">
          {/* Premium Header */}
          <div className="from-forest-700 via-forest-800 to-forest-900 flex-shrink-0 bg-gradient-to-br text-white">
            <div className="p-5">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div
                  className={`h-16 w-16 rounded-2xl ${getAvatarColor(camper.gender)} flex flex-shrink-0 items-center justify-center shadow-lg ring-4 ring-white/20`}
                >
                  <span className="font-display text-2xl font-bold text-white">
                    {getInitial(camper.first_name)}
                  </span>
                </div>

                {/* Name and info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight">
                        {camper.first_name}
                        {camper.preferred_name && camper.preferred_name !== camper.first_name && (
                          <span className="font-normal text-white/90 italic">
                            {' '}
                            "{camper.preferred_name.replace(/^["']|["']$/g, '')}"{' '}
                          </span>
                        )}
                        {(!camper.preferred_name || camper.preferred_name === camper.first_name) &&
                          ' '}
                        {camper.last_name}
                      </h2>
                      <StatusBadge status={camper.attendee_status} />
                    </div>
                    <button
                      onClick={handleClose}
                      aria-label="Close panel"
                      className="-mr-1 rounded-xl p-2 transition-colors hover:bg-white/10"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="text-forest-100 mt-1 flex items-center gap-2 text-sm">
                    <span>
                      {camper.gender === 'M'
                        ? 'Male'
                        : camper.gender === 'F'
                          ? 'Female'
                          : 'Non-Binary'}
                    </span>
                    <span>•</span>
                    <span>{camper.pronouns ?? 'No Preference'}</span>
                    <span>•</span>
                    <span>{formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)}</span>
                  </div>
                  <div className="text-forest-100 mt-0.5 flex items-center gap-2 text-sm">
                    <span>
                      {formatGradeOrdinal(camper.grade)}
                      {camper.school ? ` @ ${camper.school}` : ''}
                    </span>
                  </div>

                  <div className="mt-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getGenderBadgeClasses(
                        getGenderCategory(getGenderIdentityDisplay(camper))
                      )} bg-opacity-20 backdrop-blur-sm`}
                    >
                      {getGenderIdentityDisplay(camper)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>

          {/* Footer */}
          {renderFooter()}
        </div>
      </div>
    </>
  )
}
