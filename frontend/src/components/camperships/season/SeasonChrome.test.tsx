/** The Season chrome (spec §4): Approve… on the tab bar, the panel, the notice. Hooks mocked; fixtures fictional. */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDraft } from '../../../types/api-types'
import { rulesDraft } from './rules/rulesFixtures'
import { AidApiError } from '../../../services/camperships/aidApi'
import {
  ApproveButton,
  ApprovePanel,
  SeasonChromeProvider,
  SeasonNotice,
  UnlockButton,
  UnlockPanel,
} from './SeasonChrome'
import { useSeasonChrome, type SeasonChrome } from './seasonChrome'

let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let yearNow = 2027
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => yearNow }))
let draft: ApiAidRulesDraft | undefined
// The approved read is the registrar's source for `season_done` (the draft is finance's).
let approved: { season_done?: boolean } | undefined
let draftError: Error | null = null
let approvedError: Error | null = null
vi.mock('../../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({ data: draft, isLoading: false, error: draftError }),
  useAidApprovedRules: () => ({ data: approved, isLoading: false, error: approvedError }),
}))
vi.mock('../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => new Map([[1000101, 'First Session']]),
}))
vi.mock('../../../hooks/camperships/useAidSessionCatalog', () => ({
  useAidSessionCatalog: () => [],
  useAidSessionCatalogError: () => null,
}))
vi.mock('../../../hooks/camperships/useLodgingCancelledSessions', () => ({
  useLodgingCancelledSessions: () => new Set<number>(),
}))
vi.mock('../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidApproveRules: () => ({ mutate: vi.fn(), isPending: false }),
  useFreshAidRulesDraft: () => () => Promise.resolve(draft as ApiAidRulesDraft),
}))

const FINANCE = ['financial_aid.view', 'financial_aid.casework', 'financial_aid.rules']

function Notice() {
  const { setNotice } = useSeasonChrome()
  return (
    <button
      type="button"
      onClick={() => setNotice('Saved to the rules draft v5 · Approve on the tab bar')}
    >
      Say
    </button>
  )
}

function Edit() {
  const { setEditing } = useSeasonChrome()
  return (
    <>
      <button type="button" onClick={() => setEditing(true)}>
        Start editing
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        Stop editing
      </button>
    </>
  )
}

function Busy() {
  const { setApproveBusy } = useSeasonChrome()
  return (
    <button type="button" onClick={() => setApproveBusy(true)}>
      Go busy
    </button>
  )
}

function tree(tab: string) {
  return (
    <MemoryRouter initialEntries={['/aid/season/rounds-budget']}>
      <SeasonChromeProvider section="budget" tab={tab}>
        <ApproveButton />
        <ApprovePanel />
        <SeasonNotice />
        <Notice />
        <Edit />
        <Busy />
      </SeasonChromeProvider>
    </MemoryRouter>
  )
}

