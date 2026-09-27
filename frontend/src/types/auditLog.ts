/** Admin audit log types — aliases over the generated FastAPI models (api/schemas/admin_audit_log.py). */
import type { AuditLogActor, AuditLogEntry, AuditLogPage } from './api-generated'

export type AuditEntry = AuditLogEntry
export type AuditPage = AuditLogPage
export type AuditActor = AuditLogActor
export type AuditType = AuditLogEntry['type']

/** The screen's type buttons. Sign-ins have their own chip. */
export const AUDIT_FILTER_TYPES = ['access', 'roles', 'view_as', 'settings', 'pb_admin'] as const
export type AuditFilterType = (typeof AUDIT_FILTER_TYPES)[number]

export const AUDIT_PER_PAGE_OPTIONS = [10, 15, 25] as const
export type AuditPerPage = (typeof AUDIT_PER_PAGE_OPTIONS)[number]
export const AUDIT_DEFAULT_PER_PAGE: AuditPerPage = 10

/** Everything the list reads from the URL. */
export interface AuditQuery {
  q: string
  types: AuditFilterType[]
  actor: string
  signIns: boolean
  page: number
  perPage: AuditPerPage
}
