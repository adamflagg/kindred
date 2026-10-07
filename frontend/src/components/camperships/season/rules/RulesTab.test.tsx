/**
 * Season › Rules on screen (spec §6, §7.5; D39, D76), as chapters under a chapter bar. The reads are mocked with
 * rulesFixtures' invented 2027 rules; finance holds `rules`, the registrar doesn't.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidApiError } from '../../../../services/camperships/aidApi'
import type { ApiAidApprovedRules, ApiAidRulesDraft } from '../../../../types/api-types'
import { APPROVED_RULES, rulesDraft } from './rulesFixtures'
import { ApproveButton, SeasonChromeProvider } from '../SeasonChrome'
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
// The editing has its own tests (RulesEditing.test.tsx); here the writes do nothing.
vi.mock('../../../../hooks/camperships/useAidRulesWrites', () => {
  const idle = () => ({ isPending: false, mutate: vi.fn() })
  return {
    useAidSaveRulesSection: idle,
    useAidApproveRules: idle,
    useAidStartRulesFromLastYear: idle,
    useFreshAidRulesDraft: () => () => new Promise(() => undefined),
  }
})
let granted: string[] = []
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let year = 2027
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => year }))
let sessionNames: ReadonlyMap<number, string> | undefined
vi.mock('../../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => sessionNames,
}))

const observed: Array<(entries: Array<{ isIntersecting: boolean; target: Element }>) => void> = []
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
      observed.push(cb)
    }
    observe() {}
    disconnect() {}
  }
)

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SeasonChromeProvider section="income" tab="rules">
        <ApproveButton />
        <RulesTab />
      </SeasonChromeProvider>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = REGISTRAR
  year = 2027
  approved = { data: APPROVED_RULES, isLoading: false, error: null }
  draft = { data: rulesDraft(), isLoading: false, error: null }
  askedVersion.length = 0
  observed.length = 0
  sessionNames = undefined
})

describe('RulesTab for the registrar (D76: the approved version, read only)', () => {
  it("opens a receipt's version, and offers the rules as they price the season", () => {
    renderAt('/aid/season/rules?version=2&year=2027')
    expect(askedVersion).toContain(2)
    expect(screen.getByText(/Rules v2 · approved Jan 20, 2027\./)).toBeInTheDocument()
    expect(screen.queryByText(/receipt/)).toBeNull()
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

  it('opens a chapter its link names and says a never-approved section is not approved yet', () => {
    renderAt('/aid/season/rules?section=milestones')
    expect(screen.getByTestId('card-head-milestones')).toBeInTheDocument()
    expect(screen.getByText(/shows here once finance approves it/)).toBeInTheDocument()
  })
})

describe('RulesTab keeps what it has when a refetch fails', () => {
  it('still shows the approved rules when data and an error are both held', () => {
    approved = { data: APPROVED_RULES, isLoading: false, error: new Error('refetch failed') }
    renderAt('/aid/season/rules?open=1')
    expect(screen.getByTestId('card-head-income')).toBeInTheDocument()
  })

  it('still shows the draft when a refetch fails', () => {
    granted = FINANCE
    draft = { data: rulesDraft(), isLoading: false, error: new Error('refetch failed') }
    renderAt('/aid/season/rules')
    expect(screen.getByTestId('card-head-award_tables')).toBeInTheDocument()
  })
})

describe('RulesTab review fixes', () => {
  it('keeps the page as-of in every in-tab link (I6, D15)', () => {
    granted = FINANCE
    renderAt('/aid/season/rules?as_of=2026-03-15')
    expect(screen.getByRole('link', { name: 'v3 in effect' }).getAttribute('href')).toContain(
      'as_of=2026-03-15'
    )
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
          s.section === 'programs' ? { ...s, version: 4 } : s
        ),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/season/rules?open=5')
    expect(screen.getByTestId('card-meta-programs')).toHaveTextContent(/from v4/)
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

  it("shows a section's changes in words and in amber", () => {
    renderAt('/aid/season/rules')
    expect(screen.getByText(/Changed since v3: .*Tier 2 › Round 1 %: 60% → 55%/)).toHaveClass(
      'text-amber-700'
    )
  })

  it('switches to the approved version, as the registrar sees it, in the URL', () => {
    renderAt('/aid/season/rules?show=approved&section=programs')
    expect(screen.getByRole('link', { name: /^Draft v4/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?section=programs&year=2027'
    )
  })

  it("opens a receipt's version as the approved read, never the draft (Decision 31)", () => {
    renderAt('/aid/season/rules?version=2&year=2027')
    expect(askedVersion).toContain(2)
    expect(screen.getByText(/Rules v2 · approved Jan 20, 2027\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Draft v/ })).toBeNull()
  })

  it('keeps every validation row when two issues share a code and path', async () => {
    const d = rulesDraft()
    const issue = d.report.issues?.[0]
    if (!issue) throw new Error('fixture has no issue')
    d.report = {
      ...d.report,
      issues: [
        { ...issue, section: 'awards' },
        { ...issue, section: 'awards' },
      ],
    }
    d.sections = d.sections.map((s) => (s.section === 'awards' ? { ...s, errors: 2 } : s))
    draft = { data: d, isLoading: false, error: null }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: '2 errors' }))
    expect(screen.getAllByTestId('card-issue')).toHaveLength(2)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    spy.mockRestore()
  })

  it('a folded chapter names its errors as errors, not warnings (scan #3043)', () => {
    const d = rulesDraft()
    const issue = d.report.issues?.[0]
    if (!issue) throw new Error('fixture has no issue')
    d.report = {
      ...d.report,
      issues: [
        { ...issue, section: 'awards', severity: 'error', path: 'awards.minimum' },
        { ...issue, section: 'awards', severity: 'error', path: 'awards.rounding' },
      ],
    }
    d.sections = d.sections.map((s) => (s.section === 'awards' ? { ...s, errors: 2 } : s))
    draft = { data: d, isLoading: false, error: null }
    granted = FINANCE
    renderAt('/aid/season/rules?open=1')
    const chapter = document.getElementById('chap-2')
    if (chapter === null) throw new Error('no Awards chapter')
    expect(within(chapter).getByText('2 errors')).toBeInTheDocument()
    expect(within(chapter).queryByText(/warning/)).toBeNull()
  })

  it('a folded chapter never counts a note as a warning (B3)', () => {
    const d = rulesDraft()
    const issue = d.report.issues?.[0]
    if (!issue) throw new Error('fixture has no issue')
    const cell = (severity: 'warning' | 'note', tier: number) => ({
      ...issue,
      section: 'award_tables' as const,
      code: 'value_cannot_bind',
      severity,
      path: `award_tables.general.tiers.${String(tier)}`,
      message: `general tier ${String(tier)}`,
    })
    d.report = { ...d.report, issues: [cell('warning', 1), cell('note', 2), cell('note', 3)] }
    draft = { data: d, isLoading: false, error: null }
    granted = FINANCE
    renderAt('/aid/season/rules?open=2')
    const chapter = document.getElementById('chap-1')
    if (chapter === null) throw new Error('no tier chapter')
    expect(within(chapter).getByText('1 warning')).toBeInTheDocument()
    expect(within(chapter).queryByText(/3 warnings|note/)).toBeNull()
  })

  it('says so when the season has no rules at all yet', () => {
    draft = { data: undefined, isLoading: false, error: new AidApiError('No rules for 2027', 404) }
    renderAt('/aid/season/rules')
    expect(screen.getByText('No rules for 2027 yet.')).toBeInTheDocument()
  })

  it("points at Rounds & budget with the budget section's warning count", () => {
    renderAt('/aid/season/rules')
    expect(screen.getByRole('link', { name: 'Rounds & budget ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027'
    )
  })
})

describe('RulesTab has no session capacity form', () => {
  it('shows finance only the Round 3 section in chapter 3', () => {
    granted = FINANCE
    renderAt('/aid/season/rules?open=3')
    expect(screen.queryByRole('heading', { name: /capacity/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/session capacity/i)).not.toBeInTheDocument()
  })

  it('shows the registrar none either', () => {
    renderAt('/aid/season/rules?open=3')
    expect(screen.queryByRole('heading', { name: /capacity/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/session capacity/i)).not.toBeInTheDocument()
  })

  it('shows finance none on a season with no rules yet', () => {
    granted = FINANCE
    year = 2028
    draft = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('2028 has no rules yet', 404),
    }
    approved = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('2028 has no approved rules yet', 404),
    }
    renderAt('/aid/season/rules?year=2028')
    expect(screen.getByText('No rules for 2028 yet.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /capacity/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/session capacity/i)).not.toBeInTheDocument()
  })
})

describe('Rules as chapters (spec §6)', () => {
  it('draws the chapter bar on one line: Awards and Setup strips, seven chips and Budget ›', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    const bar = screen.getByTestId('chapter-bar')
    expect(bar).toHaveClass('sticky')
    // ONE line at every width (rules-v3 "Fix 1"): the bar never wraps, it scrolls sideways if it must;
    // each strip keeps its width rather than squeezing its chips onto a second line.
    expect(bar).toHaveClass('flex-nowrap', 'overflow-x-auto')
    expect(bar).not.toHaveClass('flex-wrap')
    for (const strip of within(bar).getAllByTestId('chapter-strip'))
      expect(strip).toHaveClass('shrink-0')
    expect(
      // The fixture has no issue in any chapter, so no chip carries a count: the text is the name alone.
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Tiers & equity', 'Awards', 'Round 3', 'Checks', 'Programs', 'Dates', 'Grants'])
    expect(within(bar).getByRole('link', { name: 'Budget ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027'
    )
  })

  it('marks a chapter holding a draft section with a dot', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(
      within(screen.getByRole('button', { name: /^Tiers & equity/ })).getByTestId('chip-dot')
    ).toBeInTheDocument()
  })

  it('reads the lead line for finance on the draft and on the version in effect', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(screen.getByRole('link', { name: 'Draft v4' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'v3 in effect' })).toBeInTheDocument()
    expect(screen.getByText('v3 is frozen · approving puts v4 in effect')).toBeInTheDocument()
    cleanup()
    renderAt('/aid/season/rules?show=approved')
    expect(screen.getByText('frozen · edits go to draft v4')).toBeInTheDocument()
  })

  it('shows the registrar the version in effect, read only: no switch, no Edit…, chapters folded', () => {
    granted = REGISTRAR
    renderAt('/aid/season/rules')
    expect(
      screen.getByText(/^The approved rules: v\d+, in effect and frozen\.$/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Draft v/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
    expect(screen.queryByTestId('card-head-income')).toBeNull() // folded
  })

  it('shows finance no Edit… on a past date (Review Focus 5)', () => {
    granted = FINANCE
    renderAt('/aid/season/rules?as_of=2027-03-15')
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
  })

  it('opens the chapters with a draft section by default, and Open All / Close All folds every one', async () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(screen.getByTestId('card-head-award_tables')).toBeInTheDocument()
    expect(screen.queryByTestId('card-head-programs')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open All' }))
    expect(screen.getByTestId('card-head-programs')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('open=1%2C2%2C3%2C4%2C5%2C6%2C7')
    await userEvent.click(screen.getByRole('button', { name: 'Close All' }))
    expect(screen.queryByTestId('card-head-award_tables')).toBeNull()
  })

  it('opens the chapter a ?section= link names, and section=budget lands on the pointer', () => {
    granted = FINANCE
    renderAt('/aid/season/rules?section=programs')
    expect(screen.getByTestId('card-head-programs')).toBeInTheDocument()
    cleanup()
    renderAt('/aid/season/rules?version=3&section=budget')
    expect(screen.getByRole('link', { name: 'Rounds & budget ›' })).toBeInTheDocument()
  })

  it('reads a receipt link as that version with The Rules as They Price the Season ›', () => {
    granted = REGISTRAR
    renderAt('/aid/season/rules?version=3')
    expect(
      screen.getByRole('link', { name: 'The Rules as They Price the Season ›' })
    ).toBeInTheDocument()
  })

  it('has no sentence restating the draft version under the tab bar', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(screen.queryByText(/^Rules draft v\d+, against the approved/)).toBeNull()
  })

  it('fills the chip of the chapter in view', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    act(() =>
      observed.at(-1)?.([{ isIntersecting: true, target: document.getElementById('chap-5')! }])
    )
    expect(screen.getByRole('button', { name: /^Programs/ })).toHaveClass('bg-primary')
  })

  it('shows the seven footnotes under the page', () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(screen.getByText(/^Equity class: picks both/)).toBeInTheDocument()
  })

  it('a season with no rules (2028): "Rules draft | None in effect", "No rules for 2028 yet." and Start for finance', () => {
    granted = FINANCE
    year = 2028
    draft = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('2028 has no rules yet', 404),
    }
    approved = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('2028 has no approved rules yet', 404),
    }
    renderAt('/aid/season/rules?year=2028')
    const lead = screen.getByTestId('lead-switch')
    expect(within(lead).getByText('Rules draft')).toBeInTheDocument()
    expect(within(lead).getByText('None in effect')).toBeInTheDocument()
    expect(within(lead).queryByRole('link')).toBeNull() // nothing to switch to
    expect(screen.getByText('No rules for 2028 yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Start 2028 from 2027's Rules" })).toBeInTheDocument()
  })

  it('holds the lead line while the Approve panel is open: "Approve or cancel first.", the switch inert, no Edit…', async () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    expect(screen.getAllByRole('button', { name: 'Edit…' }).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.getByText('Approve or cancel first.')).toBeInTheDocument()
    expect(screen.queryByText('v3 is frozen · approving puts v4 in effect')).toBeNull()
    const lead = screen.getByTestId('lead-switch')
    expect(within(lead).getByText('v3 in effect')).toBeInTheDocument()
    expect(within(lead).queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
  })

  it('a fully approved draft reads "frozen · an edit starts v5", and offers no Approve…', () => {
    granted = FINANCE
    draft = { data: fullyApproved(), isLoading: false, error: null }
    renderAt('/aid/season/rules')
    expect(screen.getByText('frozen · an edit starts v5')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('lead-switch')).getByRole('link', { name: 'Rules v4' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it("links the named fund's read-only row to Grants › Grantors, where named funds are managed (owner 10-06)", () => {
    granted = FINANCE
    const d = rulesDraft()
    const fund = {
      label: 'Named full-cost fund',
      kind: 'full_cost_after_aid' as const,
      round: 1,
      amount: null,
      extra_amount: '0',
      allows_appeal: false,
      counts_toward_budget: false,
      ceiling_exempt: false,
    }
    const awards = { ...d.document.awards, decision_types: { named_full_cost_fund: fund } }
    draft = { data: { ...d, document: { ...d.document, awards } }, isLoading: false, error: null }
    renderAt('/aid/season/rules?open=2')
    expect(screen.getByRole('link', { name: 'Managed in Grants ›' })).toHaveAttribute(
      'href',
      '/aid/grants/grantors?year=2027'
    )
  })
})

/** rulesDraft() with its one draft section approved: v4 is in effect and nothing waits. */
function fullyApproved(): ApiAidRulesDraft {
  const d = rulesDraft()
  return {
    ...d,
    approved_version: 4,
    sections: d.sections.map((s) =>
      s.status.state === 'draft'
        ? {
            ...s,
            status: {
              state: 'approved' as const,
              approved_by: 'Test User',
              approved_at: '2027-01-22T17:00:00Z',
              note: 'Finance, Jan 22 meeting',
            },
            changes: [],
          }
        : s
    ),
  }
}
