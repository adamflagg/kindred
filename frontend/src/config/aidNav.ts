/**
 * Camperships' nav, tabs and who sees them (spec §3.2, §3.3, §3.6; D7, D44, D55, D62, D64, D65,
 * D76). One table, read by the nav, the tab bars, the routes and the guard test, so they can't
 * drift apart. `builtIn` is where each surface's real screen comes from (spec §12.3); until it
 * lands, the section's page says so (Decision 4).
 */
import { Permission, type PermissionValue } from '../constants/permissions'
import { CAMPERSHIPS_OPEN_PERMISSIONS, type PermissionCheck } from './programAccess'

export type AidSectionKey = 'today' | 'requests' | 'money' | 'season' | 'reports'

export interface AidAccess {
  readonly anyOf: readonly PermissionValue[]
}

export interface AidTab {
  readonly slug: string
  readonly label: string
  readonly access: AidAccess
}

export interface AidSection {
  readonly key: AidSectionKey
  readonly label: string
  readonly path: string
  readonly access: AidAccess
  readonly tabs: readonly AidTab[]
  readonly builtIn: string
}

const VIEW: AidAccess = { anyOf: [Permission.FINANCIAL_AID_VIEW] }
const RULES: AidAccess = { anyOf: [Permission.FINANCIAL_AID_RULES] }
const OPEN: AidAccess = { anyOf: CAMPERSHIPS_OPEN_PERMISSIONS }
/**
 * Owner 10-06 (rulings:676, amending S3-4 B): finance AND development add, edit and retire grantors.
 * Grants folded into Money on 10-08, so they do it in Money › Funders. Development holds `grantors` and
 * `summary` but not `view`, so Money opens for either, and its one tab for them is Funders; the other
 * three stay `view`. (GET /sources is view-or-grantors on the server, so a `funding_sources`-only user
 * would be refused: Funders stays VIEW_OR_GRANTORS.)
 */
export const MONEY_OPEN_PERMISSIONS = [
  Permission.FINANCIAL_AID_VIEW,
  Permission.FINANCIAL_AID_GRANTORS,
] as const
const VIEW_OR_GRANTORS: AidAccess = { anyOf: MONEY_OPEN_PERMISSIONS }

export const AID_SECTIONS: readonly AidSection[] = [
  {
    key: 'today',
    label: 'Today',
    path: '/aid',
    access: VIEW,
    tabs: [],
    builtIn: 'slice 1 (December)',
  },
  {
    key: 'requests',
    label: 'Requests',
    path: '/aid/requests',
    access: VIEW,
    tabs: [],
    builtIn: 'slice 1 (December)',
  },
  {
    key: 'money',
    label: 'Money',
    path: '/aid/money',
    access: VIEW_OR_GRANTORS,
    tabs: [
      { slug: 'ledger', label: 'Ledger', access: VIEW },
      { slug: 'to-place', label: 'To place', access: VIEW },
      { slug: 'grants', label: 'Grants', access: VIEW },
      { slug: 'funders', label: 'Funders', access: VIEW_OR_GRANTORS },
    ],
    builtIn: 'slice 3 (March)',
  },
  {
    key: 'season',
    label: 'Season',
    path: '/aid/season',
    access: VIEW,
    tabs: [
      { slug: 'rounds-budget', label: 'Rounds & budget', access: VIEW },
      // D76: without `rules`, Scenarios is hidden and Rules is the approved version, read only.
      { slug: 'scenarios', label: 'Scenarios', access: RULES },
      { slug: 'rules', label: 'Rules', access: VIEW },
      { slug: 'history', label: 'History', access: VIEW },
    ],
    builtIn: 'slice 2 (January)',
  },
  {
    key: 'reports',
    label: 'Reports',
    path: '/aid/reports',
    access: OPEN,
    tabs: [
      { slug: 'statistics', label: 'Statistics', access: VIEW },
      { slug: 'year-over-year', label: 'Year over year', access: VIEW },
      // D65: a summary-only user sees Development and ZIP codes, and lands on Development. Funding
      // sources lives in Money › Funders now, and Reports has no Grantors view (owner Q2, Q3, Q7).
      { slug: 'development', label: 'Development', access: OPEN },
      { slug: 'zip-codes', label: 'ZIP codes', access: OPEN },
    ],
    builtIn: 'slice 4 (before the February committee meeting)',
  },
]

export function canAccess(access: AidAccess, can: PermissionCheck): boolean {
  return access.anyOf.some((permission) => can.hasPermission(permission))
}

export function visibleSections(can: PermissionCheck): AidSection[] {
  return AID_SECTIONS.filter((section) => canAccess(section.access, can))
}

export function visibleTabs(section: AidSection, can: PermissionCheck): AidTab[] {
  return section.tabs.filter((tab) => canAccess(tab.access, can))
}

export function aidSection(key: AidSectionKey): AidSection {
  const section = AID_SECTIONS.find((s) => s.key === key)
  if (section === undefined) throw new Error(`no Camperships section "${key}"`)
  return section
}

/**
 * What a tabbed section shows for the URL's `:tab` (§3.6; D76): a bare or unknown tab goes to the
 * first tab this user may see; a known tab they may not see is refused, never redirected away;
 * a section with no tab this user may see is refused too.
 */
export type AidTabResolution =
  | { readonly kind: 'show'; readonly tab: AidTab | undefined; readonly tabs: AidTab[] }
  | { readonly kind: 'first'; readonly tab: AidTab }
  | { readonly kind: 'denied' }

export function resolveAidTab(
  section: AidSection,
  slug: string | undefined,
  can: PermissionCheck
): AidTabResolution {
  const tabs = visibleTabs(section, can)
  const current = section.tabs.find((t) => t.slug === slug)
  if (section.tabs.length > 0 && current === undefined) {
    const first = tabs[0]
    return first === undefined ? { kind: 'denied' } : { kind: 'first', tab: first }
  }
  if (current !== undefined && !tabs.includes(current)) return { kind: 'denied' }
  return { kind: 'show', tab: current, tabs }
}

/** Where `/aid` lands: Today for view holders; Reports › Development for summary-only (D65). */
export function aidHomePath(can: PermissionCheck): string {
  return canAccess(VIEW, can) ? '/aid' : '/aid/reports/development'
}
