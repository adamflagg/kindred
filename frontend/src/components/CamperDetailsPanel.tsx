import { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
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
  Sparkles
} from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { getGenderIdentityDisplay, getGenderCategory, getGenderBadgeClasses } from '../utils/genderUtils';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { formatAge } from '../utils/age';
import { getSessionDisplayNameFromString } from '../utils/sessionDisplay';
import { VALID_SUMMER_SESSION_TYPES } from '../constants/sessionTypes';
import type { PersonsResponse, AttendeesResponse, BunkRequestsResponse, BunkAssignmentsResponse, BunksResponse, CampSessionsResponse } from '../types/pocketbase-types';
import { Collections } from '../types/pocketbase-types';
import { toAppCamper } from '../utils/transforms';
import { isAgePreferenceSatisfied } from '../utils/agePreferenceSatisfaction';
import { useYear } from '../hooks/useCurrentYear';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { CampMinderIcon } from './icons';
import CamperLink from './CamperLink';
import { getAvatarColor, getInitial } from '../utils/avatarUtils';
import { getLocationDisplay } from '../utils/addressUtils';
import { calculateAge } from '../utils/ageCalculator';

// Satisfaction check types
type SatisfactionStatus = 'satisfied' | 'not_satisfied' | 'checking' | 'unknown';
interface SatisfactionResult {
  status: SatisfactionStatus;
  detail?: string;
}
type SatisfactionMap = Record<string, SatisfactionResult>;

// Type for expanded records with relations
interface ExpandedSession {
  session_type?: string;
  id?: string;
  cm_id?: number;
  name?: string;
}

interface ExpandedPerson {
  cm_id?: number;
  grade?: number;
}

interface ExpandedBunk {
  cm_id?: number;
  name?: string;
}

interface ExpandedAssignment {
  session?: ExpandedSession;
  person?: ExpandedPerson;
  bunk?: ExpandedBunk;
}

// Animation state machine - replaces isOpen/isClosing booleans
type AnimationPhase = 'entering' | 'exiting';

interface CamperDetailsPanelProps {
  camperId: string;
  onClose: () => void;
  embedded?: boolean;
  requestClose?: boolean; // When true, triggers animated close
}

// Interface for historical records
interface HistoricalRecord {
  year: number;
  sessionName: string;
  sessionType: string;
  bunkName: string;
}

