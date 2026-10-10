/**
 * Camperships' nav and tabs per permission (spec §3.2, §3.3; D7, D44, D55, D62, D64, D65, D76).
 * Roles as main spec §14.2 defines them: registrar = view + casework; finance = all four;
 * development = summary (+ grantors, not needed here).
 */
import { describe, expect, it } from 'vitest'

import {
  AID_SECTIONS,
  aidHomePath,
  aidSection,
  resolveAidTab,
  visibleSections,
  visibleTabs,
} from './aidNav'

const holding = (...granted: string[]) => ({ hasPermission: (p: string) => granted.includes(p) })
const REGISTRAR = holding('financial_aid.view', 'financial_aid.casework')
const FINANCE = holding(
  'financial_aid.view',
  'financial_aid.casework',
  'financial_aid.rules',
  'financial_aid.summary'
)
const DEVELOPMENT = holding('financial_aid.summary')
const ADMIN = { hasPermission: () => true }

const labels = (xs: ReadonlyArray<{ label: string }>) => xs.map((x) => x.label)

describe('the nav (D7 as amended by D64, D65)', () => {
  it('is Today · Requests · Money · Season · Reports, in that order (Grants folded into Money, 10-08)', () => {
    expect(labels(AID_SECTIONS)).toEqual(['Today', 'Requests', 'Money', 'Season', 'Reports'])
  })

  // Today is a home page for everyone who can open Camperships (view or summary), so it is first in the nav.
  it('draws Today first for the registrar, then the other four', () => {
    expect(labels(visibleSections(REGISTRAR))).toEqual([
      'Today',
      'Requests',
      'Money',
      'Season',
      'Reports',
    ])
  })

  it('is not parked, and sits at its real path, open to view or summary', () => {
    const today = AID_SECTIONS.find((s) => s.key === 'today')
    expect(today?.path).toBe('/aid/today')
    expect(today).not.toHaveProperty('parked')
    expect(today?.access.anyOf).toEqual(['financial_aid.view', 'financial_aid.summary'])
  })

  it('shows a summary-only user Today and Reports (D65)', () => {
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Today', 'Reports'])
  })

  it('shows an admin everything', () => {
    expect(labels(visibleSections(ADMIN))).toHaveLength(5)
  })
})

