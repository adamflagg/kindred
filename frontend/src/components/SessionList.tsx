import { Link } from 'react-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { format, isBefore, isAfter, isWithinInterval, startOfDay } from 'date-fns';
import { Calendar, Users, Home, ChevronRight, Tent, Clock, AlertCircle, CheckCircle2, PlayCircle, BedDouble } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { sessionNameToUrl } from '../utils/sessionUtils';
import { useYear } from '../hooks/useCurrentYear';
import { getFormattedSessionName } from '../utils/sessionDisplay';
import { getCampNameShort } from '../config/branding';
import type { AttendeesResponse, PersonsResponse, BunkPlansResponse, BunksResponse, BunkAssignmentsResponse, CampSessionsResponse } from '../types/pocketbase-types';

interface SessionStatistics {
  totalCampers: number;
  assignedCampers: number;
  unassignedCampers: number;
  totalBunks: number;
  totalCapacity: number;
  sexDistribution: { M: number; F: number };
  ageGroups: { '7-9': number; '10-12': number; '13-15': number; '16+': number };
  newCampers: number;
  returningCampers: number;
  hasAgSessions: boolean;
  agSessionCount: number;
  pendingReviewCount: number;
}

type SessionWithStats = CampSessionsResponse & {
  statistics: SessionStatistics | undefined;
  isLoadingStats: boolean | undefined;
};

interface SessionGroup {
  main: SessionWithStats;
  embedded: SessionWithStats[];
}

type SessionStatus = 'upcoming' | 'in-progress' | 'completed';

/**
 * Determine session status based on dates
 */
function getSessionStatus(session: CampSessionsResponse): SessionStatus {
  const today = startOfDay(new Date());
  const start = startOfDay(new Date(session.start_date));
  const end = startOfDay(new Date(session.end_date));

  if (isBefore(today, start)) return 'upcoming';
  if (isAfter(today, end)) return 'completed';
  if (isWithinInterval(today, { start, end })) return 'in-progress';
  return 'upcoming';
}

/**
 * Parse session name for sorting
 */
function parseSessionForSort(name: string): [number, string] {
  const match = name.match(/session\s+(\d+)([a-z])?/i);
  if (match && match[1]) {
    return [parseInt(match[1], 10), match[2]?.toLowerCase() || ''];
  }
  // Taste of Camp sorts first (0)
  if (name.toLowerCase().includes('taste')) return [0, ''];
  return [99, name.toLowerCase()];
}

/**
 * Sort sessions chronologically: by start_date ASC, then by session number
 */
function sortSessionsChronologically<T extends CampSessionsResponse>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    // All sessions sorted chronologically: earliest first
    const dateCompare = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
    if (dateCompare !== 0) return dateCompare;
    const [numA, suffixA] = parseSessionForSort(a.name);
    const [numB, suffixB] = parseSessionForSort(b.name);
    if (numA !== numB) return numA - numB;
    return suffixA.localeCompare(suffixB);
  });
}

/**
 * Check if embedded session overlaps with main session dates
 */
function sessionsOverlap(main: CampSessionsResponse, embedded: CampSessionsResponse): boolean {
  const mainStart = new Date(main.start_date).getTime();
  const mainEnd = new Date(main.end_date).getTime();
  const embStart = new Date(embedded.start_date).getTime();
  const embEnd = new Date(embedded.end_date).getTime();
  return embStart >= mainStart && embEnd <= mainEnd;
}

/**
 * Group sessions by status, then by main/embedded relationship
 */
function groupSessionsByStatus(sessions: SessionWithStats[]): {
  upcoming: SessionGroup[];
  inProgress: SessionGroup[];
  completed: SessionGroup[];
} {
  const mainSessions = sessions.filter(s => s.session_type === 'main');
  const embeddedSessions = sessions.filter(s => s.session_type === 'embedded');

  const createGroups = (mains: SessionWithStats[], status: SessionStatus): SessionGroup[] => {
    const assignedEmbedded = new Set<string>();
    const groups: SessionGroup[] = [];

    for (const main of mains) {
      const overlapping = embeddedSessions.filter(emb => {
        if (assignedEmbedded.has(emb.id)) return false;
        if (getSessionStatus(emb) !== status) return false;
        return sessionsOverlap(main, emb);
      });
      overlapping.forEach(e => assignedEmbedded.add(e.id));

      groups.push({
        main,
        embedded: sortSessionsChronologically(overlapping),
      });
    }

    // Orphaned embedded sessions
    const orphaned = embeddedSessions.filter(e =>
      !assignedEmbedded.has(e.id) && getSessionStatus(e) === status
    );
    for (const orphan of sortSessionsChronologically(orphaned)) {
      groups.push({ main: orphan, embedded: [] });
    }

    return groups;
  };

  const upcomingMains = sortSessionsChronologically(
    mainSessions.filter(s => getSessionStatus(s) === 'upcoming')
  );
  const inProgressMains = sortSessionsChronologically(
    mainSessions.filter(s => getSessionStatus(s) === 'in-progress')
  );
  const completedMains = sortSessionsChronologically(
    mainSessions.filter(s => getSessionStatus(s) === 'completed')
  );

  return {
    upcoming: createGroups(upcomingMains, 'upcoming'),
    inProgress: createGroups(inProgressMains, 'in-progress'),
    completed: createGroups(completedMains, 'completed'),
  };
}

