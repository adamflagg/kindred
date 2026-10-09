import { aidHref, type AidView } from '../kit/asOf'

/**
 * Money's tabs (spec §8.1; owner 10-08): Ledger · To place · Grants · Funders, the slugs in
 * config/aidNav.ts. The purpose line under each tab is gone (visual true-up).
 */
export type MoneyTab = 'ledger' | 'to-place' | 'grants' | 'funders'

/**
 * To place, for every family or one (`?household=<cm_id>`, the route's D26 scope; P-8): "Only This
 * Family ›" and "All Families ›" on the tab, and "Place It in Money › To Place ›" on the Requests
 * grid and the household page (owner ruling C, 10-06). Keeps the season and the as-of (D15).
 */
export function toPlaceHref(view: AidView, householdCmId: number | null): string {
  return aidHref(
    '/aid/money/to-place',
    view,
    householdCmId === null ? {} : { household: String(householdCmId) }
  )
}

/** `?household=` as a CampMinder household id, or null for every family (a blank, 0 or junk). */
export function householdParam(raw: string | null): number | null {
  const id = Number(raw ?? '')
  return Number.isInteger(id) && id > 0 ? id : null
}