export default function CamperDetailsPanel({ camperId, onClose, embedded = false, requestClose = false }: CamperDetailsPanelProps) {
  // Animation phase derived from requestClose prop - 'exiting' when close requested, 'entering' otherwise
  // This avoids the anti-pattern of setting state in useEffect based on prop changes
  const animationPhase: AnimationPhase = requestClose ? 'exiting' : 'entering';
  const currentYear = useYear();

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    requests: true,
    history: true,
    siblings: true,
    rawData: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Handle animation completion - call onClose when exit animation finishes
  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    // Only respond to the exit animation completing on the panel itself
    if (animationPhase === 'exiting' && e.animationName.includes('Out')) {
      onClose();
    }
  }, [animationPhase, onClose]);

  // Fetch camper details
  const { data: camper, isLoading: camperLoading } = useQuery({
    queryKey: ['camper-details', camperId, currentYear],
    queryFn: async () => {
      const personId = parseInt(camperId);
      const persons = await pb.collection('persons').getFullList({
        filter: `cm_id = ${personId} && year = ${currentYear}`
      });

      if (persons.length === 0) throw new Error('Person not found');
      const person = persons[0] as PersonsResponse;

      // Filter to only valid summer session types (main, embedded, ag) - excludes Family Camp
      const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(t => `session.session_type = "${t}"`).join(' || ');
      const attendees = await pb.collection('attendees').getFullList<AttendeesResponse>({
        filter: `person_id = ${personId} && year = ${currentYear} && status = "enrolled" && (${sessionTypeFilter})`,
        expand: 'session'
      });

      const dummyAttendee = {
        id: '', person: person.id, person_id: personId,
        session: '', enrollment_date: new Date().toISOString(),
        is_active: true, status: 'enrolled' as const, status_id: 1,
        year: currentYear, collectionId: '', collectionName: Collections.Attendees,
        created: new Date().toISOString(), updated: new Date().toISOString()
      } as unknown as AttendeesResponse;

      if (attendees.length === 0) return toAppCamper(person, dummyAttendee);

      const attendee = attendees[0];
      const expandedAttendee = attendee?.expand as { session?: ExpandedSession } | undefined;
      const session = expandedAttendee?.session ?? null;

      let assignment = null;
      let bunk = null;

      if (attendee?.session) {
        const assignments = await pb.collection('bunk_assignments').getFullList({
          filter: `person = "${person.id}" && session = "${attendee.session}" && year = ${currentYear}`,
          expand: 'bunk'
        });
        assignment = assignments.length > 0 ? assignments[0] : null;
        const expandedAssignment = assignment?.expand as { bunk?: ExpandedBunk } | undefined;
        bunk = expandedAssignment?.bunk ?? null;
      }

      return toAppCamper(person, attendee || dummyAttendee, assignment, bunk as BunksResponse | null, session as CampSessionsResponse | null);
    },
    retry: false,
  });

  // Fetch person data for siblings query
  const { data: person } = useQuery({
    queryKey: ['person-for-siblings', camperId, currentYear],
    queryFn: async () => {
      const personId = parseInt(camperId);
      const persons = await pb.collection<PersonsResponse>('persons').getList(1, 1, {
        filter: `cm_id = ${personId} && year = ${currentYear}`
      });
      return persons.items[0] || null;
    },
    enabled: !!camperId,
  });

  // Fetch historical bunking data
  const { data: historicalData = [] } = useQuery({
    queryKey: ['camper-history', camperId],
    queryFn: async () => {
      const personCmId = parseInt(camperId);
      const filter = `person.cm_id = ${personCmId} && year < ${currentYear}`;
      const assignments = await pb.collection('bunk_assignments').getFullList({
        filter, expand: 'person,session,bunk', sort: '-year'
      });

      const allowedTypes = ['main', 'ag', 'embedded', 'taste'];
      return assignments
        .filter((record) => {
          const expanded = record.expand as ExpandedAssignment | undefined;
          const sessionType = expanded?.session?.session_type;
          return sessionType && allowedTypes.includes(sessionType);
        })
        .map((record) => {
          const expanded = record.expand as ExpandedAssignment | undefined;
          return {
            year: record.year,
            sessionName: expanded?.session?.name ?? '',
            sessionType: expanded?.session?.session_type ?? '',
            bunkName: expanded?.bunk?.name ?? 'Unassigned',
          };
        });
    },
    enabled: !!camper,
  });

  // Fetch bunk requests
  const { data: bunkRequests = [] } = useQuery({
    queryKey: ['person-bunk-requests', camper?.person_cm_id, currentYear],
    queryFn: async () => {
      if (!camper?.person_cm_id) throw new Error('No camper person ID');

      const filter = `requester_id = ${camper.person_cm_id} && year = ${currentYear}`;
      const requests = await pb.collection('bunk_requests').getFullList<BunkRequestsResponse>({
        filter, sort: '-priority,request_type'
      });

      const requestedPersonCmIds = new Set<number>();
      requests.forEach(req => {
        if (req.requestee_id && req.requestee_id > 0) {
          requestedPersonCmIds.add(req.requestee_id);
        }
      });

      const personMap = new Map<number, PersonsResponse>();
      if (requestedPersonCmIds.size > 0) {
        const personFilter = Array.from(requestedPersonCmIds).map(id => `cm_id = ${id}`).join(' || ');
        const persons = await pb.collection('persons').getFullList<PersonsResponse>({
          filter: `(${personFilter}) && year = ${currentYear}`
        });
        persons.forEach(p => personMap.set(p.cm_id, p));
      }

      return requests.map(req => {
        const person = req.requestee_id && req.requestee_id > 0 ? personMap.get(req.requestee_id) : undefined;
        return {
          ...req,
          requestedPersonName: person
            ? `${person.first_name} ${person.last_name}`
            // Use requested_person_name for unmatched requests (negative IDs or no match)
            : req.requested_person_name
              ? `${req.requested_person_name} (unresolved)`
              : undefined,
          metadata: req.metadata || {} as Record<string, unknown>
        };
      });
    },
    enabled: !!camper?.person_cm_id,
  });

  // Fetch siblings
  const { data: siblings = [] } = useQuery({
    queryKey: ['camper-siblings-panel', person?.household_id, camperId, currentYear],
    queryFn: async () => {
      const personCmId = parseInt(camperId);
      if (!person?.household_id || person.household_id === 0) return [];

      const siblingFilter = `household_id = ${person.household_id} && cm_id != ${personCmId} && grade > 0 && year = ${currentYear}`;
      let siblingPersons: PersonsResponse[] = [];
      try {
        siblingPersons = await pb.collection<PersonsResponse>('persons').getFullList({
          filter: siblingFilter, sort: '-birthdate'
        });
      } catch { return []; }

      if (siblingPersons.length === 0) return [];

      const siblingsWithEnrollment = await Promise.all(
        siblingPersons.map(async (siblingPerson) => {
          const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(t => `session.session_type = "${t}"`).join(' || ');
          const enrollmentFilter = `person_id = ${siblingPerson.cm_id} && year = ${currentYear} && status = "enrolled" && (${sessionTypeFilter})`;

          try {
            const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
              filter: enrollmentFilter, expand: 'session', $autoCancel: false
            });

            if (attendees.length === 0) return null;

            const sortedAttendees = attendees.sort((a, b) => {
              const aExpand = a.expand as { session?: ExpandedSession } | undefined;
              const bExpand = b.expand as { session?: ExpandedSession } | undefined;
              const aType = aExpand?.session?.session_type ?? 'unknown';
              const bType = bExpand?.session?.session_type ?? 'unknown';
              const typeOrder: Record<string, number> = { 'main': 1, 'embedded': 2, 'ag': 3 };
              return (typeOrder[aType] ?? 999) - (typeOrder[bType] ?? 999);
            });

            const primaryAttendee = sortedAttendees[0];
            if (!primaryAttendee) return null;
            const primaryExpand = primaryAttendee.expand as { session?: ExpandedSession } | undefined;
            const session = primaryExpand?.session;

            let bunkName = null;
            if (session) {
              try {
                const assignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
                  filter: `person = "${siblingPerson?.id || ''}" && session = "${session?.id || ''}" && year = ${currentYear}`,
                  expand: 'bunk', $autoCancel: false
                });
                if (assignments.length > 0 && assignments[0]) {
                  const assignmentExpand = assignments[0].expand as { bunk?: ExpandedBunk } | undefined;
                  bunkName = assignmentExpand?.bunk?.name ?? null;
                }
              } catch { /* continue without bunk */ }
            }

            return { ...siblingPerson, session, bunkName };
          } catch { return null; }
        })
      );

      return siblingsWithEnrollment.filter(s => s !== null);
    },
    enabled: !!(person?.household_id && person.household_id > 0),
  });

  // Fetch original CSV data
  interface OriginalBunkData {
    share_bunk_with?: string;
    share_bunk_with_updated?: string;
    do_not_share_bunk_with?: string;
    do_not_share_bunk_with_updated?: string;
    internal_bunk_notes?: string;
    internal_bunk_notes_updated?: string;
    bunking_notes_notes?: string;
    bunking_notes_notes_updated?: string;
    ret_parent_socialize_with_best?: string;
    ret_parent_socialize_with_best_updated?: string;
  }

  const { data: originalBunkData } = useQuery({
    queryKey: ['original-bunk-requests', camper?.person_cm_id, currentYear],
    queryFn: async (): Promise<OriginalBunkData | null> => {
      if (!camper?.person_cm_id) throw new Error('No camper person ID');
      try {
        const filter = `person_id = ${camper.person_cm_id} && year = ${currentYear}`;
        const records = await pb.collection('original_bunk_requests').getList(1, 1, { filter });
        if (records.items.length === 0) return null;
        return records.items[0] as OriginalBunkData;
      } catch { return null; }
    },
    enabled: !!camper?.person_cm_id,
  });

  // Trigger close - for embedded mode, call directly; for slide panel, animation handles it
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Helper: get location from person's address
  const location = getLocationDisplay(person?.address);

  const getSessionShortName = () => {
    const session = camper?.expand?.session;
    if (!session) return null;
    if (session.session_type === 'ag') return session.name;
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
  };

  // Get age preference request for socializes best with
  const agePreferenceRequest = bunkRequests.find(r => r.request_type === 'age_preference');

  // Lazy-load satisfaction checks - cached per camper for efficient switching
  const { data: satisfactionData = {}, isLoading: satisfactionLoading } = useQuery<SatisfactionMap>({
    queryKey: ['panel-satisfaction', camper?.person_cm_id, camper?.assigned_bunk_cm_id, camper?.session_cm_id, camper?.grade, currentYear, bunkRequests.map(r => r.id).join(',')],
    queryFn: async () => {
      const results: SatisfactionMap = {};

      if (!camper?.assigned_bunk_cm_id || !camper?.session_cm_id) {
        return results; // Requester not assigned - can't check
      }

      // Get resolved person-based requests
      const resolvedPersonRequests = bunkRequests.filter(r =>
        r.status === 'resolved' &&
        r.requestee_id &&
        r.requestee_id > 0 &&
        (r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with')
      );

      // Get age preference requests
      const agePrefs = bunkRequests.filter(r =>
        r.request_type === 'age_preference' && r.age_preference_target
      );

      if (resolvedPersonRequests.length === 0 && agePrefs.length === 0) {
        return results;
      }

      try {
        const allAssignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
          filter: `year = ${currentYear}`,
          expand: 'person,bunk,session'
        });

        // Filter to same session
        const sessionAssignments = allAssignments.filter(a => {
          const expanded = a.expand as ExpandedAssignment | undefined;
          const sessionCmId = expanded?.session?.cm_id;
          return sessionCmId === camper.session_cm_id;
        });

        // Build lookup maps
        const personToBunk = new Map<number, number>();
        const bunkToPersons = new Map<number, Array<{ cmId: number; grade: number }>>();

        sessionAssignments.forEach(a => {
          const expanded = a.expand as ExpandedAssignment | undefined;
          const person = expanded?.person;
          const bunk = expanded?.bunk;
          const personCmId = person?.cm_id;
          const bunkCmId = bunk?.cm_id;
          const grade = person?.grade;

          if (personCmId && bunkCmId) {
            personToBunk.set(personCmId, bunkCmId);
            if (!bunkToPersons.has(bunkCmId)) bunkToPersons.set(bunkCmId, []);
            if (grade !== undefined && grade !== null) {
              const bunkPersons = bunkToPersons.get(bunkCmId);
              if (bunkPersons) {
                bunkPersons.push({ cmId: personCmId, grade });
              }
            }
          }
        });

        // Check person-based requests
        for (const req of resolvedPersonRequests) {
          if (!req.requestee_id) continue;
          const targetBunk = personToBunk.get(req.requestee_id);
          if (!targetBunk) {
            results[req.id] = { status: 'unknown', detail: 'Target not assigned' };
            continue;
          }
          const sameBunk = camper.assigned_bunk_cm_id === targetBunk;

          if (req.request_type === 'bunk_with') {
            results[req.id] = { status: sameBunk ? 'satisfied' : 'not_satisfied', detail: sameBunk ? 'Same bunk' : 'Different bunks' };
          } else {
            results[req.id] = { status: !sameBunk ? 'satisfied' : 'not_satisfied', detail: !sameBunk ? 'Different bunks' : 'Same bunk!' };
          }
        }

        // Check age preference requests
        for (const req of agePrefs) {
          const allInBunk = bunkToPersons.get(camper.assigned_bunk_cm_id) || [];
          // Filter out the camper to get only bunkmates
          const bunkmates = allInBunk.filter(b => b.cmId !== camper.person_cm_id);

          if (bunkmates.length === 0) {
            results[req.id] = { status: 'unknown', detail: 'No bunkmates yet' };
            continue;
          }

          const camperGrade = camper.grade;
          const bunkmateGrades = bunkmates.map(b => b.grade).filter((g): g is number => g !== null && g !== undefined);

          if (bunkmateGrades.length === 0) {
            results[req.id] = { status: 'unknown', detail: 'No bunkmate grades available' };
            continue;
          }

          // Use shared utility for consistent satisfaction logic
          const preference = req.age_preference_target as 'older' | 'younger';
          const { satisfied, detail } = isAgePreferenceSatisfied(camperGrade, bunkmateGrades, preference);

          // Create grade breakdown for rich UI display
          const gradeCounts = new Map<number, number>();
          bunkmates.forEach(b => {
            if (b.grade !== null && b.grade !== undefined) {
              gradeCounts.set(b.grade, (gradeCounts.get(b.grade) || 0) + 1);
            }
          });
          const gradeBreakdown = Array.from(gradeCounts.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([g, c]) => `${formatGradeOrdinal(g)}: ${c}`)
            .join(' | ');

          results[req.id] = {
            status: satisfied ? 'satisfied' : 'not_satisfied',
            detail: `${gradeBreakdown} — ${detail}`
          };
        }

        return results;
      } catch (error) {
        console.error('Satisfaction check error:', error);
        return results;
      }
    },
    enabled: !!camper?.person_cm_id && bunkRequests.length > 0,
    staleTime: 60000, // Cache 1 min - fast switching between campers
  });

  // Loading state
  if (camperLoading) {
    return embedded ? (
      <div className="card-lodge p-8 flex items-center justify-center min-h-[300px]">
        <div className="spinner-lodge"></div>
      </div>
    ) : (
      <div className="fixed inset-y-0 right-0 w-[28rem] bg-card shadow-lodge-xl border-l border-border z-[60] flex items-center justify-center">
        <div className="spinner-lodge"></div>
      </div>
    );
  }

  // Not found state
  if (!camper) {
    return embedded ? (
      <div className="card-lodge p-6">
        <div className="text-center text-muted-foreground">Camper not found</div>
      </div>
    ) : (
      <div className="fixed inset-y-0 right-0 w-[28rem] bg-card shadow-lodge-xl border-l border-border z-[60] p-6">
        <div className="text-center text-muted-foreground">Camper not found</div>
      </div>
    );
  }

  // Collapsible Section Header
  const SectionHeader = ({
    title, icon: Icon, isExpanded, onToggle, badge, accentColor = 'forest'
  }: {
    title: string;
    icon: React.ElementType;
    isExpanded: boolean;
    onToggle: () => void;
    badge?: string | number;
    accentColor?: 'forest' | 'amber' | 'pink' | 'stone';
  }) => {
    const colorClasses = {
      forest: 'bg-forest-50 dark:bg-forest-900/60 text-forest-700 dark:text-forest-100',
      amber: 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-100',
      pink: 'bg-pink-50 dark:bg-pink-900/60 text-pink-700 dark:text-pink-100',
      stone: 'bg-stone-100 dark:bg-stone-700/60 text-stone-700 dark:text-stone-100',
    };

    return (
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all duration-200 hover:scale-[1.01] ${colorClasses[accentColor]}`}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-white/60 dark:bg-black/20">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
      </button>
    );
  };

  // Render the panel content
  const renderContent = () => (
    <div className={embedded ? 'space-y-3' : 'flex-1 overflow-auto space-y-4'}>
      {/* Quick Stats Bar */}
      <div className="px-4 py-3 bg-forest-900/50 border-b border-forest-600/20">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {location && (
            <div className="flex items-center gap-1.5 text-forest-100">
              <MapPin className="w-3 h-3 text-forest-300" />
              <span>{location}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-forest-100">
            <TreePine className="w-3 h-3 text-forest-300" />
            <span>{camper.years_at_camp || 0} {(camper.years_at_camp || 0) === 1 ? 'year' : 'years'}</span>
          </div>
          {camper.expand?.assigned_bunk && (
            <div className="flex items-center gap-1.5 text-forest-100">
              <Home className="w-3 h-3 text-forest-300" />
              <span>{camper.expand.assigned_bunk.name}</span>
            </div>
          )}
          {getSessionShortName() && (
            <div className="flex items-center gap-1.5 text-forest-100">
              <Calendar className="w-3 h-3 text-forest-300" />
              <span>{getSessionShortName()}</span>
            </div>
          )}
        </div>
      </div>


      <div className="px-4 space-y-3">
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
                    const isConfirmed = Boolean(request.status === 'resolved' && request.requestee_id && request.requestee_id > 0);
                    const isBunkWith = request.request_type === 'bunk_with';
                    const satisfaction = satisfactionData[request.id];
                    const showSatisfaction = isConfirmed;

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        {/* Status indicator */}
                        {request.status === 'resolved' ? (
                          <CheckCircle className="w-4 h-4 text-forest-600 dark:text-forest-400 flex-shrink-0" />
                        ) : request.status === 'declined' ? (
                          <XCircle className="w-4 h-4 text-bark-600 dark:text-bark-400 flex-shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        )}

                        {/* Type label */}
                        <span className={`text-muted-foreground ${!isBunkWith ? 'text-red-600 dark:text-red-400' : ''}`}>
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
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-forest-100 dark:bg-forest-900/50 text-forest-700 dark:text-forest-300 flex-shrink-0">
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
                    );
                  })}

                {/* Age preference - subtle at bottom with satisfaction */}
                {agePreferenceRequest?.age_preference_target && (() => {
                  const ageSatisfaction = satisfactionData[agePreferenceRequest.id];
                  const prefersOlder = agePreferenceRequest.age_preference_target === 'older';
                  const hasOtherRequests = bunkRequests.filter((r) => r.request_type !== 'age_preference').length > 0;

                  return (
                    <div className={`text-xs text-muted-foreground flex items-center gap-2 px-2 ${hasOtherRequests ? 'mt-3 pt-2 border-t border-border/50' : ''}`}>
                      <Sparkles className="w-3 h-3 flex-shrink-0 text-amber-500" />
                      <span>Prefers bunking with <span className="font-medium text-foreground">{prefersOlder ? 'older' : 'younger'}</span> campers</span>

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
                  );
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
              <div className="mt-2 relative">
                {/* Timeline line */}
                <div className="absolute left-[5px] top-1 bottom-1 w-0.5 bg-forest-200 dark:bg-forest-800" />

                <div className="space-y-1.5">
                  {/* Current year */}
                  {camper.expand?.session && (
                    <div className="relative flex items-center gap-2.5">
                      <div className="relative z-10 w-3 h-3 rounded-full bg-forest-600 ring-2 ring-forest-100 dark:ring-forest-900 flex-shrink-0" />
                      <span className="font-bold text-forest-700 dark:text-forest-300 text-sm w-11">{currentYear}</span>
                      <span className="text-xs text-muted-foreground truncate">{getSessionShortName()}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className={`text-xs truncate ${camper.expand?.assigned_bunk ? 'text-foreground font-medium' : 'text-amber-600 italic'}`}>
                        {camper.expand?.assigned_bunk?.name || 'Unassigned'}
                      </span>
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-forest-600 text-white rounded ml-auto flex-shrink-0">
                        Now
                      </span>
                    </div>
                  )}

                  {/* Historical years */}
                  {historicalData.map((record: HistoricalRecord, idx: number) => (
                    <div key={`${record.year}-${idx}`} className="relative flex items-center gap-2.5 opacity-75">
                      <div className="relative z-10 w-3 h-3 rounded-full bg-forest-300 dark:bg-forest-700 flex-shrink-0" />
                      <span className="font-semibold text-foreground text-sm w-11">{record.year}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {getSessionDisplayNameFromString(record.sessionName, record.sessionType)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className={`text-xs truncate ${record.bunkName === 'Unassigned' ? 'text-amber-600 italic' : 'text-foreground'}`}>
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
                    to={`/summer/camper/${sibling.cm_id}`}
                    onClick={handleClose}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-border transition-all group"
                  >
                    <div className={`w-8 h-8 rounded-lg ${getAvatarColor(sibling.gender)} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <span className="text-xs font-display font-bold text-white">{getInitial(sibling.first_name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 truncate">
                        {sibling.preferred_name || sibling.first_name} {sibling.last_name}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        <span>{sibling.birthdate ? formatAge(calculateAge(sibling.birthdate)) : '?'}</span>
                        <span>•</span>
                        <span>{formatGradeOrdinal(sibling.grade)}</span>
                        {sibling.bunkName && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-0.5">
                              <Home className="w-2.5 h-2.5" />
                              {sibling.bunkName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-forest-600 transition-colors flex-shrink-0" />
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
                  <div className="p-2 rounded-lg bg-muted/50">
                    <span className="font-medium text-muted-foreground">Share Bunk With:</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{originalBunkData.share_bunk_with}</p>
                  </div>
                )}
                {originalBunkData.do_not_share_bunk_with && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <span className="font-medium text-muted-foreground">Don't Share With:</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{originalBunkData.do_not_share_bunk_with}</p>
                  </div>
                )}
                {originalBunkData.internal_bunk_notes && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <span className="font-medium text-muted-foreground">Internal Notes:</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{originalBunkData.internal_bunk_notes}</p>
                  </div>
                )}
                {originalBunkData.bunking_notes_notes && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <span className="font-medium text-muted-foreground">Bunking Notes:</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{originalBunkData.bunking_notes_notes}</p>
                  </div>
                )}
                {originalBunkData.ret_parent_socialize_with_best && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <span className="font-medium text-muted-foreground">Socializes Best With:</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{originalBunkData.ret_parent_socialize_with_best}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );

  // Render footer
  const renderFooter = () => (
    <div className={embedded ? 'px-4 pt-3 pb-4 space-y-2' : 'border-t border-border p-4 space-y-2 bg-card'}>
      <div className="flex gap-2">
        <Link
          to={`/summer/camper/${camper.person_cm_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary flex-1 text-center text-sm py-2 flex items-center justify-center gap-1.5"
        >
          Full Details
          <ExternalLink className="w-3 h-3 opacity-60" />
        </Link>
        <a
          href={`https://system.campminder.com/ui/person/Record#${camper.person_cm_id}:${currentYear}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex items-center justify-center gap-1.5 flex-1 text-sm py-2"
        >
          <CampMinderIcon className="w-4 h-4" />
          <span>CampMinder</span>
          <ExternalLink className="w-3 h-3 opacity-60" />
        </a>
      </div>
      {!embedded && (
        <button onClick={handleClose} className="btn-ghost w-full text-sm py-2">
          Close
        </button>
      )}
    </div>
  );

  // Embedded mode
  if (embedded) {
    return (
      <div className="flex flex-col h-full bg-card rounded-2xl overflow-hidden shadow-lodge-lg">
        {/* Compact Header */}
        <div className="bg-gradient-to-br from-forest-700 via-forest-800 to-forest-900 text-white p-4 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className={`w-12 h-12 rounded-xl ${getAvatarColor(camper.gender)} flex items-center justify-center shadow-lg ring-2 ring-white/20 flex-shrink-0`}>
              <span className="text-lg font-display font-bold text-white">{getInitial(camper.first_name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-bold truncate">
                  {camper.first_name}
                  {camper.preferred_name && camper.preferred_name !== camper.first_name && (
                    <span className="text-white/90 font-normal italic"> "{camper.preferred_name.replace(/^["']|["']$/g, '')}" </span>
                  )}
                  {(!camper.preferred_name || camper.preferred_name === camper.first_name) && ' '}
                  {camper.last_name}
                </h2>
                <button
                  onClick={handleClose}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors -mr-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-forest-100">
                <span>{camper.gender === 'M' ? 'M' : camper.gender === 'F' ? 'F' : 'NB'}</span>
                <span>•</span>
                <span>{camper.pronouns || 'No Preference'}</span>
                <span>•</span>
                <span>{formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)}</span>
                <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
                  camper.gender === 'M' ? 'bg-sky-400/20 text-sky-200' :
                  camper.gender === 'F' ? 'bg-pink-400/20 text-pink-200' :
                  'bg-purple-400/20 text-purple-200'
                }`}>{getGenderIdentityDisplay(camper)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-forest-100">
                <span>{formatGradeOrdinal(camper.grade)}{camper.school ? ` @ ${camper.school}` : ''}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
        {renderFooter()}
      </div>
    );
  }

  // Slide-in panel (no backdrop - workspace stays active)
  // Uses CSS animations instead of transitions for React Compiler compatibility
  return (
    <div
      data-panel="camper-details"
      className={`fixed inset-y-0 right-0 w-[28rem] bg-card shadow-lodge-xl border-l border-border z-[60] ${
        animationPhase === 'entering' ? 'animate-slide-in-right' : 'animate-slide-out-right'
      }`}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="h-full flex flex-col">
        {/* Premium Header */}
        <div className="bg-gradient-to-br from-forest-700 via-forest-800 to-forest-900 text-white flex-shrink-0">
          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className={`w-16 h-16 rounded-2xl ${getAvatarColor(camper.gender)} flex items-center justify-center shadow-lg ring-4 ring-white/20 flex-shrink-0`}>
                <span className="text-2xl font-display font-bold text-white">{getInitial(camper.first_name)}</span>
              </div>

              {/* Name and info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <h2 className="text-xl font-bold tracking-tight">
                    {camper.first_name}
                    {camper.preferred_name && camper.preferred_name !== camper.first_name && (
                      <span className="text-white/90 font-normal italic"> "{camper.preferred_name.replace(/^["']|["']$/g, '')}" </span>
                    )}
                    {(!camper.preferred_name || camper.preferred_name === camper.first_name) && ' '}
                    {camper.last_name}
                  </h2>
                  <button
                    onClick={handleClose}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors -mr-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 mt-1 text-sm text-forest-100">
                  <span>{camper.gender === 'M' ? 'Male' : camper.gender === 'F' ? 'Female' : 'Non-Binary'}</span>
                  <span>•</span>
                  <span>{camper.pronouns || 'No Preference'}</span>
                  <span>•</span>
                  <span>{formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-sm text-forest-100">
                  <span>{formatGradeOrdinal(camper.grade)}{camper.school ? ` @ ${camper.school}` : ''}</span>
                </div>

                <div className="mt-2">
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    getGenderBadgeClasses(getGenderCategory(getGenderIdentityDisplay(camper)))
                  } bg-opacity-20 backdrop-blur-sm`}>
                    {getGenderIdentityDisplay(camper)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>

        {/* Footer */}
        {renderFooter()}
      </div>
    </div>
  );
}
