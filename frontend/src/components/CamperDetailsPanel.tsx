import { useState, useCallback } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Calendar,
  Heart,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  FileText,
  MapPin,
  TreePine,
  Home,
  Users,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { pb } from '../lib/pocketbase'
import { StatusBadge } from './StatusBadge'
import {
  getGenderIdentityDisplay,
  getGenderCategory,
  getGenderBadgeClasses,
} from '../utils/genderUtils'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { formatAge } from '../utils/age'
import { getSessionDisplayNameFromString } from '../utils/sessionDisplay'
import { VALID_SUMMER_SESSION_TYPES } from '../constants/sessionTypes'
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
import { isAgePreferenceSatisfied } from '../utils/agePreferenceSatisfaction'
import { useYear } from '../hooks/useCurrentYear'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { CampMinderIcon } from './icons'
import CamperLink from './CamperLink'
import { getAvatarColor, getInitial } from '../utils/avatarUtils'
import { getLocationDisplay } from '../utils/addressUtils'

// Satisfaction check types
type SatisfactionStatus = 'satisfied' | 'not_satisfied' | 'checking' | 'unknown'
interface SatisfactionResult {
  status: SatisfactionStatus
  detail?: string
}
type SatisfactionMap = Record<string, SatisfactionResult>

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
}

// Interface for historical records
interface HistoricalRecord {
  year: number
  sessionName: string
  sessionType: string
  bunkName: string
}

// Interface for current-year enrollment (one per attendee record)
interface CurrentEnrollment {
  sessionName: string
  sessionType: string
  sessionCmId: number
  bunkName: string | null
}

