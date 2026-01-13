/**
 * Utilities for session URL handling
 */

import type { Session } from '../types/app-types';

// Map session names to friendly URL segments
const SESSION_NAME_TO_URL: Record<string, string> = {
  'Taste of Camp': 'taste',
  'Session 1': '1',
  'Session 2': '2',
  'Session 2a': '2a',
  'Session 2b': '2b', 
  'Session 3': '3',
  'Session 3a': '3a',
  'Session 4': '4',
};

// Reverse mapping
const URL_TO_SESSION_NAME: Record<string, string> = Object.entries(SESSION_NAME_TO_URL).reduce(
  (acc, [name, url]) => ({ ...acc, [url]: name }),
  {}
);

export function sessionNameToUrl(sessionName: string): string {
  // First check if it's a known session name
  if (SESSION_NAME_TO_URL[sessionName]) {
    return SESSION_NAME_TO_URL[sessionName];
  }
  
  // For AG sessions or other special sessions, create a URL-friendly version
  // Remove special characters and replace spaces with hyphens
  return sessionName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function urlToSessionName(urlSegment: string): string | null {
  // First check if it's a known URL segment
  if (URL_TO_SESSION_NAME[urlSegment]) {
    return URL_TO_SESSION_NAME[urlSegment];
  }
  
  // For other sessions, we'll need to look them up by matching the URL-friendly version
  // This will be handled by the component that has access to all sessions
  return null;
}

export function isKnownSessionUrl(urlSegment: string): boolean {
  return urlSegment in URL_TO_SESSION_NAME;
}

export function isNumericSessionId(urlSegment: string): boolean {
  return /^\d+$/.test(urlSegment);
}

export function findSessionByUrlSegment(sessions: Session[], urlSegment: string): Session | null {
  // First try to find by known URL mapping
  const knownName = urlToSessionName(urlSegment);
  if (knownName) {
    return sessions.find(s => s.name === knownName) || null;
  }
  
  // Then try numeric ID
  if (isNumericSessionId(urlSegment)) {
    const cmId = parseInt(urlSegment, 10);
    return sessions.find(s => s.cm_id === cmId) || null;
  }
  
  // Finally, try to match the URL-friendly version of session names
  return sessions.find(s => sessionNameToUrl(s.name) === urlSegment) || null;
}

// Valid tab paths for routing
export const VALID_TABS = ['bunks', 'campers', 'requests', 'review', 'friends', 'logs'] as const;
export type ValidTab = typeof VALID_TABS[number];

export function isValidTab(tab: string): tab is ValidTab {
  return VALID_TABS.includes(tab as ValidTab);
}