/**
 * Hook for managing session hierarchy (sub-sessions, AG sessions)
 * Extracted from SessionView.tsx
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { pb } from '../../lib/pocketbase';
import { useAuth } from '../../contexts/AuthContext';
import { useYear } from '../useCurrentYear';
import { isNumericSessionId, findSessionByUrlSegment, sessionNameToUrl } from '../../utils/sessionUtils';
import type { Session } from '../../types/app-types';
import type { SessionHierarchy } from './types';

/**
 * Get embedded sub-sessions for a parent session
 * Prefers parent_id relationship, falls back to name matching for legacy data
 */
export function getSubSessions(
  parentSession: Session | null,
  allSessions: Session[],
  bunkPlanCounts: Record<string, number>,
  bunkPlanCountsLoaded: boolean
): Session[] {
  if (!parentSession) return [];

  // Try parent_id + session_type first (preferred)
  let embedded = allSessions.filter(s =>
    s.parent_id === parentSession.cm_id && s.session_type === 'embedded'
  );

  // Fallback to name matching if parent_id not set
  if (embedded.length === 0) {
    const sessionName = parentSession.name;
    if (sessionName === 'Session 2') {
      const session2a = allSessions.find(s => s.name === 'Session 2a');
      const session2b = allSessions.find(s => s.name === 'Session 2b');
      embedded = [session2a, session2b].filter((s): s is Session => !!s);
    } else if (sessionName === 'Session 3') {
      const session3a = allSessions.find(s => s.name === 'Session 3a');
      embedded = session3a ? [session3a] : [];
    }
  }

  // Filter out sessions with no bunk_plans (cancelled/empty sessions)
  // Only apply filter once counts have loaded
  if (bunkPlanCountsLoaded && Object.keys(bunkPlanCounts).length > 0) {
    embedded = embedded.filter(s => (bunkPlanCounts[s.id] || 0) > 0);
  }

  return embedded.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get All-Gender sessions for a parent session
 * Prefers parent_id relationship, falls back to name matching for legacy data
 */
export function getAgSessions(
  parentSession: Session | null,
  allSessions: Session[],
  bunkPlanCounts: Record<string, number>,
  bunkPlanCountsLoaded: boolean
): Session[] {
  if (!parentSession) return [];

  // Try parent_id + session_type first (preferred)
  let ag = allSessions.filter(s =>
    s.parent_id === parentSession.cm_id && s.session_type === 'ag'
  );

  // Fallback to name matching if parent_id not set
  if (ag.length === 0) {
    const sessionName = parentSession.name;
    // Look for AG sessions that reference this session in their name
    ag = allSessions.filter(s =>
      (s.name.toLowerCase().includes('all-gender') || s.name.toLowerCase().includes('ag')) &&
      (s.name.includes(sessionName) || s.name.match(new RegExp(`\\b${sessionName.replace('Session ', '')}\\b`)))
    );
  }

  // Filter out sessions with no bunk_plans
  if (bunkPlanCountsLoaded && Object.keys(bunkPlanCounts).length > 0) {
    ag = ag.filter(s => (bunkPlanCounts[s.id] || 0) > 0);
  }

  return ag;
}

/**
 * Determine if AG area should be shown in the area selector
 */
export function shouldShowAgArea(agSessions: Session[], isViewingMainSession: boolean): boolean {
  return agSessions.length > 0 && isViewingMainSession;
}

export interface UseSessionHierarchyOptions {
  /** Session ID from URL (can be friendly URL or numeric ID) */
  sessionId: string | undefined;
  /** Tab path from URL */
  tabPath?: string;
  /** Enable URL redirects */
  enableRedirects?: boolean;
}

export interface UseSessionHierarchyResult extends SessionHierarchy {
  /** All sessions for lookup (includes all types) */
  allSessionsForLookup: Session[];
  /** Currently selected session CampMinder ID */
  selectedSession: string;
  /** Set selected session */
  setSelectedSession: (cmId: string) => void;
  /** Whether viewing a main session (not embedded) */
  isViewingMainSession: boolean;
  /** Whether AG area should be shown */
  showAgArea: boolean;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Hook for managing session hierarchy
 * Handles URL resolution, sub-sessions, and AG sessions
 */
export function useSessionHierarchy(options: UseSessionHierarchyOptions): UseSessionHierarchyResult {
  const { sessionId, tabPath, enableRedirects = true } = options;
  const navigate = useNavigate();
  const currentYear = useYear();
  const { user } = useAuth();
  const [selectedSession, setSelectedSession] = useState<string>('');

  // Fetch all sessions to resolve friendly URLs
  const { data: allSessionsForLookup = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['all-sessions-lookup', currentYear],
    queryFn: async () => {
      const filter = `year = ${currentYear}`;
      const sessions = await pb.collection<Session>('camp_sessions').getFullList({
        filter,
        sort: 'cm_id',
      });
      return sessions;
    },
    enabled: !!user,
  });

  // Resolve session from URL (could be friendly URL or numeric ID)
  const resolvedSession = sessionId && allSessionsForLookup.length > 0
    ? findSessionByUrlSegment(allSessionsForLookup, sessionId)
    : null;

  // Fetch session data
  const { data: session } = useQuery({
    queryKey: ['session', resolvedSession?.cm_id],
    queryFn: () => {
      if (!resolvedSession) throw new Error('Session not found');
      return Promise.resolve(resolvedSession);
    },
    enabled: !!resolvedSession,
  });

  // Fetch all sessions for hierarchy lookup
  const { data: allSessions = [] } = useQuery({
    queryKey: ['all-sessions', currentYear],
    queryFn: async () => {
      const filter = `year = ${currentYear}`;
      const sessions = await pb.collection<Session>('camp_sessions').getFullList({
        filter,
        sort: 'cm_id',
      });
      return sessions;
    },
  });

  // Fetch bunk_plan counts for child sessions to filter out empty ones
  const { data: sessionBunkPlanCounts = {}, isSuccess: bunkPlanCountsLoaded } = useQuery({
    queryKey: ['session-bunk-plan-counts', currentYear, resolvedSession?.cm_id],
    queryFn: async () => {
      if (!resolvedSession) return {} as Record<string, number>;

      // Get all child sessions (embedded + ag) for this parent
      const childSessions = allSessions.filter(s =>
        s.parent_id === resolvedSession.cm_id
      );

      if (childSessions.length === 0) return {} as Record<string, number>;

      // Fetch bunk_plans for all child sessions at once
      const sessionIds = childSessions.map(s => s.id);
      const filter = `(${sessionIds.map(id => `session = "${id}"`).join(' || ')}) && year = ${currentYear}`;
      const bunkPlans = await pb.collection('bunk_plans').getFullList({ filter });

      // Count bunk_plans per session (keyed by PocketBase session ID)
      const counts: Record<string, number> = {};
      for (const bp of bunkPlans) {
        counts[bp.session] = (counts[bp.session] || 0) + 1;
      }

      return counts;
    },
    enabled: !!resolvedSession && allSessions.length > 0,
  });

  // Calculate sub-sessions and AG sessions
  const subSessions = getSubSessions(session || resolvedSession, allSessions, sessionBunkPlanCounts, bunkPlanCountsLoaded);
  const agSessions = getAgSessions(session || resolvedSession, allSessions, sessionBunkPlanCounts, bunkPlanCountsLoaded);
  const isViewingMainSession = session?.session_type === 'main';
  const showAgArea = shouldShowAgArea(agSessions, isViewingMainSession);

  // Set default selected session when resolvedSession changes
  useEffect(() => {
    if (resolvedSession) {
      setSelectedSession(resolvedSession.cm_id.toString());
    }
  }, [resolvedSession]);

  // Redirect numeric IDs to friendly URLs
  useEffect(() => {
    if (enableRedirects && session && sessionId && isNumericSessionId(sessionId)) {
      const friendlyUrl = sessionNameToUrl(session.name);
      navigate(`/summer/session/${friendlyUrl}${tabPath ? `/${tabPath}` : '/board'}`, { replace: true });
    }
  }, [enableRedirects, session, sessionId, tabPath, navigate]);

  // Redirect to default tab if no tab specified
  useEffect(() => {
    if (enableRedirects && session && sessionId && !tabPath) {
      navigate(`/summer/session/${sessionId}/bunks`, { replace: true });
    }
  }, [enableRedirects, session, sessionId, tabPath, navigate]);

  return {
    session: session || null,
    allSessions,
    allSessionsForLookup,
    subSessions,
    agSessions,
    isViewingMainSession,
    showAgArea,
    bunkPlanCounts: sessionBunkPlanCounts,
    bunkPlanCountsLoaded,
    selectedSession,
    setSelectedSession,
    isLoading: sessionsLoading,
  };
}
