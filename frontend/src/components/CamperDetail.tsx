/**
 * CamperDetail - Container component for camper detail page
 *
 * This component orchestrates data fetching through hooks and
 * delegates rendering to extracted UI components.
 */
import { useContext, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Calendar } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import { useYear } from '../hooks/useCurrentYear'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '../constants/permissions'
import { getLocationDisplay } from '../utils/addressUtils'
import { getSessionShortName } from '../utils/sessionDisplay'
import { isTeenProgram } from '../utils/sessionTypePredicates'
import { BunkRequestContext } from '../contexts/BunkRequestContext'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'
import type { PersonsResponse } from '../types/pocketbase-types'

// Import extracted hooks
import {
  useCamperEnrollment,
  useCamperHistory,
  useSiblings,
  useOriginalBunkData,
  useAllBunkRequests,
} from '../hooks/camper'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import type { SatisfactionEntry } from '../types/satisfaction'
import { buildSatisfactionLookup } from '../utils/satisfactionLookup'

// Import extracted UI components
import {
  HeroHeader,
  IdentityPanel,
  BunkingStatusPanel,
  ParsedRequestsPanel,
  RawDataPanel,
  CampJourneyTimeline,
  SiblingsPanel,
} from './camper'
import type { Camper } from '../types/app-types'
import type {
  HistoricalRecord,
  OriginalBunkData,
  SiblingWithEnrollment,
} from '../hooks/camper/types'

/**
 * Format pronouns display - use actual pronouns fields from V2 schema
 */
function formatPronouns(camper: {
  gender_pronoun_write_in?: string
  gender_pronoun_name?: string
}): string {
  // First check write-in field if it's not blank
  if (camper.gender_pronoun_write_in && camper.gender_pronoun_write_in.trim() !== '')
    return camper.gender_pronoun_write_in
  // Then check name field
  if (camper.gender_pronoun_name) return camper.gender_pronoun_name
  // Return "No Preference" instead of falling back to assumed pronouns
  return 'No Preference'
}

interface CamperDetailBodyProps {
  camper: Camper
  enrolledCampers: Camper[]
  currentYear: number
  person: PersonsResponse | undefined
  allBunkRequests: EnhancedBunkRequest[]
  originalBunkData: OriginalBunkData | null | undefined
  siblings: SiblingWithEnrollment[]
  siblingsLoading: boolean
  siblingsError: Error | null
  camperHistory: HistoricalRecord[]
  canManageBunking: boolean
  isAdmin: boolean
}

/**
 * Renders the full camper detail UI. Must be mounted inside a BunkRequestProvider
 * so that useContext(BunkRequestContext) resolves to the session-scoped context.
 */