function renderChrome(path = '/aid/season/rounds-budget') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SeasonChromeProvider section="budget" tab="rounds-budget">
        <ApproveButton />
        <ApprovePanel />
        <SeasonNotice />
        <Notice />
        <Edit />
        <Busy />
      </SeasonChromeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = FINANCE
  yearNow = 2027
  approved = undefined
  draftError = null
  approvedError = null
  draft = rulesDraft() // award_tables is a draft section
  // As AidSeasonPage.test.tsx does: a date is "past" only against a camp today that follows it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('SeasonChrome (spec §4)', () => {
  it('opens the panel from Approve…, which hides while the panel is open', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  // A regression guard: the panel's words (spec §4) were written with the re-skin.
  it('words the panel as the mock does, with Esc named and the checkbox named by its section alone', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument()
    expect(screen.getByText(/^e\.g\. “Board approved Apr 13”/)).toBeInTheDocument()
    expect(screen.getByText('Esc cancels')).toBeInTheDocument()
  })

  // Final mock approvePanel(): a heading row with what approving does, the change words cut with a title, and the
  // Approve button saying what it needs while it is disabled.
  it('heads the panel with what approving does, and titles the disabled Approve button with what it needs', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await screen.findByLabelText('Notes')
    // owner ruling 10-09: with only some sections ticked, no promise to price the season
    expect(
      screen.getByText(
        /^Approving these sections: v\d+ prices the season once every section is approved\.$/
      )
    ).toBeInTheDocument()
    const go = screen.getByRole('button', { name: /^Approve \d Sections?$/ })
    expect(go).toBeDisabled()
    expect(go).toHaveAttribute('title', 'Check a section and add a note')
    const form = screen.getByTestId('approve-form')
    const change = within(form).getAllByText(/›/)[0] as HTMLElement
    expect(change).toHaveClass('truncate')
    expect(change).toHaveAttribute('title', change.textContent)
  })

  it('shows one notice line with Dismiss, the only place results appear', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Say' }))
    expect(screen.getByTestId('rules-notice')).toHaveTextContent(
      'Saved to the rules draft v5 · Approve on the tab bar'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('rules-notice')).toBeNull()
  })

  it('offers nothing to the registrar', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderChrome()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('offers nothing on a past date', () => {
    renderChrome('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  // An approval that clears the last waiting section refreshes the draft before it reports: the panel must stay to
  // say what it did, and close only on its own Done or Cancel.
  it('keeps an open panel when the draft stops waiting under it', async () => {
    const view = renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const d = rulesDraft()
    draft = {
      ...d,
      sections: d.sections.map((s) => ({ ...s, status: { ...s.status, state: 'approved' } })),
    }
    view.rerender(tree('rounds-budget'))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
  })

  it("names a change's session in the panel as the Rules tab does", async () => {
    const d = rulesDraft()
    draft = {
      ...d,
      sections: d.sections.map((s) =>
        s.section === 'cost'
          ? {
              ...s,
              status: { ...s.status, state: 'draft' },
              changes: [
                { path: ['tuition', '1000101'], kind: 'changed', before: '4000', after: '4100' },
              ],
              errors: 0,
            }
          : s
      ),
    }
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(
      await screen.findByText(/Tuition by session › First Session: \$4,000 → \$4,100/)
    ).toBeInTheDocument()
  })

  it('offers nothing when no section waits for approval', () => {
    const d = rulesDraft()
    draft = {
      ...d,
      sections: d.sections.map((s) => ({ ...s, status: { ...s.status, state: 'approved' } })),
    }
    renderChrome()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  // Slice 2: Approve… showed only when nothing was being edited, so it could never approve the old copy of an open
  // editor's text.
  // Final mock hold(): the button stays, greyed, and says why.
  it('greys Approve… while an editor is open, saying why, and enables it when the editor closes', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Start editing' }))
    const approve = screen.getByRole('button', { name: 'Approve…' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('title', 'Save or cancel the edit first.')
    await userEvent.click(screen.getByRole('button', { name: 'Stop editing' }))
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeEnabled()
  })

  // Slice 2: leaving Rules closed approve mode; the rebuilt form would lose its ticks and its Notes text.
  it('closes an open panel when the Season tab changes', async () => {
    const view = renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
    view.rerender(tree('history'))
    expect(screen.queryByTestId('approve-form')).toBeNull()
  })

  it('keeps the panel on a tab change while it is submitting, so its notice lands', async () => {
    const view = renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Go busy' }))
    view.rerender(tree('history'))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
  })
})

/** Captures the chrome's context so a test can read `locked`, `pastSeasonReason` and call `unlock`. */
function renderProbe({
  seasonDone = false,
  year = 2027,
  failure,
}: { seasonDone?: boolean; year?: number; failure?: Error } = {}) {
  yearNow = year
  draft = failure ? undefined : { ...rulesDraft(), season_done: seasonDone, configured_year: 2028 }
  draftError = failure ?? null
  let seen!: SeasonChrome
  function Probe(): ReactNode {
    seen = useSeasonChrome()
    return null
  }
  const tree = () => (
    <MemoryRouter initialEntries={['/aid/season/rules']}>
      <SeasonChromeProvider section="budget" tab="rules">
        <Probe />
      </SeasonChromeProvider>
    </MemoryRouter>
  )
  const view = render(tree())
  return {
    chrome: () => seen,
    setYear: (next: number) => {
      yearNow = next
      view.rerender(tree())
    },
  }
}

describe('SeasonChrome: a done season (spec §11.3)', () => {
  it('is locked until unlocked, and the unlock carries the reason', () => {
    const { chrome } = renderProbe({ seasonDone: true })
    expect(chrome().locked).toBe(true)
    act(() => chrome().unlock('A typo in the minimum'))
    expect([chrome().locked, chrome().pastSeasonReason]).toEqual([false, 'A typo in the minimum'])
    act(() => chrome().lockAgain())
    expect(chrome().locked).toBe(true)
  })

  it('an open season is never locked and carries no reason', () => {
    const { chrome } = renderProbe({ seasonDone: false })
    expect([chrome().done, chrome().locked, chrome().pastSeasonReason]).toEqual([
      false,
      false,
      null,
    ])
  })

  // A done season usually has no draft left: finance's draft read is a 404, and the approved rules still say done.
  it('finance with no draft reads done from the approved rules', () => {
    granted = FINANCE
    approved = { season_done: true }
    const { chrome } = renderProbe({ failure: new AidApiError('No rules draft for 2026', 404) })
    expect([chrome().done, chrome().locked, chrome().unreadable]).toEqual([true, true, null])
  })

  it('the registrar reads done from the approved rules', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    approved = { season_done: true }
    const { chrome } = renderProbe({ seasonDone: false })
    expect([chrome().done, chrome().locked]).toEqual([true, true])
  })

  it('an unlock lasts one sitting: 30 minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
    const { chrome } = renderProbe({ seasonDone: true })
    act(() => chrome().unlock('Late fix'))
    act(() => {
      vi.advanceTimersByTime(29 * 60 * 1000)
    })
    expect(chrome().locked).toBe(false)
    act(() => {
      vi.advanceTimersByTime(60 * 1000)
    })
    expect(chrome().locked).toBe(true)
  })

  it('a change of year ends it', () => {
    const { chrome, setYear } = renderProbe({ seasonDone: true, year: 2027 })
    act(() => chrome().unlock('Late fix'))
    setYear(2026)
    expect([chrome().locked, chrome().pastSeasonReason]).toEqual([true, null])
  })

  it('a change of year ends it for good: coming back to the year finds it locked', () => {
    const { chrome, setYear } = renderProbe({ seasonDone: true, year: 2027 })
    act(() => chrome().unlock('Late fix'))
    setYear(2026)
    setYear(2027)
    expect([chrome().locked, chrome().pastSeasonReason]).toEqual([true, null])
  })

  // Coordinator ruling: Lock Again is a deliberate click, so it closes the Approve panel and tells every editor to
  // close (`relocks`); the 30 minutes running out leaves them open, so staff can Unlock… again and Save the typing.
  it('Lock Again closes the Approve panel and counts a relock', () => {
    const { chrome } = renderProbe({ seasonDone: true })
    act(() => chrome().unlock('Late fix'))
    act(() => chrome().openApprove())
    expect([chrome().approving, chrome().relocks]).toEqual([true, 0])
    act(() => chrome().lockAgain())
    expect([chrome().approving, chrome().relocks]).toEqual([false, 1])
  })

  it('the 30 minutes running out leaves the Approve panel open and counts no relock', () => {
    vi.useFakeTimers()
    const { chrome } = renderProbe({ seasonDone: true })
    act(() => chrome().unlock('Late fix'))
    act(() => chrome().openApprove())
    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000)
    })
    expect([chrome().locked, chrome().approving, chrome().relocks]).toEqual([true, true, 0])
  })

  it('Approve… waits on a locked season', () => {
    const { chrome } = renderProbe({ seasonDone: true })
    expect(chrome().canApprove).toBe(false)
    act(() => chrome().unlock('Late fix'))
    expect(chrome().canApprove).toBe(true)
  })
})

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']