describe('the tabs (URL-held, §3.6)', () => {
  it("names Season's tabs as D44 rules, and hides Scenarios without rules (D76)", () => {
    const season = aidSection('season')
    expect(labels(season.tabs)).toEqual(['Rounds & budget', 'Scenarios', 'Rules', 'History'])
    expect(labels(visibleTabs(season, REGISTRAR))).toEqual(['Rounds & budget', 'Rules', 'History'])
    expect(labels(visibleTabs(season, FINANCE))).toEqual([
      'Rounds & budget',
      'Scenarios',
      'Rules',
      'History',
    ])
  })

  it("names Money's tabs: Ledger · To place · Grants · Funders (owner 10-08)", () => {
    expect(labels(aidSection('money').tabs)).toEqual(['Ledger', 'To place', 'Grants', 'Funders'])
    expect(aidSection('money').tabs.map((t) => t.slug)).toEqual([
      'ledger',
      'to-place',
      'grants',
      'funders',
    ])
  })

  it('opens Reports on Statistics for view holders, and on Development for summary-only (D64, D65, Q7)', () => {
    const reports = aidSection('reports')
    expect(labels(visibleTabs(reports, REGISTRAR))).toEqual([
      'Statistics',
      'Year over year',
      'Development',
      'ZIP codes',
    ])
    expect(labels(visibleTabs(reports, DEVELOPMENT))).toEqual(['Development', 'ZIP codes'])
  })

  it('keeps every slug unique within its section', () => {
    for (const section of AID_SECTIONS) {
      const slugs = section.tabs.map((t) => t.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })
})

describe('aidHomePath', () => {
  it('lands everyone with a Today page on Today', () => {
    expect(aidHomePath(holding('financial_aid.view'))).toBe('/aid/today')
    expect(aidHomePath(holding('financial_aid.summary'))).toBe('/aid/today')
    expect(aidHomePath(REGISTRAR)).toBe('/aid/today')
    expect(aidHomePath(DEVELOPMENT)).toBe('/aid/today')
  })
})

describe('resolveAidTab (§3.6; D76)', () => {
  const season = aidSection('season')

  it('sends a bare or unknown tab to the first one this user may see', () => {
    expect(resolveAidTab(season, undefined, REGISTRAR)).toMatchObject({
      kind: 'first',
      tab: { slug: 'rounds-budget' },
    })
    expect(resolveAidTab(season, 'bogus', FINANCE)).toMatchObject({ kind: 'first' })
  })

  it('refuses a known tab this user may not see, rather than sending it away (D76)', () => {
    expect(resolveAidTab(season, 'scenarios', REGISTRAR)).toEqual({ kind: 'denied' })
    expect(resolveAidTab(season, undefined, DEVELOPMENT)).toEqual({ kind: 'denied' })
  })

  it('shows a tab this user may see, with the tabs for the bar', () => {
    const shown = resolveAidTab(season, 'rules', REGISTRAR)
    expect(shown.kind).toBe('show')
    if (shown.kind === 'show') {
      expect(shown.tab?.slug).toBe('rules')
      expect(labels(shown.tabs)).toEqual(['Rounds & budget', 'Rules', 'History'])
    }
  })
})

describe('Money for development (owner 10-06, rulings:676; folded into Money 10-08)', () => {
  // main spec §14.2's development role: summary and grantors; no view (owner 10-09 folded funding_sources into grantors).
  const DEVELOPMENT_GRANTORS = holding('financial_aid.summary', 'financial_aid.grantors')
  const money = aidSection('money')

  it('shows development Money beside Reports, and only its Funders tab', () => {
    expect(labels(visibleSections(DEVELOPMENT_GRANTORS))).toEqual(['Today', 'Money', 'Reports'])
    expect(labels(visibleTabs(money, DEVELOPMENT_GRANTORS))).toEqual(['Funders'])
  })

  it('opens a bare Money on Funders for development, and refuses the other three tabs', () => {
    expect(resolveAidTab(money, undefined, DEVELOPMENT_GRANTORS)).toMatchObject({
      kind: 'first',
      tab: { slug: 'funders' },
    })
    for (const slug of ['ledger', 'to-place', 'grants']) {
      expect(resolveAidTab(money, slug, DEVELOPMENT_GRANTORS)).toEqual({ kind: 'denied' })
    }
    expect(resolveAidTab(money, 'funders', DEVELOPMENT_GRANTORS)).toMatchObject({
      kind: 'show',
      tab: { slug: 'funders' },
    })
  })

  it('opens a bare Money on the Ledger for view holders, every tab theirs (not To place)', () => {
    expect(resolveAidTab(money, undefined, REGISTRAR)).toMatchObject({
      kind: 'first',
      tab: { slug: 'ledger' },
    })
    expect(labels(visibleTabs(money, REGISTRAR))).toEqual([
      'Ledger',
      'To place',
      'Grants',
      'Funders',
    ])
  })

  it('has no Grants section any more', () => {
    expect(() => aidSection('grants' as never)).toThrow()
  })

  it('sends development home to Today, and a summary-only user sees no Money', () => {
    expect(aidHomePath(DEVELOPMENT_GRANTORS)).toBe('/aid/today')
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Today', 'Reports'])
  })
})

describe('Reports: four flat tabs, no views (owner Q7)', () => {
  const reports = aidSection('reports')

  it('is Statistics, Year over year, Development, ZIP codes, in that order, with no views', () => {
    expect(reports.tabs.map((t) => t.slug)).toEqual([
      'statistics',
      'year-over-year',
      'development',
      'zip-codes',
    ])
    expect(reports.tabs.some((t) => 'views' in t && t.views !== undefined)).toBe(false)
  })

  it('gives summary-only users Development and ZIP codes only (owner Q7)', () => {
    expect(labels(visibleTabs(reports, DEVELOPMENT))).toEqual(['Development', 'ZIP codes'])
  })
})
