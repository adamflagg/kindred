import { aidHref, type AidView } from '../kit/asOf'

/**
 * Money's tabs (spec §8.1; D62; money-v2.html): each tab's one-line purpose, in the mock's words,
 * shown under the tab bar so a person knows what the tab is for before reading it (P-1).
 */
export type MoneyTab = 'ledger' | 'to-place' | 'sources'

export const MONEY_TAB_PURPOSE: Readonly<Record<MoneyTab, string>> = {
  ledger: "One row per family, plus finance's posted totals by program and source.",
  'to-place':
    'CampMinder aid lines that no single request explains. Attach each one to the right request.',
  sources: "Finance's list of CampMinder descriptions and how each one is classified.",
}

export const isMoneyTab = (slug: string): slug is MoneyTab => slug in MONEY_TAB_PURPOSE

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
