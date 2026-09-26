/**
 * Admin "view as" persona — tab-scoped, so a second tab keeps real access.
 *
 * The persona is a SNAPSHOT of permissions taken when picked (not re-resolved
 * from the role on load). Every request carries it as `X-Kindred-View-As`, and
 * PocketBase (rbac/view_as.go), FastAPI (bunking/rbac/view_as.py) and
 * `usePermissions` each honour it only for a real admin.
 *
 * Every storage access is guarded: a private window or blocked storage reads
 * as "not previewing", so failure always falls toward real access.
 */
export const VIEW_AS_HEADER = 'X-Kindred-View-As'
const STORAGE_KEY = 'kindred.viewAs'

export interface ViewAsPersona {
  label: string
  source: 'role' | 'none' | 'custom'
  /** The role's record id when source is 'role', so the picker can mark it even if renamed. */
  roleId?: string
  permissions: string[]
}

function isPersona(value: unknown): value is ViewAsPersona {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p['label'] === 'string' &&
    (p['source'] === 'role' || p['source'] === 'none' || p['source'] === 'custom') &&
    (p['roleId'] === undefined || typeof p['roleId'] === 'string') &&
    Array.isArray(p['permissions']) &&
    p['permissions'].every((perm) => typeof perm === 'string')
  )
}

export function readViewAs(): ViewAsPersona | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isPersona(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeViewAs(persona: ViewAsPersona): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persona))
  } catch {
    // Storage unavailable: the tab stays on real access.
  }
}

export function clearViewAs(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing was stored, so nothing to clear.
  }
}

/**
 * PocketBase serves a previewing request AS a stand-in users row whose email
 * ends in this domain (pocketbase/rbac/view_as.go, viewAsPersonaEmailDomain).
 * Lists of real people filter those rows out.
 */
export const VIEW_AS_PERSONA_EMAIL_DOMAIN = 'view-as.invalid'

export function isViewAsPersonaUser(user: { email?: unknown }): boolean {
  return (
    typeof user.email === 'string' &&
    user.email.toLowerCase().endsWith(`@${VIEW_AS_PERSONA_EMAIL_DOMAIN}`)
  )
}

/** How a persona is named on screen: the switcher chip and the popout note say the same thing. */
export function viewAsLabel(persona: ViewAsPersona): string {
  return persona.source === 'custom' ? `Custom (${persona.permissions.length})` : persona.label
}

/** Headers for the current tab's persona; empty when not previewing. */
export function viewAsHeaders(): Record<string, string> {
  const persona = readViewAs()
  if (persona === null) return {}
  return {
    [VIEW_AS_HEADER]: persona.permissions.length > 0 ? persona.permissions.join(',') : 'none',
  }
}