function CamperDetailBody({
  camper,
  enrolledCampers,
  currentYear,
  person,
  allBunkRequests,
  originalBunkData,
  siblings,
  siblingsLoading,
  siblingsError,
  camperHistory,
  canManageBunking,
  isAdmin,
}: CamperDetailBodyProps) {
  // Safe: this component is always rendered inside BunkRequestProvider (see CamperDetail).
  const bunkRequestCtx = useContext(BunkRequestContext)!
  const camperSatisfaction = bunkRequestCtx.getSatisfiedRequestInfo(camper.person_cm_id)

  // Teens aren't bunked and never enter request processing — hide bunk panels
  // and cohort context for teen-program sessions (spec §6.6).
  const isTeen = camper.expand?.session ? isTeenProgram(camper.expand.session) : false

  // Single source of truth for per-row satisfaction pills: read directly from
  // BunkRequestProvider's /api/satisfaction response. Replaces the previous
  // useSatisfactionData hook which independently fetched bunk_assignments.
  // Surfaces backend rows even when the camper is unassigned (the API returns
  // `(satisfied=false, detail="Requester not assigned")` for those rows —
  // honest rendering, matches the rest of the consolidated flow).
  const getRequestSatisfaction = useMemo<(id: string) => SatisfactionEntry>(
    () => buildSatisfactionLookup(camperSatisfaction.per_request),
    [camperSatisfaction.per_request]
  )

  // Computed values - use discrete columns instead of JSON parsing
  const location = getLocationDisplay(
    person?.normalized_city ?? person?.address_city,
    person?.address_state
  )
  const congregation = person?.normalized_congregation ?? null
  const pronouns = formatPronouns(camper)
  const sessionShortName = getSessionShortName(camper.expand?.session ?? undefined) ?? 'Unknown'
  const allSessionNames =
    enrolledCampers.length > 1
      ? enrolledCampers.map((c) => getSessionShortName(c.expand?.session ?? undefined) ?? 'Unknown')
      : undefined
  // BunkingStatusPanel surfaces only resolved rows. The admin
  // ParsedRequestsPanel below still consumes the unfiltered allBunkRequests
  // for debug.
  const agePreferenceRequests = allBunkRequests.filter(
    (r) => r.request_type === 'age_preference' && r.status === 'resolved'
  )

  return (
    <div className="space-y-6">
      {/* Historical Data Notice */}
      {camper.expand?.session?.year && camper.expand.session.year !== currentYear && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              You are viewing historical data from {camper.expand.session.year}. This camper may
              have different information for the current year.
            </p>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <HeroHeader
        camper={camper}
        enrolledCampers={enrolledCampers}
        currentYear={currentYear}
        location={location}
        sessionShortName={sessionShortName}
        pronouns={pronouns}
        allSessionNames={allSessionNames}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Identity & Details */}
          <IdentityPanel
            camper={camper}
            location={location}
            congregation={congregation}
            pronouns={pronouns}
            defaultExpanded={true}
            cohortContext={
              camper.attendee_status === 'enrolled' &&
              !isTeen &&
              camper.expand?.session?.year === currentYear &&
              camper.person_cm_id &&
              camper.session_cm_id > 0
                ? {
                    personCmId: camper.person_cm_id,
                    sessionCmId: camper.session_cm_id,
                    year: currentYear,
                    selfDisplayName:
                      camper.preferred_name?.trim() || camper.first_name || 'this camper',
                  }
                : undefined
            }
          />

          {/* Bunking panels - only shown for enrolled, non-teen campers */}
          {camper.attendee_status === 'enrolled' && !isTeen && (
            <>
              {/* Bunking Status */}
              <BunkingStatusPanel
                camper={camper}
                enrolledCampers={enrolledCampers}
                sessionShortName={sessionShortName}
                allBunkRequests={allBunkRequests}
                agePreferenceRequests={agePreferenceRequests}
                getRequestSatisfaction={getRequestSatisfaction}
                camperSatisfaction={camperSatisfaction}
              />

              {/* Raw Bunking Data (admin only) */}
              {canManageBunking && originalBunkData && (
                <RawDataPanel data={originalBunkData} year={currentYear} defaultExpanded={false} />
              )}

              {/* Parsed Bunk Requests (admin only) */}
              {isAdmin && <ParsedRequestsPanel requests={allBunkRequests} />}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Camp Journey Timeline */}
          <CampJourneyTimeline
            history={camperHistory}
            yearsAtCamp={camper.years_at_camp ?? 0}
            currentYear={currentYear}
          />

          {/* Siblings */}
          <SiblingsPanel siblings={siblings} isLoading={siblingsLoading} error={siblingsError} />
        </div>
      </div>
    </div>
  )
}

export default function CamperDetail() {
  const { camperId } = useParams<{ camperId: string }>()
  const currentYear = useYear()
  const { hasPermission, isAdmin } = usePermissions()
  const canManageBunking = hasPermission(Permission.BUNKING_MANAGE)

  // Parse and validate the person CampMinder ID
  const personCmId = camperId ? parseInt(camperId, 10) : null
  const isValidPersonId = !!personCmId && !isNaN(personCmId)

  // Fetch enrolled campers using extracted hook
  const {
    enrolledCampers,
    allAttendees,
    isLoading: camperLoading,
    error: camperError,
  } = useCamperEnrollment(personCmId, currentYear)

  // Get the person data separately for displaying even if no enrollments
  const { data: person, error: personError } = useQuery({
    queryKey: ['person', personCmId, currentYear],
    queryFn: async () => {
      if (!personCmId) throw new Error('Invalid person ID')
      const persons = await pb.collection<PersonsResponse>('persons').getList(1, 1, {
        filter: `cm_id = ${personCmId} && year = ${currentYear}`,
      })

      if (persons.items.length === 0) {
        throw new Error(`Person with CampMinder ID ${personCmId} not found`)
      }

      return persons.items[0]
    },
    enabled: isValidPersonId,
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (personError) {
      console.error('Error fetching person:', personError)
    }
  }, [personError])

  // Select primary camper: prefer enrolled, fall back to first attendee
  const camper = enrolledCampers[0] ?? allAttendees[0] ?? null

  // Fetch camper's history using extracted hook (pass all attendees for status-aware filtering)
  const { camperHistory } = useCamperHistory(personCmId, currentYear, camper, allAttendees)

  // Fetch original CSV data using extracted hook
  const { originalBunkData } = useOriginalBunkData(camper?.person_cm_id, currentYear)

  // Fetch all bunk requests using extracted hook
  const { allBunkRequests } = useAllBunkRequests(camper?.person_cm_id, currentYear)

  // Fetch siblings using extracted hook
  const {
    siblings,
    isLoading: siblingsLoading,
    error: siblingsError,
  } = useSiblings(person?.household_id, personCmId, currentYear)

  // Loading state
  if (camperLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="border-muted border-t-primary h-8 w-8 animate-spin rounded-full border-4"></div>
      </div>
    )
  }

  // Error state
  if (camperError) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Error loading person details</p>
        <p className="text-muted-foreground mt-2 text-sm">
          {camperError.message || 'Unable to load person information.'}
        </p>
      </div>
    )
  }

  // Show person info even if no current enrollments
  if ((person || allAttendees.length === 0) && !camper) {
    const displayPerson =
      person ??
      (allAttendees.length === 0 && personCmId
        ? {
            first_name: 'Person',
            last_name: `#${personCmId}`,
            cm_id: personCmId,
          }
        : null)

    if (displayPerson) {
      return (
        <div className="space-y-6">
          <div className="dark:bg-card border-border rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Link
                  to="/campers"
                  className="text-muted-foreground hover:text-primary mb-2 inline-block text-sm font-medium"
                >
                  ← Back to All Campers
                </Link>
                <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
                  {displayPerson.first_name} {displayPerson.last_name}
                </h1>
                <p className="text-muted-foreground mt-2 text-lg">
                  Person ID: {displayPerson.cm_id}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border-border rounded-2xl border p-6 shadow-sm">
            <p className="text-muted-foreground">
              This person has no active enrollments for {currentYear}.
            </p>
          </div>
        </div>
      )
    }
  }

  if (!camper) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Unable to load camper details</p>
      </div>
    )
  }

  // camper is guaranteed non-null past this point.
  // Wrap in BunkRequestProvider so CamperDetailBody's useContext(BunkRequestContext)
  // resolves to the session-scoped context — without this, the context is undefined
  // and BunkingStatusPanel hides the "X/Y met" summary (EMPTY fallback gives total=0).
  // Camp is single-session-per-camper; session_cm_id ?? 0 is safe for unassigned campers.
  return (
    <BunkRequestProvider sessionCmId={camper.session_cm_id ?? 0}>
      <CamperDetailBody
        camper={camper}
        enrolledCampers={enrolledCampers}
        currentYear={currentYear}
        person={person}
        allBunkRequests={allBunkRequests}
        originalBunkData={originalBunkData}
        siblings={siblings}
        siblingsLoading={siblingsLoading}
        siblingsError={siblingsError}
        camperHistory={camperHistory}
        canManageBunking={canManageBunking}
        isAdmin={isAdmin}
      />
    </BunkRequestProvider>
  )
}
