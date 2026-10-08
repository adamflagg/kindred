/**
 * Camperships' nav and tabs per permission (spec §3.2, §3.3; D7, D44, D55, D62, D64, D65, D76).
 * Roles as main spec §14.2 defines them: registrar = view + casework; finance = all four;
 * development = summary (+ funding_sources, not needed here).
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
  it('is Today · Requests · Grants · Money · Season · Reports, in that order', () => {
    expect(labels(AID_SECTIONS)).toEqual([
      'Today',
      'Requests',
      'Grants',
      'Money',
      'Season',
      'Reports',
    ])
  })

  it('shows the registrar every link', () => {
    expect(labels(visibleSections(REGISTRAR))).toHaveLength(6)
  })

  it('shows a summary-only user Reports alone (D65)', () => {
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Reports'])
  })

  it('shows an admin everything', () => {
    expect(labels(visibleSections(ADMIN))).toHaveLength(6)
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

  it("names Grants' tabs (D55, D56) and Money's (D62)", () => {
    expect(labels(aidSection('grants').tabs)).toEqual([
      'Register',
      'Needs attention',
      'Expected',
      'Grantors',
    ])
    expect(labels(aidSection('money').tabs)).toEqual(['Ledger', 'To place', 'Sources'])
  })

  it('opens Reports on Statistics for view holders, and on Development alone for summary-only (D64, D65)', () => {
    const reports = aidSection('reports')
    expect(labels(visibleTabs(reports, REGISTRAR))).toEqual([
      'Statistics',
      'Year over year',
      'Development',
    ])
    expect(labels(visibleTabs(reports, DEVELOPMENT))).toEqual(['Development'])
  })

  it('keeps every slug unique within its section', () => {
    for (const section of AID_SECTIONS) {
      const slugs = section.tabs.map((t) => t.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })
})

describe('aidHomePath', () => {
  it('is Today for view holders and Reports › Development for summary-only (D65)', () => {
    expect(aidHomePath(REGISTRAR)).toBe('/aid')
    expect(aidHomePath(DEVELOPMENT)).toBe('/aid/reports/development')
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

describe('Reports: four flat tabs, no views (owner Q7)', () => {
  const reports = aidSection('reports')

  it('is Statistics, Year over year, Development, in that order, with no views', () => {
    expect(reports.tabs.map((t) => t.slug)).toEqual(['statistics', 'year-over-year', 'development'])
    expect(reports.tabs.some((t) => 'views' in t && t.views !== undefined)).toBe(false)
  })

  it('gives Development to summary-only users alone', () => {
    expect(labels(visibleTabs(reports, DEVELOPMENT))).toEqual(['Development'])
  })
})