/**
 * Compact Session Row Component with hover expansion
 */
function SessionRow({
  session,
  allSessions,
  isEmbedded = false,
  status,
}: {
  session: SessionWithStats;
  allSessions: CampSessionsResponse[];
  isEmbedded?: boolean;
  status: SessionStatus;
}) {
  const stats = session.statistics;
  const isLoading = session.isLoadingStats;
  const isCompleted = status === 'completed';

  return (
    <Link
      to={`/summer/session/${sessionNameToUrl(session.name)}`}
      className={`group block transition-all duration-200 ${
        isEmbedded
          ? 'ml-6 border-l-2 border-amber-400/60 dark:border-amber-500/60 hover:border-amber-500 dark:hover:border-amber-400 bg-amber-50/30 dark:bg-amber-900/30'
          : 'hover:bg-forest-50/50 dark:hover:bg-forest-800/40'
      } ${isCompleted ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      {/* Main Row */}
      <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3">
        {/* Session Icon */}
        <div className={`flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${
          status === 'completed'
            ? 'bg-stone-100 dark:bg-stone-700/80'
            : isEmbedded
              ? 'bg-amber-100 dark:bg-amber-800/60'
              : status === 'in-progress'
                ? 'bg-green-100 dark:bg-green-800/60'
                : 'bg-forest-100 dark:bg-forest-800/60'
        }`}>
          {status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-stone-500 dark:text-stone-400" />
          ) : isEmbedded ? (
            <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 dark:text-amber-400" />
          ) : status === 'in-progress' ? (
            <PlayCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
          ) : (
            <Tent className="h-4 w-4 sm:h-5 sm:w-5 text-forest-600 dark:text-forest-400" />
          )}
        </div>

        {/* Session Name & Dates */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-display font-semibold truncate group-hover:text-primary transition-colors ${
              isEmbedded ? 'text-sm sm:text-base' : 'text-base sm:text-lg'
            } ${isCompleted ? 'text-stone-600 dark:text-stone-400' : 'text-foreground'}`}>
              {getFormattedSessionName(session, allSessions)}
            </h3>
            {status === 'in-progress' && !isEmbedded && (
              <span className="px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground mt-0.5">
            <Calendar className="h-3 w-3 flex-shrink-0" />
            <span>{format(new Date(session.start_date), 'MMM d')} - {format(new Date(session.end_date), 'MMM d')}</span>
          </div>

          {/* Mobile Stats Row */}
          {stats && !isLoading && (
            <div className="flex sm:hidden items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3 text-primary" />
                <span className="tabular-nums font-medium text-foreground">{stats.assignedCampers}</span>
                <span className="text-muted-foreground">/{stats.totalCampers}</span>
              </span>
              <span className="flex items-center gap-1">
                <Home className="h-3 w-3 text-bark-500 dark:text-bark-400" />
                <span className="tabular-nums">{stats.totalBunks}</span>
              </span>
              {stats.unassignedCampers > 0 && status === 'upcoming' && (
                <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-medium">
                  <AlertCircle className="h-3 w-3" />
                  {stats.unassignedCampers}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Stats - Desktop: three separate columns */}
        {stats && !isLoading ? (
          <>
            {/* Campers column */}
            <div className="hidden sm:flex items-center justify-end gap-3 text-sm w-[200px] flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="tabular-nums">
                  <span className="font-semibold">{stats.assignedCampers}</span>
                  <span className="text-muted-foreground">/{stats.totalCampers}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <svg className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="4" r="3" />
                  <path d="M12 8c-2.5 0-4 1.5-4 3v5h2v6h4v-6h2v-5c0-1.5-1.5-3-4-3z" />
                </svg>
                <span className="tabular-nums text-muted-foreground">{stats.sexDistribution.M}</span>
                <svg className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400 flex-shrink-0 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="4" r="3" />
                  <path d="M12 8c-3 0-5 1.5-5 3l2 7h2v4h2v-4h2l2-7c0-1.5-2-3-5-3z" />
                </svg>
                <span className="tabular-nums text-muted-foreground">{stats.sexDistribution.F}</span>
              </div>
            </div>

            {/* Cabins column - centered */}
            <div className="hidden sm:flex items-center justify-center gap-1.5 text-sm w-[160px] flex-shrink-0">
              <Home className="h-4 w-4 text-bark-500 dark:text-bark-400 flex-shrink-0" />
              <span className="tabular-nums">{stats.totalBunks}</span>
              <BedDouble className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="tabular-nums text-muted-foreground">{stats.totalCapacity}</span>
            </div>

            {/* New/Returning column */}
            <div className="hidden sm:flex items-center justify-start gap-1 text-xs text-muted-foreground w-[140px] flex-shrink-0">
              <span className="tabular-nums font-medium">{stats.newCampers}</span>
              <span>new</span>
              <span className="mx-0.5">/</span>
              <span className="tabular-nums font-medium">{stats.returningCampers}</span>
              <span>ret</span>
            </div>
          </>
        ) : isLoading ? (
          <div className="hidden sm:flex items-center w-[500px] justify-center flex-shrink-0">
            <div className="spinner-lodge w-4 h-4" />
          </div>
        ) : (
          <div className="hidden sm:block w-[500px] flex-shrink-0" />
        )}

        {/* Badges - Fixed width container for alignment */}
        <div className="hidden sm:flex items-center gap-2 w-[140px] justify-end">
          {stats && stats.unassignedCampers > 0 && status === 'upcoming' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              <AlertCircle className="h-3 w-3" />
              {stats.unassignedCampers}
            </span>
          )}
          {stats && stats.pendingReviewCount > 0 && status === 'upcoming' && (
            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
              {stats.pendingReviewCount} review
            </span>
          )}
        </div>

        {/* Arrow */}
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
      </div>

    </Link>
  );
}

/**
 * Session Group Component
 */
function SessionGroupRows({
  group,
  allSessions,
  status,
}: {
  group: SessionGroup;
  allSessions: CampSessionsResponse[];
  status: SessionStatus;
}) {
  return (
    <div className="border-b border-stone-200/80 dark:border-stone-700/80 last:border-b-0">
      <SessionRow
        session={group.main}
        allSessions={allSessions}
        status={status}
      />
      {group.embedded.map(embedded => (
        <SessionRow
          key={embedded.id}
          session={embedded}
          allSessions={allSessions}
          isEmbedded
          status={status}
        />
      ))}
    </div>
  );
}

/**
 * Status Section Header
 */
function StatusSectionHeader({
  status,
  count,
  icon: Icon,
}: {
  status: SessionStatus;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const configs = {
    upcoming: {
      label: 'Upcoming',
      subtitle: 'Ready for bunking',
      bg: 'bg-forest-50 dark:bg-forest-900/50',
      border: 'border-forest-200 dark:border-forest-700',
      text: 'text-forest-700 dark:text-forest-200',
      iconBg: 'bg-forest-100 dark:bg-forest-700',
    },
    'in-progress': {
      label: 'In Progress',
      subtitle: 'Currently at camp',
      bg: 'bg-green-50 dark:bg-green-900/50',
      border: 'border-green-200 dark:border-green-700',
      text: 'text-green-700 dark:text-green-200',
      iconBg: 'bg-green-100 dark:bg-green-700',
    },
    completed: {
      label: 'Completed',
      subtitle: 'Session finished',
      bg: 'bg-stone-50 dark:bg-stone-800/60',
      border: 'border-stone-200 dark:border-stone-600',
      text: 'text-stone-600 dark:text-stone-300',
      iconBg: 'bg-stone-100 dark:bg-stone-700',
    },
  };

  const config = configs[status];

  return (
    <div className={`flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 ${config.bg} border-b ${config.border}`}>
      <div className={`p-1 sm:p-1.5 rounded-lg ${config.iconBg}`}>
        <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${config.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={`font-semibold text-xs sm:text-sm ${config.text}`}>{config.label}</span>
        <span className="hidden sm:inline text-xs text-muted-foreground ml-2">{config.subtitle}</span>
      </div>
      <span className={`text-xs sm:text-sm font-semibold ${config.text} tabular-nums`}>{count}</span>
    </div>
  );
}

export default function SessionList() {
  const { user } = useAuth();
  const currentYear = useYear();

  // Query sessions
  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ['sessions', currentYear],
    queryFn: async () => {
      const results = await pb.collection('camp_sessions').getFullList<CampSessionsResponse>({
        filter: `(session_type = "main" || session_type = "embedded") && year = ${currentYear}`,
        sort: 'start_date,cm_id',
      });
      return results;
    },
    enabled: !!user,
  });

  // Fetch statistics for each session
  const statisticsQueries = useQueries({
    queries: sessions.map(session => ({
      queryKey: ['sessionStatistics', session.id, session.session_type],
      queryFn: async () => {
        const isMainSession = session.session_type === 'main';

        let agSessions: CampSessionsResponse[] = [];
        if (isMainSession) {
          const childSessions = await pb.collection('camp_sessions').getFullList<CampSessionsResponse>({
            filter: `parent_id = ${session.cm_id} && session_type = "ag" && year = ${currentYear}`,
          });
          agSessions = childSessions;
        }

        const allSessionIds = [session.id, ...agSessions.map(s => s.id)];
        const sessionFilter = allSessionIds.map(id => `session = "${id}"`).join(' || ');

        const attendees = await pb.collection<AttendeesResponse<{ person?: PersonsResponse }>>('attendees').getFullList({
          filter: `(${sessionFilter}) && year = ${currentYear} && status = "enrolled"`,
          expand: 'person',
        });

        const bunkPlans = await pb.collection<BunkPlansResponse<{ bunk?: BunksResponse }>>('bunk_plans').getFullList({
          filter: `(${sessionFilter}) && year = ${currentYear}`,
          expand: 'bunk',
        });

        const assignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
          filter: `(${sessionFilter}) && year = ${currentYear}`,
        });

        const capacityConfig = await pb.collection('config').getFirstListItem(
          `category = "constraint" && subcategory = "cabin_capacity" && config_key = "default"`,
        ).catch(() => null);
        const bunkCapacity = capacityConfig?.value ? Number(capacityConfig.value) : 12;

        const totalCampers = attendees.length;
        const assignedCampers = assignments.length;
        const unassignedCampers = totalCampers - assignedCampers;

        const filteredBunkPlans = bunkPlans.filter(bp => {
          if (!isMainSession) return true;
          const bunkGender = bp.expand?.bunk?.gender?.toLowerCase() || '';
          const isAgBunk = ['ag', 'mixed', 'all-gender', 'nb'].includes(bunkGender);
          if (bp.session === session.id) return !isAgBunk;
          return true;
        });

        const totalBunks = filteredBunkPlans.length;
        const totalCapacity = totalBunks * bunkCapacity;

        const sexDistribution = { M: 0, F: 0 };
        attendees.forEach(attendee => {
          const sex = attendee.expand?.person?.gender;
          if (sex === 'M') sexDistribution.M++;
          else if (sex === 'F') sexDistribution.F++;
        });

        const ageGroups = { '7-9': 0, '10-12': 0, '13-15': 0, '16+': 0 };
        attendees.forEach(attendee => {
          const age = attendee.expand?.person?.age;
          if (age !== undefined) {
            if (age >= 7 && age <= 9) ageGroups['7-9']++;
            else if (age >= 10 && age <= 12) ageGroups['10-12']++;
            else if (age >= 13 && age <= 15) ageGroups['13-15']++;
            else if (age >= 16) ageGroups['16+']++;
          }
        });

        let newCampers = 0, returningCampers = 0;
        attendees.forEach(attendee => {
          const years = attendee.expand?.person?.years_at_camp || 0;
          if (years <= 1) newCampers++;
          else returningCampers++;
        });

        const pendingReviewRequests = await pb.collection('bunk_requests').getList(1, 1, {
          filter: `session_id = ${session.cm_id} && year = ${currentYear} && status = "manual_review"`,
        });

        return {
          totalCampers,
          assignedCampers,
          unassignedCampers,
          totalBunks,
          totalCapacity,
          sexDistribution,
          ageGroups,
          newCampers,
          returningCampers,
          hasAgSessions: agSessions.length > 0,
          agSessionCount: agSessions.length,
          pendingReviewCount: pendingReviewRequests.totalItems,
        } as SessionStatistics;
      },
      enabled: !!user && sessions.length > 0,
    })),
  });

  // Map statistics to sessions
  const sessionsWithStats: SessionWithStats[] = sessions.map((session, index) => ({
    ...session,
    statistics: statisticsQueries[index]?.data as SessionStatistics | undefined,
    isLoadingStats: statisticsQueries[index]?.isLoading,
  }));

  // Group by status
  const groupedSessions = groupSessionsByStatus(sessionsWithStats);

  // Aggregate stats
  const totalCampers = sessionsWithStats.reduce((sum, s) => sum + (s.statistics?.totalCampers || 0), 0);
  const totalUnassigned = sessionsWithStats
    .filter(s => getSessionStatus(s) === 'upcoming')
    .reduce((sum, s) => sum + (s.statistics?.unassignedCampers || 0), 0);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner-lodge w-10 h-10" />
          <p className="text-sm text-muted-foreground font-medium">Loading sessions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-lodge border-destructive/50 bg-destructive/5 p-6">
        <p className="text-sm text-destructive font-medium">Failed to load sessions. Please try again.</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center card-lodge border-dashed px-8 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <Tent className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-display font-semibold mb-2">No sessions found</h2>
        <p className="text-muted-foreground max-w-sm">
          Import sessions from CampMinder to get started with bunking assignments.
        </p>
      </div>
    );
  }

  const hasUpcoming = groupedSessions.upcoming.length > 0;
  const hasInProgress = groupedSessions.inProgress.length > 0;
  const hasCompleted = groupedSessions.completed.length > 0;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Forest Header */}
      <div className="bg-gradient-to-r from-forest-700 to-forest-800 rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-white/10 rounded-lg">
              <Tent className="h-5 w-5 sm:h-6 sm:w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-display font-bold text-white">
                {getCampNameShort()} Sessions
              </h1>
              <p className="text-forest-200 text-xs sm:text-sm">
                {currentYear} Summer Season
              </p>
            </div>
          </div>

          {/* Aggregate Stats - Responsive */}
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-display font-bold text-white tabular-nums">
                {totalCampers}
              </div>
              <div className="text-forest-300 text-[10px] sm:text-xs">
                <span className="hidden sm:inline">total </span>campers
              </div>
            </div>
            {totalUnassigned > 0 && (
              <div className="text-right">
                <div className="text-xl sm:text-2xl font-display font-bold text-amber-400 tabular-nums">
                  {totalUnassigned}
                </div>
                <div className="text-forest-300 text-[10px] sm:text-xs">
                  <span className="hidden sm:inline">need </span>bunking
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Session List */}
      <div className="bg-white dark:bg-card rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        {/* Upcoming Sessions - Primary Work Zone */}
        {hasUpcoming && (
          <div>
            <StatusSectionHeader
              status="upcoming"
              count={groupedSessions.upcoming.reduce((sum, g) => sum + 1 + g.embedded.length, 0)}
              icon={Tent}
            />
            {groupedSessions.upcoming.map(group => (
              <SessionGroupRows
                key={group.main.id}
                group={group}
                allSessions={sessions}
                status="upcoming"
              />
            ))}
          </div>
        )}

        {/* In Progress Sessions */}
        {hasInProgress && (
          <div>
            <StatusSectionHeader
              status="in-progress"
              count={groupedSessions.inProgress.reduce((sum, g) => sum + 1 + g.embedded.length, 0)}
              icon={PlayCircle}
            />
            {groupedSessions.inProgress.map(group => (
              <SessionGroupRows
                key={group.main.id}
                group={group}
                allSessions={sessions}
                status="in-progress"
              />
            ))}
          </div>
        )}

        {/* Completed Sessions */}
        {hasCompleted && (
          <div>
            <StatusSectionHeader
              status="completed"
              count={groupedSessions.completed.reduce((sum, g) => sum + 1 + g.embedded.length, 0)}
              icon={CheckCircle2}
            />
            {groupedSessions.completed.map(group => (
              <SessionGroupRows
                key={group.main.id}
                group={group}
                allSessions={sessions}
                status="completed"
              />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-center px-4">
        <div className="inline-flex items-center gap-4 sm:gap-6 text-[10px] sm:text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Tent className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-forest-600 dark:text-forest-400" />
            <span>Full Session</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-500 dark:text-amber-400" />
            <span>Embedded</span>
          </div>
        </div>
      </div>
    </div>
  );
}
