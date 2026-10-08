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
      'Programs',
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

describe('Grants for development (owner 10-06, rulings:676: finance and development edit grantors in Grants)', () => {
  // main spec §14.2's development role: summary, funding_sources and grantors; no view.
  const DEVELOPMENT_GRANTORS = holding(
    'financial_aid.summary',
    'financial_aid.funding_sources',
    'financial_aid.grantors'
  )
  const grants = aidSection('grants')

  it('shows development Grants beside Reports, and only its Grantors tab', () => {
    expect(labels(visibleSections(DEVELOPMENT_GRANTORS))).toEqual(['Grants', 'Reports'])
    expect(labels(visibleTabs(grants, DEVELOPMENT_GRANTORS))).toEqual(['Grantors'])
  })

  it('opens a bare Grants on Grantors for development, and refuses the other three tabs', () => {
    expect(resolveAidTab(grants, undefined, DEVELOPMENT_GRANTORS)).toMatchObject({
      kind: 'first',
      tab: { slug: 'grantors' },
    })
    for (const slug of ['register', 'needs-attention', 'expected']) {
      expect(resolveAidTab(grants, slug, DEVELOPMENT_GRANTORS)).toEqual({ kind: 'denied' })
    }
    expect(resolveAidTab(grants, 'grantors', DEVELOPMENT_GRANTORS)).toMatchObject({
      kind: 'show',
      tab: { slug: 'grantors' },
    })
  })

  it('keeps the Register first for view holders, every tab theirs', () => {
    expect(resolveAidTab(grants, undefined, REGISTRAR)).toMatchObject({
      kind: 'first',
      tab: { slug: 'register' },
    })
    expect(labels(visibleTabs(grants, REGISTRAR))).toEqual([
      'Register',
      'Needs attention',
      'Expected',
      'Grantors',
    ])
  })

  it('still sends development home to Reports › Development, and a summary-only user sees no Grants', () => {
    expect(aidHomePath(DEVELOPMENT_GRANTORS)).toBe('/aid/reports/development')
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Reports'])
  })
})