export default function CamperDetailsPanel({
  camperId,
  onClose,
  embedded = false,
  requestClose = false,
}: CamperDetailsPanelProps) {
  // Animation phase derived from requestClose prop - 'exiting' when close requested, 'entering' otherwise
  // This avoids the anti-pattern of setting state in useEffect based on prop changes
  const animationPhase: AnimationPhase = requestClose ? 'exiting' : 'entering'
  const currentYear = useYear()

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    requests: true,
    history: true,
    siblings: true,
    rawData: false,
  })

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Handle animation completion - call onClose when exit animation finishes
  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Only respond to the exit animation completing on the panel itself
      if (animationPhase === 'exiting' && e.animationName.includes('Out')) {
        onClose()
      }
    },
    [animationPhase, onClose]
  )

  // Fetch camper details + all current-year enrollments
  const { data: camperData, isLoading: camperLoading } = useQuery({
    queryKey: ['camper-details', camperId, currentYear],
    queryFn: async () => {
      const personId = parseInt(camperId)
      const persons = await pb.collection('persons').getFullList({
        filter: `cm_id = ${personId} && year = ${currentYear}`,
      })

      if (persons.length === 0) throw new Error('Person not found')
      const person = persons[0] as PersonsResponse

      // Filter to only valid summer session types (main, embedded, ag) - excludes Family Camp
      const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(
        (t) => `session.session_type = "${t}"`
      ).join(' || ')
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
        is_active: false,
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

      // Build enrollments list from ALL attendee records
      const enrollments: CurrentEnrollment[] = []
      const primaryAttendee = attendees[0]
      let primarySession: ExpandedSession | null = null
      let primaryAssignment = null
      let primaryBunk: ExpandedBunk | null = null

      for (const att of attendees) {
        const expAtt = att?.expand as { session?: ExpandedSession } | undefined
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
        primaryAttendee || dummyAttendee,
        primaryAssignment,
        primaryBunk as BunksResponse | null,
        primarySession as CampSessionsResponse | null
      )

      return { camper, enrollments }
    },
    retry: false,
  })

  const camper = camperData?.camper
  const currentEnrollments = camperData?.enrollments ?? []

  // Fetch person data for siblings query
  const { data: person } = useQuery({
    queryKey: ['person-for-siblings', camperId, currentYear],
    queryFn: async () => {
      const personId = parseInt(camperId)
      const persons = await pb.collection<PersonsResponse>('persons').getList(1, 1, {
        filter: `cm_id = ${personId} && year = ${currentYear}`,
      })
      return persons.items[0] || null
    },
    enabled: !!camperId,
  })

  // Fetch historical bunking data
  const { data: historicalData = [] } = useQuery({
    queryKey: ['camper-history', camperId],
    queryFn: async () => {
      const personCmId = parseInt(camperId)
      const filter = `person.cm_id = ${personCmId} && year < ${currentYear}`
      const assignments = await pb.collection('bunk_assignments').getFullList({
        filter,
        expand: 'person,session,bunk',
        sort: '-year',
      })

      const allowedTypes = ['main', 'ag', 'embedded', 'taste']
      return assignments
        .filter((record) => {
          const expanded = record.expand as ExpandedAssignment | undefined
          const sessionType = expanded?.session?.session_type
          return sessionType && allowedTypes.includes(sessionType)
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
  const { data: bunkRequests = [] } = useQuery({
    queryKey: ['person-bunk-requests', camper?.person_cm_id, currentYear],
    queryFn: async () => {
      if (!camper?.person_cm_id) throw new Error('No camper person ID')

      const filter = `requester_id = ${camper.person_cm_id} && year = ${currentYear}`
      const requests = await pb.collection('bunk_requests').getFullList<BunkRequestsResponse>({
        filter,
        sort: '-priority,request_type',
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

      return requests.map((req) => {
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
          metadata: req.metadata || ({} as Record<string, unknown>),
        }
      })
    },
    enabled: !!camper?.person_cm_id,
  })

  // Fetch siblings
  const { data: siblings = [] } = useQuery({
    queryKey: ['camper-siblings-panel', person?.household_id, camperId, currentYear],
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
          const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(
            (t) => `session.session_type = "${t}"`
          ).join(' || ')
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
              const typeOrder: Record<string, number> = {
                main: 1,
                embedded: 2,
                ag: 3,
              }
              return (typeOrder[aType] ?? 999) - (typeOrder[bType] ?? 999)
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
                    filter: `person = "${siblingPerson?.id || ''}" && session = "${session?.id || ''}" && year = ${currentYear}`,
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

            return { ...siblingPerson, session, bunkName }
          } catch {
            return null
          }
        })
      )

      return siblingsWithEnrollment.filter((s) => s !== null)
    },
    enabled: !!(person?.household_id && person.household_id > 0),
  })

  // Fetch original CSV data
  interface OriginalBunkData {
    share_bunk_with?: string
    share_bunk_with_updated?: string
    do_not_share_bunk_with?: string
    do_not_share_bunk_with_updated?: string
    internal_bunk_notes?: string
    internal_bunk_notes_updated?: string
    bunking_notes_notes?: string
    bunking_notes_notes_updated?: string
    ret_parent_socialize_with_best?: string
    ret_parent_socialize_with_best_updated?: string
  }

  const { data: originalBunkData } = useQuery({
    queryKey: ['original-bunk-requests', camper?.person_cm_id, currentYear],
    queryFn: async (): Promise<OriginalBunkData | null> => {
      if (!camper?.person_cm_id) throw new Error('No camper person ID')
      try {
        const filter = `person_id = ${camper.person_cm_id} && year = ${currentYear}`
        const records = await pb.collection('original_bunk_requests').getList(1, 1, { filter })
        if (records.items.length === 0) return null
        return records.items[0] as OriginalBunkData
      } catch {
        return null
      }
    },
    enabled: !!camper?.person_cm_id,
  })

  // Trigger close - for embedded mode, call directly; for slide panel, animation handles it
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Helper: get location from person's discrete address columns
  const location = getLocationDisplay(
    person?.normalized_city ?? person?.address_city,
    person?.address_state
  )

  const getSessionShortName = () => {
    const session = camper?.expand?.session
    if (!session) return null
    if (session.session_type === 'ag') return session.name
    if (session.session_type === 'embedded') {
      const match = session.name?.match(/([23][ab])/i)
      if (match) return `Session ${match[1]}`
    }
    if (session.session_type === 'main') {
      const match = session.name?.match(/(\d+)/)
      if (match) return `Session ${match[1]}`
    }
    if (session.name?.toLowerCase().includes('taste')) return 'Taste of Camp'
    return session.name || 'Unknown'
  }

  /** Get short display name for an enrollment's session. */
  const getEnrollmentShortName = (enrollment: CurrentEnrollment): string => {
    if (enrollment.sessionType === 'ag') return enrollment.sessionName
    if (enrollment.sessionType === 'embedded') {
      const match = enrollment.sessionName.match(/([23][ab])/i)
      if (match) return `Session ${match[1]}`
    }
    if (enrollment.sessionType === 'main') {
      const match = enrollment.sessionName.match(/(\d+)/)
      if (match) return `Session ${match[1]}`
    }
    if (enrollment.sessionName.toLowerCase().includes('taste')) return 'Taste of Camp'
    return enrollment.sessionName || 'Unknown'
  }

  // Get age preference request for socializes best with
  const agePreferenceRequest = bunkRequests.find((r) => r.request_type === 'age_preference')

  // Lazy-load satisfaction checks - cached per camper for efficient switching
  const { data: satisfactionData = {}, isLoading: satisfactionLoading } = useQuery<SatisfactionMap>(
    {
      queryKey: [
        'panel-satisfaction',
        camper?.person_cm_id,
        camper?.assigned_bunk_cm_id,
        camper?.session_cm_id,
        camper?.grade,
        currentYear,
        bunkRequests.map((r) => r.id).join(','),
      ],
      queryFn: async () => {
        const results: SatisfactionMap = {}

        if (!camper?.assigned_bunk_cm_id || !camper?.session_cm_id) {
          return results // Requester not assigned - can't check
        }

        // Get resolved person-based requests
        const resolvedPersonRequests = bunkRequests.filter(
          (r) =>
            r.status === 'resolved' &&
            r.requestee_id &&
            r.requestee_id > 0 &&
            (r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with')
        )

        // Get age preference requests
        const agePrefs = bunkRequests.filter(
          (r) => r.request_type === 'age_preference' && r.age_preference_target
        )

        if (resolvedPersonRequests.length === 0 && agePrefs.length === 0) {
          return results
        }

        try {
          const allAssignments = await pb
            .collection<BunkAssignmentsResponse>('bunk_assignments')
            .getFullList({
              filter: `year = ${currentYear}`,
              expand: 'person,bunk,session',
            })

          // Filter to same session
          const sessionAssignments = allAssignments.filter((a) => {
            const expanded = a.expand as ExpandedAssignment | undefined
            const sessionCmId = expanded?.session?.cm_id
            return sessionCmId === camper.session_cm_id
          })

          // Build lookup maps
          const personToBunk = new Map<number, number>()
          const bunkToPersons = new Map<number, Array<{ cmId: number; grade: number }>>()

          sessionAssignments.forEach((a) => {
            const expanded = a.expand as ExpandedAssignment | undefined
            const person = expanded?.person
            const bunk = expanded?.bunk
            const personCmId = person?.cm_id
            const bunkCmId = bunk?.cm_id
            const grade = person?.grade

            if (personCmId && bunkCmId) {
              personToBunk.set(personCmId, bunkCmId)
              if (!bunkToPersons.has(bunkCmId)) bunkToPersons.set(bunkCmId, [])
              if (grade !== undefined && grade !== null) {
                const bunkPersons = bunkToPersons.get(bunkCmId)
                if (bunkPersons) {
                  bunkPersons.push({ cmId: personCmId, grade })
                }
              }
            }
          })

          // Check person-based requests
          for (const req of resolvedPersonRequests) {
            if (!req.requestee_id) continue
            const targetBunk = personToBunk.get(req.requestee_id)
            if (!targetBunk) {
              results[req.id] = {
                status: 'unknown',
                detail: 'Target not assigned',
              }
              continue
            }
            const sameBunk = camper.assigned_bunk_cm_id === targetBunk

            if (req.request_type === 'bunk_with') {
              results[req.id] = {
                status: sameBunk ? 'satisfied' : 'not_satisfied',
                detail: sameBunk ? 'Same bunk' : 'Different bunks',
              }
            } else {
              results[req.id] = {
                status: !sameBunk ? 'satisfied' : 'not_satisfied',
                detail: !sameBunk ? 'Different bunks' : 'Same bunk!',
              }
            }
          }

          // Check age preference requests
          for (const req of agePrefs) {
            const allInBunk = bunkToPersons.get(camper.assigned_bunk_cm_id) || []
            // Filter out the camper to get only bunkmates
            const bunkmates = allInBunk.filter((b) => b.cmId !== camper.person_cm_id)

            if (bunkmates.length === 0) {
              results[req.id] = {
                status: 'unknown',
                detail: 'No bunkmates yet',
              }
              continue
            }

            const camperGrade = camper.grade
            const bunkmateGrades = bunkmates
              .map((b) => b.grade)
              .filter((g): g is number => g !== null && g !== undefined)

            if (bunkmateGrades.length === 0) {
              results[req.id] = {
                status: 'unknown',
                detail: 'No bunkmate grades available',
              }
              continue
            }

            // Use shared utility for consistent satisfaction logic
            const preference = req.age_preference_target as 'older' | 'younger'
            const { satisfied, detail } = isAgePreferenceSatisfied(
              camperGrade,
              bunkmateGrades,
              preference
            )

            // Create grade breakdown for rich UI display
            const gradeCounts = new Map<number, number>()
            bunkmates.forEach((b) => {
              if (b.grade !== null && b.grade !== undefined) {
                gradeCounts.set(b.grade, (gradeCounts.get(b.grade) || 0) + 1)
              }
            })
            const gradeBreakdown = Array.from(gradeCounts.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([g, c]) => `${formatGradeOrdinal(g)}: ${c}`)
              .join(' | ')

            results[req.id] = {
              status: satisfied ? 'satisfied' : 'not_satisfied',
              detail: `${gradeBreakdown} — ${detail}`,
            }
          }

          return results
        } catch (error) {
          console.error('Satisfaction check error:', error)
          return results
        }
      },
      enabled: !!camper?.person_cm_id && bunkRequests.length > 0,
      staleTime: 60000, // Cache 1 min - fast switching between campers
    }
  )

  // Loading state
  if (camperLoading) {
    return embedded ? (
      <div className="card-lodge flex min-h-[300px] items-center justify-center p-8">
        <div className="spinner-lodge"></div>
      </div>
    ) : (
      <div className="bg-card shadow-lodge-xl border-border fixed inset-y-0 right-0 z-[60] flex w-[28rem] items-center justify-center border-l">
        <div className="spinner-lodge"></div>
      </div>
    )
  }

  // Not found state
  if (!camper) {
    return embedded ? (
      <div className="card-lodge p-6">
        <div className="text-muted-foreground text-center">Camper not found</div>
      </div>
    ) : (
      <div className="bg-card shadow-lodge-xl border-border fixed inset-y-0 right-0 z-[60] w-[28rem] border-l p-6">
        <div className="text-muted-foreground text-center">Camper not found</div>
      </div>
    )
  }

  // Collapsible Section Header
  const SectionHeader = ({
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
    accentColor?: 'forest' | 'amber' | 'pink' | 'stone'
  }) => {
    const colorClasses = {
      forest: 'bg-forest-50 dark:bg-forest-900/60 text-forest-700 dark:text-forest-100',
      amber: 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-100',
      pink: 'bg-pink-50 dark:bg-pink-900/60 text-pink-700 dark:text-pink-100',
      stone: 'bg-stone-100 dark:bg-stone-700/60 text-stone-700 dark:text-stone-100',
    }

    return (
      <button
        onClick={onToggle}
        className={`flex w-full items-center justify-between rounded-xl p-2.5 transition-all duration-200 hover:scale-[1.01] ${colorClasses[accentColor]}`}
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
              {camper.years_at_camp || 0} {(camper.years_at_camp || 0) === 1 ? 'year' : 'years'}
            </span>
          </div>
          {currentEnrollments.length > 1 ? (
            currentEnrollments.map((enrollment) => (
              <div
                key={enrollment.sessionCmId}
                className="text-forest-100 flex items-center gap-1.5"
              >
                <Calendar className="text-forest-300 h-3 w-3" />
                <span>
                  {getEnrollmentShortName(enrollment)}
                  {enrollment.bunkName ? (
                    <>
                      {' '}
                      <Home className="text-forest-300 inline h-3 w-3" /> {enrollment.bunkName}
                    </>
                  ) : (
                    <span className="text-amber-300"> (unassigned)</span>
                  )}
                </span>
              </div>
            ))
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
        {/* Bunking Preferences - Compact view */}
        {bunkRequests && bunkRequests.length > 0 && (
          <section>
            <SectionHeader
              title="Bunking Preferences"
              icon={Heart}
              isExpanded={expandedSections.requests}
              onToggle={() => toggleSection('requests')}
              badge={bunkRequests.length}
              accentColor="forest"
            />
            {expandedSections.requests && (
              <div className="mt-2 space-y-1">
                {bunkRequests
                  .filter((r) => r.request_type !== 'age_preference')
                  .map((request, idx) => {
                    const isConfirmed = Boolean(
                      request.status === 'resolved' &&
                      request.requestee_id &&
                      request.requestee_id > 0
                    )
                    const isBunkWith = request.request_type === 'bunk_with'
                    const satisfaction = satisfactionData[request.id]
                    const showSatisfaction = isConfirmed

                    return (
                      <div
                        key={idx}
                        className="hover:bg-muted/50 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors"
                      >
                        {/* Status indicator */}
                        {request.status === 'resolved' ? (
                          <CheckCircle className="text-forest-600 dark:text-forest-400 h-4 w-4 flex-shrink-0" />
                        ) : request.status === 'declined' ? (
                          <XCircle className="text-bark-600 dark:text-bark-400 h-4 w-4 flex-shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 flex-shrink-0 text-amber-500" />
                        )}

                        {/* Type label */}
                        <span
                          className={`text-muted-foreground ${!isBunkWith ? 'text-red-600 dark:text-red-400' : ''}`}
                        >
                          {isBunkWith ? 'Bunk with' : 'Not bunk with'}
                        </span>

                        {/* Arrow */}
                        <span className="text-muted-foreground">→</span>

                        {/* Target - clickable if confirmed */}
                        <CamperLink
                          personCmId={request.requestee_id}
                          displayName={request.requestedPersonName || 'Unknown'}
                          isConfirmed={isConfirmed}
                          showUnresolved={!isConfirmed && !!request.requestedPersonName}
                        />

                        {/* Reciprocal badge - only if reciprocal */}
                        {request.is_reciprocal && (
                          <span className="bg-forest-100 dark:bg-forest-900/50 text-forest-700 dark:text-forest-300 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            mutual
                          </span>
                        )}

                        {/* Satisfaction - concise icon only */}
                        {showSatisfaction && (
                          <span className="ml-auto" title={satisfaction?.detail}>
                            {satisfactionLoading ? (
                              <span className="sat-spinner" />
                            ) : satisfaction?.status === 'satisfied' ? (
                              <span className="sat-icon sat-icon-met">✓</span>
                            ) : satisfaction?.status === 'not_satisfied' ? (
                              <span className="sat-icon sat-icon-unmet">✗</span>
                            ) : satisfaction?.status === 'unknown' ? (
                              <span className="sat-icon sat-icon-unknown">?</span>
                            ) : null}
                          </span>
                        )}
                      </div>
                    )
                  })}

                {/* Age preference - subtle at bottom with satisfaction */}
                {agePreferenceRequest?.age_preference_target &&
                  (() => {
                    const ageSatisfaction = satisfactionData[agePreferenceRequest.id]
                    const prefersOlder = agePreferenceRequest.age_preference_target === 'older'
                    const hasOtherRequests =
                      bunkRequests.filter((r) => r.request_type !== 'age_preference').length > 0

                    return (
                      <div
                        className={`text-muted-foreground flex items-center gap-2 px-2 text-xs ${hasOtherRequests ? 'border-border/50 mt-3 border-t pt-2' : ''}`}
                      >
                        <Sparkles className="h-3 w-3 flex-shrink-0 text-amber-500" />
                        <span>
                          Prefers bunking with{' '}
                          <span className="text-foreground font-medium">
                            {prefersOlder ? 'older' : 'younger'}
                          </span>{' '}
                          campers
                        </span>

                        {/* Satisfaction icon */}
                        <span className="ml-auto" title={ageSatisfaction?.detail}>
                          {satisfactionLoading ? (
                            <span className="sat-spinner" />
                          ) : ageSatisfaction?.status === 'satisfied' ? (
                            <span className="sat-icon sat-icon-met">✓</span>
                          ) : ageSatisfaction?.status === 'not_satisfied' ? (
                            <span className="sat-icon sat-icon-unmet">✗</span>
                          ) : ageSatisfaction?.status === 'unknown' ? (
                            <span className="sat-icon sat-icon-unknown">?</span>
                          ) : null}
                        </span>
                      </div>
                    )
                  })()}
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
              badge={camper.years_at_camp || historicalData.length + 1}
              accentColor="forest"
            />
            {expandedSections.history && (
              <div className="relative mt-2">
                {/* Timeline line */}
                <div className="bg-forest-200 dark:bg-forest-800 absolute top-1 bottom-1 left-[5px] w-0.5" />

                <div className="space-y-1.5">
                  {/* Current year - show all enrollments */}
                  {currentEnrollments.length > 0
                    ? currentEnrollments.map((enrollment, idx) => (
                        <div
                          key={`current-${enrollment.sessionCmId}`}
                          className="relative flex items-center gap-2.5"
                        >
                          <div className="bg-forest-600 ring-forest-100 dark:ring-forest-900 relative z-10 h-3 w-3 flex-shrink-0 rounded-full ring-2" />
                          <span className="text-forest-700 dark:text-forest-300 w-11 text-sm font-bold">
                            {idx === 0 ? currentYear : ''}
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {getEnrollmentShortName(enrollment)}
                          </span>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span
                            className={`truncate text-xs ${enrollment.bunkName ? 'text-foreground font-medium' : 'text-amber-600 italic'}`}
                          >
                            {enrollment.bunkName || 'Unassigned'}
                          </span>
                          {idx === 0 && (
                            <span className="bg-forest-600 ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white">
                              Now
                            </span>
                          )}
                        </div>
                      ))
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
                            className={`truncate text-xs ${camper.expand?.assigned_bunk ? 'text-foreground font-medium' : 'text-amber-600 italic'}`}
                          >
                            {camper.expand?.assigned_bunk?.name || 'Unassigned'}
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
                      <div className="text-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 truncate text-sm font-medium">
                        {sibling.preferred_name || sibling.first_name} {sibling.last_name}
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

        {/* Raw CSV Data - Collapsed by default */}
        {originalBunkData && (
          <section>
            <SectionHeader
              title="Raw CSV Data"
              icon={FileText}
              isExpanded={expandedSections.rawData}
              onToggle={() => toggleSection('rawData')}
              accentColor="stone"
            />
            {expandedSections.rawData && (
              <div className="mt-2 space-y-2 text-xs">
                {originalBunkData.share_bunk_with && (
                  <div className="bg-muted/50 rounded-lg p-2">
                    <span className="text-muted-foreground font-medium">Share Bunk With:</span>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">
                      {originalBunkData.share_bunk_with}
                    </p>
                  </div>
                )}
                {originalBunkData.do_not_share_bunk_with && (
                  <div className="bg-muted/50 rounded-lg p-2">
                    <span className="text-muted-foreground font-medium">Don't Share With:</span>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">
                      {originalBunkData.do_not_share_bunk_with}
                    </p>
                  </div>
                )}
                {originalBunkData.internal_bunk_notes && (
                  <div className="bg-muted/50 rounded-lg p-2">
                    <span className="text-muted-foreground font-medium">Internal Notes:</span>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">
                      {originalBunkData.internal_bunk_notes}
                    </p>
                  </div>
                )}
                {originalBunkData.bunking_notes_notes && (
                  <div className="bg-muted/50 rounded-lg p-2">
                    <span className="text-muted-foreground font-medium">Bunking Notes:</span>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">
                      {originalBunkData.bunking_notes_notes}
                    </p>
                  </div>
                )}
                {originalBunkData.ret_parent_socialize_with_best && (
                  <div className="bg-muted/50 rounded-lg p-2">
                    <span className="text-muted-foreground font-medium">Socializes Best With:</span>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">
                      {originalBunkData.ret_parent_socialize_with_best}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
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
                  <StatusBadge status={camper?.attendee_status} />
                </div>
                <button
                  onClick={handleClose}
                  className="-mr-1 rounded-lg p-1.5 transition-colors hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="text-forest-100 mt-1 flex items-center gap-2 text-xs">
                <span>{camper.gender === 'M' ? 'M' : camper.gender === 'F' ? 'F' : 'NB'}</span>
                <span>•</span>
                <span>{camper.pronouns || 'No Preference'}</span>
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

  // Slide-in panel (no backdrop - workspace stays active)
  // Uses CSS animations instead of transitions for React Compiler compatibility
  return (
    <div
      data-panel="camper-details"
      className={`bg-card shadow-lodge-xl border-border fixed inset-y-0 right-0 z-[60] w-[28rem] border-l ${
        animationPhase === 'entering' ? 'animate-slide-in-right' : 'animate-slide-out-right'
      }`}
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
                    <StatusBadge status={camper?.attendee_status} />
                  </div>
                  <button
                    onClick={handleClose}
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
                  <span>{camper.pronouns || 'No Preference'}</span>
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
  )
}
