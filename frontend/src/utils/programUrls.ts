import type { Program } from '../contexts/ProgramContext';

/**
 * Generate a program-specific URL
 */
export function getProgramUrl(path: string, program: Program): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Don't add prefix for shared routes
  const sharedRoutes = ['user', 'users'];
  if (sharedRoutes.some(route => cleanPath.startsWith(route))) {
    return `/${cleanPath}`;
  }
  
  return `/${program}/${cleanPath}`;
}

/**
 * Check if a path is a program-specific route
 */
export function isProgramRoute(path: string): boolean {
  return path.startsWith('/summer/') || path.startsWith('/family/') || path.startsWith('/metrics');
}

/**
 * Extract program from a path
 */
export function getProgramFromPath(path: string): Program | null {
  if (path.startsWith('/summer/')) return 'summer';
  if (path.startsWith('/family/')) return 'family';
  if (path.startsWith('/metrics')) return 'metrics';
  return null;
}

/**
 * Remove program prefix from a path
 */
export function removeProgramPrefix(path: string): string {
  if (path.startsWith('/summer/')) return path.slice(7);
  if (path.startsWith('/family/')) return path.slice(7);
  if (path.startsWith('/metrics/')) return path.slice(8);
  if (path === '/metrics') return '/';
  return path;
}

/**
 * Generate a summer camp specific URL
 */
export function getSummerUrl(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `/summer/${cleanPath}`;
}

/**
 * Generate a family camp specific URL
 */
export function getFamilyUrl(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `/family/${cleanPath}`;
}

/**
 * Generate a metrics URL
 */
export function getMetricsUrl(): string {
  return '/metrics';
}

/**
 * Generate URL for a session view
 */
export function getSessionUrl(sessionId: string, tab?: string): string {
  const baseUrl = `/summer/session/${sessionId}`;
  return tab ? `${baseUrl}/${tab}` : baseUrl;
}

/**
 * Generate URL for a camper detail view
 */
export function getCamperUrl(camperId: string | number): string {
  return `/summer/camper/${camperId}`;
}

/**
 * Generate URL for the all campers view
 */
export function getAllCampersUrl(): string {
  return '/summer/campers';
}

/**
 * Generate URL for the sessions list
 */
export function getSessionsListUrl(): string {
  return '/summer/sessions';
}