/** The tab bar's right (Approve…, Unlock…) and the panel under it, over a done season by default. */
function renderUnlock({
  persona = 'finance',
  seasonDone = true,
}: { persona?: 'finance' | 'registrar'; seasonDone?: boolean } = {}) {
  granted = persona === 'finance' ? FINANCE : REGISTRAR
  draft = { ...rulesDraft(), season_done: seasonDone, configured_year: 2028 }
  approved = { season_done: seasonDone }
  return render(
    <MemoryRouter initialEntries={['/aid/season/rules']}>
      <SeasonChromeProvider section="budget" tab="rules">
        <ApproveButton />
        <UnlockButton />
        <UnlockPanel />
      </SeasonChromeProvider>
    </MemoryRouter>
  )
}

describe('the Unlock panel as an editor (§24)', () => {
  it('puts Unlock, Back and the logged-with-who line on one row', async () => {
    renderUnlock()
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    const row = screen.getByRole('button', { name: 'Unlock' }).parentElement as HTMLElement
    expect(row).toHaveClass('flex-nowrap')
    expect(within(row).getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(
      within(row).getByText(/Every save and approval is logged with this reason/)
    ).toBeInTheDocument()
  })
})

describe('Unlock… on a done season (spec §11.3)', () => {
  it('replaces Approve… with Unlock… for finance, and the registrar gets neither', () => {
    renderUnlock()
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
    cleanup()
    renderUnlock({ persona: 'registrar' })
    expect(screen.queryByRole('button', { name: 'Unlock…' })).toBeNull()
  })

  it('offers no Unlock… on an open season, where Approve… stays', () => {
    renderUnlock({ seasonDone: false })
    expect(screen.queryByRole('button', { name: 'Unlock…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
  })

  it('opens the panel in its words, and Back closes it', async () => {
    renderUnlock()
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    expect(screen.getByText('Unlock 2027')).toBeInTheDocument()
    expect(screen.getByLabelText('Why correct a done season?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'If you unlock: Edit… and Approve… come back for this visit. Every save and approval is logged with this reason.'
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByText('Unlock 2027')).toBeNull()
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument()
  })

  it('needs a reason to unlock', async () => {
    renderUnlock()
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(screen.getByText('A reason is required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lock Again' })).toBeNull()
  })

  it('unlocked: an amber pill with the reason, Lock Again, and Approve… back', async () => {
    renderUnlock()
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    await userEvent.type(
      screen.getByLabelText('Why correct a done season?'),
      'A typo in the minimum'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(
      screen.getByRole('button', { name: 'Unlocked: A typo in the minimum' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Unlock 2027')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lock Again' }))
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument()
  })

  it("a reason typed for one year is not carried to another year's panel", async () => {
    const tree = () => (
      <MemoryRouter initialEntries={['/aid/season/rules']}>
        <SeasonChromeProvider section="budget" tab="rules">
          <ApproveButton />
          <UnlockButton />
          <UnlockPanel />
        </SeasonChromeProvider>
      </MemoryRouter>
    )
    const view = renderUnlock()
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    await userEvent.type(screen.getByLabelText('Why correct a done season?'), 'Late fix')
    yearNow = 2026
    view.rerender(tree())
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    expect(screen.getByText('Unlock 2026')).toBeInTheDocument()
    expect(screen.getByLabelText('Why correct a done season?')).toHaveValue('')
  })

  it('truncates a long reason in the pill, and a click opens the whole of it', async () => {
    renderUnlock()
    const long = 'The minimum for the second program was keyed in as 5000 instead of 500 by mistake'
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    await userEvent.type(screen.getByLabelText('Why correct a done season?'), long)
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    const pill = screen.getByRole('button', { name: /^Unlocked: / })
    expect(pill.textContent).not.toContain(long)
    await userEvent.click(pill)
    expect(screen.getByRole('button', { name: `Unlocked: ${long}` })).toBeInTheDocument()
  })
})

describe("a season the server can't read (503)", () => {
  const WORDS =
    "The dashboard's season couldn't be read, so no rules change is accepted; try again shortly"

  it('is locked with no Unlock…, and the Season bar says why in the server’s words', () => {
    draft = undefined
    draftError = new AidApiError(WORDS, 503)
    granted = FINANCE
    render(
      <MemoryRouter initialEntries={['/aid/season/rules']}>
        <SeasonChromeProvider section="budget" tab="rules">
          <ApproveButton />
          <UnlockButton />
        </SeasonChromeProvider>
      </MemoryRouter>
    )
    expect(screen.getByText(WORDS)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('locks the chrome for the registrar too, on the approved read', () => {
    granted = REGISTRAR
    approvedError = new AidApiError(WORDS, 503)
    approved = undefined
    render(
      <MemoryRouter initialEntries={['/aid/season/rules']}>
        <SeasonChromeProvider section="budget" tab="rules">
          <UnlockButton />
        </SeasonChromeProvider>
      </MemoryRouter>
    )
    expect(screen.getByText(WORDS)).toBeInTheDocument()
  })

  it('locks the chrome whether or not the season is done, and Approve… waits', () => {
    const { chrome } = renderProbe({ failure: new AidApiError(WORDS, 503) })
    expect([chrome().locked, chrome().unreadable, chrome().canApprove]).toEqual([
      true,
      WORDS,
      false,
    ])
  })

  it('any other failure is not a lock', () => {
    const { chrome } = renderProbe({
      failure: new AidApiError('Failed to load the rules draft (HTTP 500)', 500),
    })
    expect([chrome().locked, chrome().unreadable]).toEqual([false, null])
  })
})
