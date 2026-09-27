/**
 * Tells the admin audit log when a "view as" preview starts and stops
 * (spec 2026-09-26 §4.4). PocketBase writes one row for each, sharing a session
 * id, and the Audit Log shows them as one line. Switching persona mid-preview
 * is a stop and a new start.
 *
 * Deliberately NOT fetchWithAuth or the PocketBase SDK: both add this tab's
 * X-Kindred-View-As header, and PocketBase must see the REAL admin (it refuses
 * an event sent under a persona). The JWT still travels, as a Bearer header.
 *
 * Fail open, and fire-and-forget: `keepalive` lets the request outlive the
 * reload that follows every switch, and a failure never blocks a preview.
 */
import { pb } from '../lib/pocketbase'
import { viewAsLabel, type ViewAsPersona } from './viewAs'

const SESSION_KEY = 'kindred.viewAsSession'

export const VIEW_AS_START_URL = '/api/custom/view-as/start'
export const VIEW_AS_STOP_URL = '/api/custom/view-as/stop'

function newSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function readSessionId(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSessionId(id: string | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(SESSION_KEY)
    else window.sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    // Storage unavailable: the stop row is simply not sent.
  }
}

function post(url: string, body: Record<string, unknown>): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (pb.authStore.token) headers['Authorization'] = `Bearer ${pb.authStore.token}`
  try {
    void fetch(url, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true }).catch(
      () => undefined
    )
  } catch {
    // Never let the audit log get in the way of a preview.
  }
}

/**
 * Record a switch from `current` to `next` (null = real access). Call it BEFORE
 * the persona is written to storage, while `current` is still the old one.
 */
export function recordViewAsSwitch(
  current: ViewAsPersona | null,
  next: ViewAsPersona | null
): void {
  if (current !== null) {
    const sessionId = readSessionId()
    if (sessionId) post(VIEW_AS_STOP_URL, { session_id: sessionId })
    writeSessionId(null)
  }
  if (next !== null) {
    const sessionId = newSessionId()
    writeSessionId(sessionId)
    post(VIEW_AS_START_URL, {
      session_id: sessionId,
      persona: viewAsLabel(next),
      permissions: next.permissions,
    })
  }
}
