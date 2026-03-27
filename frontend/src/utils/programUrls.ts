import type { Program } from '../contexts/ProgramContext'

/**
 * Generate a program-specific URL
 */
export function getProgramUrl(path: string, program: Program): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const sharedRoutes = ['user', 'users', 'campers', 'camper', 'admin']
  if (sharedRoutes.some((route) => cleanPath.startsWith(route))) {
    return `/${cleanPath}`
  }
  return `/${program}/${cleanPath}`
}

/**
 * Check if a path is a program-specific route
 */
export function isProgramRoute(path: string): boolean {
  return (
    path.startsWith('/summer/') || path.startsWith('/weekend/') || path.startsWith('/analytics')
  )
}

/**
 * Extract program from a path
 */
export function getProgramFromPath(path: string): Program | null {
  if (path.startsWith('/summer/')) return 'summer'
  if (path.startsWith('/weekend/')) return 'weekend'
  if (path.startsWith('/analytics')) return 'analytics'
  return null
}

/**
 * Remove program prefix from a path
 */
export function removeProgramPrefix(path: string): string {
  if (path.startsWith('/summer/')) return path.slice(7)
  if (path.startsWith('/weekend/')) return path.slice(8)
  if (path.startsWith('/analytics/')) return path.slice(10)
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
 * Generate a camp analytics URL
 */
export function getAnalyticsUrl(): string {
  return '/analytics'
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
