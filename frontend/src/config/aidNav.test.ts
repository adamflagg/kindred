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
  it('is Today · Requests · Money · Season · Reports, in that order (Grants folded into Money, 10-08)', () => {
    expect(labels(AID_SECTIONS)).toEqual(['Today', 'Requests', 'Money', 'Season', 'Reports'])
  })

  it('shows the registrar every link', () => {
    expect(labels(visibleSections(REGISTRAR))).toHaveLength(5)
  })

  it('shows a summary-only user Reports alone (D65)', () => {
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Reports'])
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

describe('Money for development (owner 10-06, rulings:676; folded into Money 10-08)', () => {
  // main spec §14.2's development role: summary, funding_sources and grantors; no view.
  const DEVELOPMENT_GRANTORS = holding(
    'financial_aid.summary',
    'financial_aid.funding_sources',
    'financial_aid.grantors'
  )
  const money = aidSection('money')

  it('shows development Money beside Reports, and only its Funders tab', () => {
    expect(labels(visibleSections(DEVELOPMENT_GRANTORS))).toEqual(['Money', 'Reports'])
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

  it('has no Grants section any more, and a funding_sources-only user gets no Money (GET /sources would 403)', () => {
    expect(() => aidSection('grants' as never)).toThrow()
    expect(
      labels(visibleSections(holding('financial_aid.summary', 'financial_aid.funding_sources')))
    ).toEqual(['Reports'])
  })

  it('still sends development home to Reports › Development, and a summary-only user sees no Money', () => {
    expect(aidHomePath(DEVELOPMENT_GRANTORS)).toBe('/aid/reports/development')
    expect(labels(visibleSections(DEVELOPMENT))).toEqual(['Reports'])
  })
})
