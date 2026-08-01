import type { Program } from '../contexts/ProgramContext'

/**
 * Generate a program-specific URL
 */
export function getProgramUrl(path: string, program: Program): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  // 'admin' stays even though nothing calls this with an admin path — the
  // /admin redirects (nav consolidation) still resolve either way, and
  // removing it isn't confirmed safe. 'manage' is added for the same
  // treatment now that Sync and Configuration live under it too.
  const sharedRoutes = ['user', 'users', 'campers', 'camper', 'admin', 'manage']
  if (sharedRoutes.some((route) => cleanPath.startsWith(route))) {
    return `/${cleanPath}`
  }
  return `/${program}/${cleanPath}`
}

/**
 * Check if a path is a program-specific route
 */
export function isProgramRoute(path: string): boolean {
  return path.startsWith('/summer') || path.startsWith('/weekend') || path.startsWith('/analytics')
}

/**
 * Extract program from a path
 */
export function getProgramFromPath(path: string): Program | null {
  if (path.startsWith('/summer')) return 'summer'
  if (path.startsWith('/weekend')) return 'weekend'
  if (path.startsWith('/analytics')) return 'analytics'
  return null
}

/** Home URL for each program — single source of truth for redirects and navigation */
const PROGRAM_HOME: Record<Program, string> = {
  summer: '/summer/sessions',
  weekend: '/weekend/sessions',
  analytics: '/analytics',
}

export function getProgramHomeUrl(program: Program): string {
  return PROGRAM_HOME[program]
}

const PROGRAM_PREFIXES = ['/summer/', '/weekend/', '/analytics/'] as const

/**
 * Remove program prefix from a path
 */
export function removeProgramPrefix(path: string): string {
  for (const prefix of PROGRAM_PREFIXES) {
    if (path.startsWith(prefix)) return path.slice(prefix.length - 1)
  }
  if (path === '/analytics') return '/'
  return path
}

/**
 * Generate a summer bunking URL
 */
export function getSummerUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `/summer/${cleanPath}`
}

/**
 * Generate a weekend housing URL
 */
export function getWeekendUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `/weekend/${cleanPath}`
}

/**
 * Generate URL for a session view
 */
export function getSessionUrl(sessionId: string, tab?: string): string {
  const baseUrl = `/summer/session/${sessionId}`
  return tab ? `${baseUrl}/${tab}` : baseUrl
}

export function getCamperUrl(camperId: string | number): string {
  return `/camper/${camperId}`
}

export function getAllCampersUrl(): string {
  return '/campers'
}

export function getAdminUrl(): string {
  return '/admin'
}

export function getUsersUrl(): string {
  return '/users'
}

export function getUserUrl(): string {
  return '/user'
}

export function getSessionsListUrl(): string {
  return '/summer/sessions'
}
