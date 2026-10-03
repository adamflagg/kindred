/**
 * Season › Rules on screen (spec §7.5; D39, D76). The reads are mocked with rulesFixtures' invented
 * 2027 rules; finance holds `rules`, the registrar doesn't.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidApiError } from '../../../../services/camperships/aidApi'
import type { ApiAidApprovedRules, ApiAidRulesDraft } from '../../../../types/api-types'
import { APPROVED_RULES, rulesDraft } from './rulesFixtures'
import { RulesTab } from './RulesTab'

interface Read<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}
let approved: Read<ApiAidApprovedRules>
let draft: Read<ApiAidRulesDraft>
const askedVersion: Array<number | null> = []
vi.mock('../../../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: (version: number | null, { enabled = true } = {}) => {
    if (enabled) askedVersion.push(version)
    return enabled ? approved : { data: undefined, isLoading: false, error: null }
  },
  useAidRulesDraft: ({ enabled = true } = {}) =>
    enabled ? draft : { data: undefined, isLoading: false, error: null },
}))
let granted: string[] = []
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RulesTab />
      <Where />
    </MemoryRouter>
  )
}

const panel = () => screen.getByTestId('rules-section')

beforeEach(() => {
  granted = REGISTRAR
  approved = { data: APPROVED_RULES, isLoading: false, error: null }
  draft = { data: rulesDraft(), isLoading: false, error: null }
  askedVersion.length = 0
})

describe('RulesTab for the registrar (D76: the approved version, read only)', () => {
  it('lists every section in two groups, with its status, who and when', () => {
    renderAt('/aid/season/rules')
    expect(screen.getByText('Settings that move the money')).toBeInTheDocument()
    const award = document.querySelector('[data-rules-section="award_tables"]') as HTMLElement
    expect(within(award).getByText('Approved')).toBeInTheDocument()
    expect(within(award).getByText(/Finance, Jan 20 meeting/)).toBeInTheDocument()
    const income = document.querySelector('[data-rules-section="income"]') as HTMLElement
    expect(within(income).getByText('Locked')).toBeInTheDocument()
  })

  it('opens the section the link names, read only, its figures as staff read them', () => {
    renderAt('/aid/season/rules?section=budget')
    expect(within(panel()).getByText('Budget and reserves')).toBeInTheDocument()
    expect(within(panel()).getByText('$1,000,000')).toBeInTheDocument()
    expect(within(panel()).getByText('90%')).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox')).toBeNull()
  })

  it('never shows a draft: no draft tab, no changes, a never-approved section says so', () => {
    renderAt('/aid/season/rules?section=milestones')
    expect(screen.queryByRole('link', { name: /Rules draft/ })).toBeNull()
    expect(within(panel()).getByText(/shows here once finance approves it/)).toBeInTheDocument()
  })

  it("opens a receipt's version, and offers the rules as they price the season", () => {
    renderAt('/aid/season/rules?version=2&year=2027')
    expect(askedVersion).toContain(2)
    expect(screen.getByText(/Rules v2, the version a receipt names/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'The Rules as They Price the Season ›' })
    ).toHaveAttribute('href', '/aid/season/rules?year=2027')
  })

  it('says so when no rules are approved for the season yet', () => {
    approved = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('2027 has no approved rules yet', 404),
    }
    renderAt('/aid/season/rules')
    expect(screen.getByText('No approved rules for 2027 yet.')).toBeInTheDocument()
  })
})

describe('RulesTab keeps what it has when a refetch fails', () => {
  it('still shows the approved rules when data and an error are both held', () => {
    approved = { data: APPROVED_RULES, isLoading: false, error: new Error('refetch failed') }
    renderAt('/aid/season/rules?section=budget')
    expect(within(panel()).getByText('$1,000,000')).toBeInTheDocument()
  })
})

describe('RulesTab review fixes', () => {
  it('keeps the page as-of in every in-tab link (I6, D15)', () => {
    renderAt('/aid/season/rules?section=budget&as_of=2026-03-15')
    const award = document.querySelector('[data-rules-section="award_tables"]') as HTMLElement
    expect(award.getAttribute('href')).toContain('as_of=2026-03-15')
  })

  it("names a version that doesn't exist, and offers the way out", () => {
    approved = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('No aid rules for 2027 version 99', 404),
    }
    renderAt('/aid/season/rules?version=99&year=2027')
    expect(screen.getByText("Rules v99 doesn't exist for 2027.")).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'The Rules as They Price the Season ›' })
    ).toHaveAttribute('href', '/aid/season/rules?year=2027')
  })

  it("says which version a section comes from when it isn't the pricing one", () => {
    approved = {
      data: {
        ...APPROVED_RULES,
        sections: APPROVED_RULES.sections.map((s) =>
          s.section === 'budget' ? { ...s, version: 4 } : s
        ),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/season/rules?section=budget')
    expect(within(panel()).getByText(/from v4/)).toBeInTheDocument()
  })

  it('opens on Income when ?section= names nothing', () => {
    renderAt('/aid/season/rules?section=nope')
    expect(within(panel()).getByText('Income')).toBeInTheDocument()
  })

  it('shows the loading state, not the no-rules note', () => {
    approved = { data: undefined, isLoading: true, error: null }
    renderAt('/aid/season/rules')
    expect(screen.getByText(/Loading the rules/)).toBeInTheDocument()
  })
})

describe('RulesTab for finance (D39)', () => {
  beforeEach(() => {
    granted = FINANCE
  })

  it("opens on the rules draft, each section's changes counted against the approved rules", () => {
    renderAt('/aid/season/rules')
    expect(screen.getByRole('link', { name: 'Rules draft v4' })).toBeInTheDocument()
    expect(screen.getByText('Rules draft v4, against the approved v3.')).toBeInTheDocument()
    const award = document.querySelector('[data-rules-section="award_tables"]') as HTMLElement
    expect(within(award).getByText('Draft · 1 change')).toBeInTheDocument()
    expect(within(award).getByText(/Test User · from B2/)).toBeInTheDocument()
  })

  it("shows a section's changes in words and in amber, and its validation issues", () => {
    renderAt('/aid/season/rules?section=award_tables')
    expect(
      within(screen.getByTestId('section-changes')).getByText(
        'General › Tiers › Tier 2 › Round 1 %: 60% → 55%'
      )
    ).toBeInTheDocument()
    expect(within(panel()).getByText('55%')).toHaveClass('text-amber-700')
    renderAt('/aid/season/rules?section=budget')
    expect(screen.getByText('Pool B sets no reserves: all of it is Round 1')).toBeInTheDocument()
  })

  it('switches to the approved version, as the registrar sees it, in the URL', () => {
    renderAt('/aid/season/rules?show=approved&section=budget')
    expect(screen.getByRole('link', { name: 'Approved' })).toHaveAttribute(
      'href',
      '/aid/season/rules?show=approved&section=budget&year=2027'
    )
    expect(screen.getByText('The approved rules: v3 prices the season.')).toBeInTheDocument()
  })

  it("opens a receipt's version as the approved read, never the draft (Decision 31)", () => {
    renderAt('/aid/season/rules?version=2&year=2027')
    expect(askedVersion).toContain(2)
    expect(screen.getByText(/Rules v2, the version a receipt names/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rules draft/ })).toBeNull()
  })

  it('still shows the draft when a refetch fails', () => {
    draft = { data: rulesDraft(), isLoading: false, error: new Error('refetch failed') }
    renderAt('/aid/season/rules?section=award_tables')
    expect(within(panel()).getByText('55%')).toBeInTheDocument()
  })

  it('keeps every validation row when two issues share a code and path', () => {
    const d = rulesDraft()
    const issue = d.report.issues?.[0]
    if (!issue) throw new Error('fixture has no issue')
    d.report = { ...d.report, issues: [issue, { ...issue }] }
    draft = { data: d, isLoading: false, error: null }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderAt(`/aid/season/rules?section=${issue.section}`)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    spy.mockRestore()
  })

  it('says so when the season has no rules at all yet', () => {
    draft = { data: undefined, isLoading: false, error: new AidApiError('No rules for 2027', 404) }
    renderAt('/aid/season/rules')
    expect(screen.getByText('No rules for 2027 yet.')).toBeInTheDocument()
  })
})
