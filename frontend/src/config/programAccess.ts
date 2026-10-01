/**
 * Who can open which program. Camperships is the first permission-gated program (spec §3.1;
 * D5 as amended by D65): it opens with `financial_aid.view` OR `financial_aid.summary`. The
 * other three are open to every signed-in user. Every place that lists programs (the switcher,
 * the landing cards, RootRedirect) asks here, so a saved program a user has lost falls back.
 */
import { Permission } from '../constants/permissions'
import type { Program } from '../contexts/ProgramContext'

export interface PermissionCheck {
  hasPermission: (permission: string) => boolean
}

export const CAMPERSHIPS_OPEN_PERMISSIONS = [
  Permission.FINANCIAL_AID_VIEW,
  Permission.FINANCIAL_AID_SUMMARY,
] as const

export function canOpenCamperships(can: PermissionCheck): boolean {
  return CAMPERSHIPS_OPEN_PERMISSIONS.some((permission) => can.hasPermission(permission))
}

export function canOpenProgram(program: Program, can: PermissionCheck): boolean {
  return program === 'aid' ? canOpenCamperships(can) : true
}
