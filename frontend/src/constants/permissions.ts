/**
 * RBAC permission constants for Kindred.
 *
 * Permissions are developer-defined strings that gate access to features.
 * They are stored as JSON arrays on roles and cached on user records.
 * Add new permissions here when adding new gated features.
 *
 * This file mirrors bunking/rbac/permissions.py — keep in sync.
 */

export const Permission = {
  BUNKING_MANAGE: 'bunking.manage',
  METRICS_FINANCIAL: 'metrics.financial',
  METRICS_GEO: 'metrics.geo',
  REGISTRATION_MANAGE: 'registration.manage',
  SHEETS_EXPORT: 'sheets.export',
  STAFF_HIRING: 'staff.hiring',
  USERS_MANAGE: 'users.manage',
} as const

export type PermissionValue = (typeof Permission)[keyof typeof Permission]

export const ALL_PERMISSIONS: PermissionValue[] = Object.values(Permission)
