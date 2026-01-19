/**
 * CamperDetail - Container component for camper detail page
 *
 * This component orchestrates data fetching through hooks and
 * delegates rendering to extracted UI components.
 */
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { useYear } from '../hooks/useCurrentYear';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { getLocationDisplay } from '../utils/addressUtils';
import type { PersonsResponse } from '../types/pocketbase-types';

// Import extracted hooks
import {
  useCamperEnrollment,
  useCamperHistory,
  useSiblings,
  useOriginalBunkData,
  useAllBunkRequests,
  useSatisfactionData,
} from '../hooks/camper';

// Import extracted UI components
import {
  HeroHeader,
  IdentityPanel,
  BunkingStatusPanel,
  ParsedRequestsPanel,
  RawDataPanel,
  CampJourneyTimeline,
  SiblingsPanel,
} from './camper';

/**
 * Format pronouns display - use actual pronouns fields from V2 schema
 */
function formatPronouns(camper: {
  gender_pronoun_write_in?: string;
  gender_pronoun_name?: string;
}): string {
  // First check write-in field if it's not blank
  if (camper.gender_pronoun_write_in && camper.gender_pronoun_write_in.trim() !== '')
    return camper.gender_pronoun_write_in;
  // Then check name field
  if (camper.gender_pronoun_name) return camper.gender_pronoun_name;
  // Return "No Preference" instead of falling back to assumed pronouns
  return 'No Preference';
}

/**
 * Get session display name for quick stats
 */
function getSessionShortName(session: {
  session_type?: string;
  name?: string;
} | undefined): string {
  if (!session) return 'Unknown';
  if (session.session_type === 'ag') return session.name || 'AG';
  if (session.session_type === 'embedded') {
    const match = session.name?.match(/([23][ab])/i);
    if (match) return `Session ${match[1]}`;
  }
  if (session.session_type === 'main') {
    const match = session.name?.match(/(\d+)/);
    if (match) return `Session ${match[1]}`;
  }
  if (session.name?.toLowerCase().includes('taste')) return 'Taste of Camp';
  return session.name || 'Unknown';
}

export default function CamperDetail() {
  const { camperId } = useParams<{ camperId: string }>();
  const currentYear = useYear();
  const isAdmin = useIsAdmin();

  // Parse and validate the person CampMinder ID
  const personCmId = camperId ? parseInt(camperId, 10) : null;
  const isValidPersonId = !!personCmId && !isNaN(personCmId);

  // Fetch enrolled campers using extracted hook
  const {
    enrolledCampers,
    isLoading: camperLoading,
    error: camperError,
  } = useCamperEnrollment(personCmId, currentYear);

  // Get the person data separately for displaying even if no enrollments
  const { data: person, error: personError } = useQuery({
    queryKey: ['person', personCmId, currentYear],
    queryFn: async () => {
      if (!personCmId) throw new Error('Invalid person ID');
      const persons = await pb.collection<PersonsResponse>('persons').getList(1, 1, {
        filter: `cm_id = ${personCmId} && year = ${currentYear}`,
      });

      if (persons.items.length === 0) {
        throw new Error(`Person with CampMinder ID ${personCmId} not found`);
      }

      return persons.items[0];
    },
    enabled: isValidPersonId,
    retry: false,
    staleTime: 0,
  });

  // Log person fetch error if any
  if (personError) {
    console.error('Error fetching person:', personError);
  }

  // Select primary camper from enrolled campers
  const camper = enrolledCampers[0] ?? null;

  // Fetch camper's history using extracted hook
  const { camperHistory } = useCamperHistory(personCmId, currentYear, camper);

  // Fetch original CSV data using extracted hook
  const { originalBunkData } = useOriginalBunkData(camper?.person_cm_id, currentYear);

  // Fetch all bunk requests using extracted hook
  const { allBunkRequests } = useAllBunkRequests(camper?.person_cm_id, currentYear);

  // Fetch satisfaction data using extracted hook
  const { satisfactionData, isLoading: satisfactionLoading } = useSatisfactionData(
    camper?.person_cm_id,
    camper?.assigned_bunk_cm_id,
    camper?.session_cm_id,
    camper?.grade,
    currentYear,
    allBunkRequests
  );

  // Fetch siblings using extracted hook
  const {
    siblings,
    isLoading: siblingsLoading,
    error: siblingsError,
  } = useSiblings(person?.household_id, personCmId, currentYear);

  // Loading state
  if (camperLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
      </div>
    );
  }

  // Error state
  if (camperError) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Error loading person details</p>
        <p className="text-sm text-muted-foreground mt-2">
          {camperError?.message || 'Unable to load person information.'}
        </p>
      </div>
    );
  }

  // Show person info even if no current enrollments
  if ((person || enrolledCampers.length === 0) && !camper) {
    const displayPerson =
      person ||
      (enrolledCampers.length === 0 && personCmId
        ? { first_name: 'Person', last_name: `#${personCmId}`, cm_id: personCmId }
        : null);

    if (displayPerson) {
      return (
        <div className="space-y-6">
          <div className="bg-white dark:bg-card rounded-2xl shadow-sm border border-border p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <Link
                  to="/summer/campers"
                  className="text-sm text-muted-foreground hover:text-primary mb-2 inline-block font-medium"
                >
                  ← Back to All Campers
                </Link>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  {displayPerson.first_name} {displayPerson.last_name}
                </h1>
                <p className="text-muted-foreground mt-2 text-lg">
                  Person ID: {displayPerson.cm_id}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <p className="text-muted-foreground">
              This person has no active enrollments for {currentYear}.
            </p>
          </div>
        </div>
      );
    }
  }

  if (!camper) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Unable to load camper details</p>
      </div>
    );
  }

  // Computed values
  const location = getLocationDisplay(person?.address);
  const pronouns = formatPronouns(camper);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionShortName = getSessionShortName(camper.expand?.session as any);
  const agePreferenceRequests = allBunkRequests.filter(
    (r) => r.request_type === 'age_preference'
  );

  return (
    <div className="space-y-6">
      {/* Historical Data Notice */}
      {camper.expand?.session?.year && camper.expand.session.year !== currentYear && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
              You are viewing historical data from {camper.expand.session.year}. This
              camper may have different information for the current year.
            </p>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <HeroHeader
        camper={camper}
        currentYear={currentYear}
        location={location}
        sessionShortName={sessionShortName}
        pronouns={pronouns}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Identity & Details */}
          <IdentityPanel
            camper={camper}
            location={location}
            pronouns={pronouns}
            defaultExpanded={true}
          />

          {/* Bunking Status */}
          <BunkingStatusPanel
            camper={camper}
            sessionShortName={sessionShortName}
            allBunkRequests={allBunkRequests}
            agePreferenceRequests={agePreferenceRequests}
            satisfactionData={satisfactionData}
            satisfactionLoading={satisfactionLoading}
          />

          {/* Raw Bunking Data */}
          {originalBunkData && (
            <RawDataPanel
              data={originalBunkData}
              year={currentYear}
              defaultExpanded={false}
            />
          )}

          {/* Parsed Bunk Requests (admin only) */}
          {isAdmin && <ParsedRequestsPanel requests={allBunkRequests} />}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Camp Journey Timeline */}
          <CampJourneyTimeline
            history={camperHistory}
            yearsAtCamp={camper.years_at_camp || 0}
            currentYear={currentYear}
          />

          {/* Siblings */}
          <SiblingsPanel
            siblings={siblings}
            isLoading={siblingsLoading}
            error={siblingsError}
          />
        </div>
      </div>
    </div>
  );
}
