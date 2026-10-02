/**
 * Season › Scenarios on screen (spec §7.4; D35–D38). The workspace read and the draft's work are
 * mocked; useAidScenarioDraft has its own tests for the order of the calls.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LiveResults,
  useAidScenarioDraft,
} from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidApiError } from '../../../../services/camperships/aidApi'
import type {
  ApiAidScenarioSensitivity,
  ApiAidScenarioWorkspace,
} from '../../../../types/api-types'
import { NO_PENDING, type Pending } from './scenarioModel'
import { OPTIONS, results, scenarioDraft, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

interface Read<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}
let read: Read<ApiAidScenarioWorkspace>
const STEPS: ApiAidScenarioSensitivity = {
  results: results(735000),
  levers: [
    {
      lever: 'tier_shift',
      label: 'Shift every tier (Round 1 %)',
      step: 1,
      on: null,
      round1_change: 12400,
    },
    {
      lever: 'dollar_for_dollar',
      label: 'Grants offset dollar-for-dollar',
      step: null,
      on: true,
      round1_change: -3100,
    },
  ],
}
const refetchSteps = vi.fn(() => Promise.resolve())
let steps: Read<ApiAidScenarioSensitivity> & { refetch: typeof refetchSteps }
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({
  useAidScenarios: () => read,
  useAidScenarioSensitivity: () => steps,
}))

// Typed against the hook (F-m5): a change to what the hook returns fails tsc here.
const work = {
  pending: NO_PENDING,
  live: { status: 'idle' } as LiveResults,
  busy: null as string | null,
  error: null as string | null,
  nothingToFreeze: false as boolean,
  move: vi.fn<(patch: Partial<Pending>) => void>(),
  release: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  load: vi.fn<(from: { option: string } | { trail_row: string }) => Promise<boolean>>(() =>
    Promise.resolve(true)
  ),
  keep: vi.fn<(startingPoint: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
  freeze: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  start: vi.fn<(from: 'rules' | 'last_season') => Promise<boolean>>(() => Promise.resolve(true)),
} satisfies ReturnType<typeof useAidScenarioDraft>
// The page re-renders when the double's state changes, as it would with the real hook's.
let rerenderWork: () => void = () => undefined
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => {
    const [, bump] = useReducer((n: number) => n + 1, 0)
    rerenderWork = bump
    return work
  },
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function renderTab() {
  return render(
    <MemoryRouter>
      <ScenariosTab />
    </MemoryRouter>
  )
}

beforeEach(() => {
  read = { data: workspace(), isLoading: false, error: null }
  steps = { data: STEPS, isLoading: false, error: null, refetch: refetchSteps }
  work.pending = NO_PENDING
  work.live = { status: 'idle' }
  work.busy = null
  work.error = null
  work.nothingToFreeze = false
  for (const fn of [work.move, work.release, work.load, work.keep, work.freeze, work.start])
    fn.mockReset()
  work.release.mockResolvedValue(true)
  work.load.mockResolvedValue(true)
  work.keep.mockResolvedValue(true)
  work.freeze.mockResolvedValue(true)
  work.start.mockResolvedValue(true)
  refetchSteps.mockClear()
})

describe('ScenariosTab (§7.4; D38)', () => {
  it('names the frozen snapshot and the rules versions', () => {
    renderTab()
    expect(
      screen.getByText(/Applications frozen Jan 12, 2027 by Test User · 420 requests/)
    ).toBeInTheDocument()
    expect(screen.getByText('Rules draft v4 · v3 prices the season')).toBeInTheDocument()
  })

  it('shows the draft, what it differs by, and the kept options in two levels', () => {
    renderTab()
    expect(screen.getByTestId('scenario-draft')).toHaveTextContent('from B: Round 1 % −5 pts')
    const kept = screen.getByTestId('kept-list')
    expect(within(kept).getByText('Round 1 % −2 pts')).toBeInTheDocument()
    expect(document.querySelector('[data-kept="A1"]')?.parentElement?.className).toContain('pl-5')
  })

  it('loads a kept option with a click, never asking to discard anything', async () => {
    renderTab()
    await userEvent.click(within(screen.getByTestId('kept-list')).getByText('Round 1 % −2 pts'))
    expect(work.load).toHaveBeenCalledWith({ option: 'A1' })
  })

  it("shows beside each setting what one step moves Round 1 by, in the server's words", () => {
    renderTab()
    const levers = screen.getByTestId('scenario-levers')
    expect(within(levers).getByText('Each +1 pt moves Round 1 by $12,400')).toBeInTheDocument()
    expect(within(levers).getByText('Turning it off moves Round 1 by −$3,100')).toBeInTheDocument()
  })

  it('moves the figures live while a slider moves, and records when it is let go (D37)', () => {
    renderTab()
    const slider = screen.getByRole('slider', { name: 'Shift every tier, slider' })
    fireEvent.change(slider, { target: { value: '-2' } })
    expect(work.move).toHaveBeenCalledWith({ tierShift: -2 })
    expect(work.release).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    expect(work.release).toHaveBeenCalledTimes(1)
  })

  it('records a typed minimum when the box is left, and the switch at once', async () => {
    renderTab()
    const box = screen.getByRole('textbox', { name: 'Minimum award, dollars' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    expect(work.move).toHaveBeenLastCalledWith({ minimum: '150' })
    await userEvent.tab()
    expect(work.release).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('checkbox', { name: /dollar lowers the award/ }))
    expect(work.move).toHaveBeenLastCalledWith({ dollar: false })
  })

  it('shows the live figures while moving, labelled as not yet recorded, and holds Keep', () => {
    work.pending = { ...NO_PENDING, tierShift: -2 }
    work.live = { status: 'ready', results: results(700000) }
    renderTab()
    expect(screen.getByText('Moving: recorded when you let go')).toBeInTheDocument()
    expect(screen.getByText('$700,000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep as a variant of B' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Keep as a new starting point' })).toBeDisabled()
  })

  it('keeps as a variant of the starting point, or as a new starting point (D38)', async () => {
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'Keep as a variant of B' }))
    expect(work.keep).toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: 'Keep as a new starting point' }))
    expect(work.keep).toHaveBeenCalledWith(true)
  })

  it('holds the sliders still while a write runs, and says which', () => {
    work.busy = 'Recording…'
    renderTab()
    expect(screen.getByText('Recording…')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Shift every tier, slider' })).toBeDisabled()
  })

  it('asks to freeze the applications first, then offers the two starts', async () => {
    read = { data: workspace({ snapshot: null, draft: null }), isLoading: false, error: null }
    const view = renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'Freeze the applications' }))
    expect(work.freeze).toHaveBeenCalled()
    read = { data: workspace({ draft: null }), isLoading: false, error: null }
    view.rerender(
      <MemoryRouter>
        <ScenariosTab />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: "Last season's approved rules" }))
    expect(work.start).toHaveBeenCalledWith('last_season')
  })

  it("says the server's refusal when the season can't run scenarios yet", () => {
    read = { data: undefined, isLoading: false, error: new AidApiError('No rules for 2027', 404) }
    renderTab()
    expect(screen.getByText('No rules for 2027')).toBeInTheDocument()
  })

  it('does not move the draft for a minimum that is not an amount, and says so', async () => {
    renderTab()
    const box = screen.getByRole('textbox', { name: 'Minimum award, dollars' })
    await userEvent.clear(box)
    await userEvent.type(box, 'abc')
    expect(work.move).not.toHaveBeenCalled()
    expect(screen.getByText('not an amount')).toBeInTheDocument()
  })
  it('records the switch at once (T17-m1)', async () => {
    renderTab()
    await userEvent.click(screen.getByRole('checkbox', { name: /dollar lowers the award/ }))
    expect(work.move).toHaveBeenLastCalledWith({ dollar: false })
    expect(work.release).toHaveBeenCalledTimes(1)
  })

  it('records when the band and minimum sliders are let go, by pointer or key (T17-m2)', () => {
    renderTab()
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Widen every band, slider' }))
    expect(work.release).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Minimum award, slider' }))
    expect(work.release).toHaveBeenCalledTimes(2)
    fireEvent.keyUp(screen.getByRole('slider', { name: 'Shift every tier, slider' }), {
      key: 'ArrowRight',
    })
    expect(work.release).toHaveBeenCalledTimes(3)
  })

  it('records a typed step on Enter or on leaving the box (T17-m2)', () => {
    renderTab()
    const shift = screen.getByRole('textbox', { name: 'Shift every tier, points' })
    fireEvent.change(shift, { target: { value: '-2' } })
    expect(work.move).toHaveBeenLastCalledWith({ tierShift: -2 })
    fireEvent.keyDown(shift, { key: 'Enter' })
    expect(work.release).toHaveBeenCalledTimes(1)
    const band = screen.getByRole('textbox', { name: 'Widen every band, dollars' })
    fireEvent.change(band, { target: { value: '500' } })
    expect(work.move).toHaveBeenLastCalledWith({ bandDelta: 500 })
    fireEvent.blur(band)
    expect(work.release).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Minimum award, dollars' }), {
      key: 'Enter',
    })
    expect(work.release).toHaveBeenCalledTimes(3)
  })

  it('records when a slider loses focus, if a pointer-up never came (T17-m7)', () => {
    renderTab()
    fireEvent.blur(screen.getByRole('slider', { name: 'Shift every tier, slider' }))
    expect(work.release).toHaveBeenCalledTimes(1)
  })

  it('records typing first when a kept option is clicked while it records (T17-I1)', async () => {
    work.release.mockImplementation(() => {
      work.busy = 'Recording…'
      rerenderWork()
      return Promise.resolve(true)
    })
    renderTab()
    const box = screen.getByRole('textbox', { name: 'Minimum award, dollars' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    await userEvent.click(within(screen.getByTestId('kept-list')).getByText('Round 1 % −2 pts'))
    expect(work.release).toHaveBeenCalledTimes(1)
    expect(work.load).toHaveBeenCalledWith({ option: 'A1' })
    expect(work.release.mock.invocationCallOrder[0]).toBeLessThan(
      work.load.mock.invocationCallOrder[0] ?? 0
    )
  })

  it('leaves Load and Freeze open while a write runs: the hook queues them (T17-I1)', async () => {
    work.busy = 'Recording…'
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'Freeze again' }))
    expect(work.freeze).toHaveBeenCalledTimes(1)
    await userEvent.click(within(screen.getByTestId('kept-list')).getByText('Round 1 % −2 pts'))
    expect(work.load).toHaveBeenCalledWith({ option: 'A1' })
  })

  it("says a refused write in the server's words (T17-m3)", () => {
    work.error = 'Your draft is the same as A1'
    renderTab()
    expect(screen.getByText('Your draft is the same as A1')).toBeInTheDocument()
  })

  it("says the live figures couldn't be worked out, and shows the recorded ones (T17-m3, m8)", () => {
    work.pending = { ...NO_PENDING, bandDelta: -10000 }
    work.live = { status: 'error', error: 'Bands $10,000 narrower would leave band 1 empty' }
    renderTab()
    expect(screen.getByText('Bands $10,000 narrower would leave band 1 empty')).toBeInTheDocument()
    expect(
      screen.getByText("The live figures couldn't be worked out: these are the draft as recorded")
    ).toBeInTheDocument()
    expect(screen.getByText('$735,000')).toBeInTheDocument()
  })

  it('keeps the recorded figures with a quiet marker while the live ones are worked out (T17-m8)', () => {
    work.pending = { ...NO_PENDING, tierShift: -2 }
    work.live = { status: 'loading' }
    renderTab()
    expect(screen.getByText('The draft as recorded')).toBeInTheDocument()
    expect(screen.getByText('updating…')).toBeInTheDocument()
    expect(screen.queryByText('Working it out…')).toBeNull()
  })

  it('shows a refused release once, not as the live error and the write error both (F-m6)', () => {
    const refused = 'Bands $10,000 narrower would leave band 1 empty or below $0'
    work.pending = { ...NO_PENDING, bandDelta: -10000 }
    work.error = refused
    work.live = { status: 'error', error: refused }
    renderTab()
    expect(screen.getAllByText(refused)).toHaveLength(1)
  })

  it('starts from the rules draft (T17-m3)', async () => {
    read = { data: workspace({ draft: null }), isLoading: false, error: null }
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'The rules draft (v4)' }))
    expect(work.start).toHaveBeenCalledWith('rules')
  })

  it('names the version pricing the season as the rules, not a draft (F-m3)', () => {
    read = { data: workspace({ pricing_version: 4, draft: null }), isLoading: false, error: null }
    renderTab()
    expect(screen.getByText('Rules v4 prices the season')).toBeInTheDocument()
    expect(screen.queryByText(/Rules draft v4/)).toBeNull()
    expect(screen.getByRole('button', { name: 'The rules (v4)' })).toBeInTheDocument()
  })

  it('offers no Keep while the draft is the same as where it came from (T17-m4)', () => {
    read = {
      data: workspace({ draft: scenarioDraft({ label: 'no changes', changes: [] }) }),
      isLoading: false,
      error: null,
    }
    renderTab()
    expect(screen.getByRole('button', { name: 'Keep as a variant of B' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Keep as a new starting point' })).toBeDisabled()
  })

  it('dates the freeze and each keep by the camp day, not the UTC one (T17-m5)', () => {
    const evening = '2027-01-13T02:00:00Z' // Jan 12, 6 pm in camp time
    read = {
      data: workspace({
        snapshot: { ...workspace().snapshot!, taken_at: evening },
        options: OPTIONS.map((option) => ({ ...option, kept_at: evening })),
      }),
      isLoading: false,
      error: null,
    }
    renderTab()
    expect(screen.getByText(/Applications frozen Jan 12, 2027 by Test User/)).toBeInTheDocument()
    expect(screen.getAllByText(/kept by Test User, Jan 12/)).toHaveLength(OPTIONS.length)
  })

  it("says held requests wait for a freeze after approval, in the server's words (F-⚠1)", () => {
    read = {
      data: workspace({ snapshot: { ...workspace().snapshot!, awaiting_rules: 9 } }),
      isLoading: false,
      error: null,
    }
    renderTab()
    expect(
      screen.getByText(
        /· 9 held in every scenario: freeze again once programs and cost are approved/
      )
    ).toBeInTheDocument()
  })

  it('says so when a freeze found nothing new since the last one (F-m7)', () => {
    work.nothingToFreeze = true
    renderTab()
    expect(
      screen.getByText("The applications haven't moved since Jan 12: nothing new to freeze")
    ).toBeInTheDocument()
  })

  it("says each setting's step couldn't be worked out, and tries again (F-m8)", async () => {
    steps = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('Freeze 2027 again: the snapshot lacks a read', 422),
      refetch: refetchSteps,
    }
    renderTab()
    expect(
      screen.getByText(
        "Couldn't work out each setting's step: Freeze 2027 again: the snapshot lacks a read"
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetchSteps).toHaveBeenCalledTimes(1)
  })

  it("heads the pool table with the strip's own qualifiers (T17-⚠1)", () => {
    renderTab()
    const headers = within(screen.getByTestId('scenario-results'))
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['Round 2 (appeals keyed so far)', 'Remaining (every round)'])
    )
    expect(headers).not.toContain('Round 2')
    expect(headers).not.toContain('Remaining')
  })
  it('says what a step box takes, and leaves the draft be, for a value off its step (residue 12)', () => {
    renderTab()
    const band = screen.getByRole('textbox', { name: 'Widen every band, dollars' })
    fireEvent.change(band, { target: { value: '1200' } })
    expect(screen.getByText('in steps of $500')).toBeInTheDocument()
    fireEvent.change(band, { target: { value: '20000' } })
    expect(screen.getByText('from −$10,000 to $10,000')).toBeInTheDocument()
    expect(work.move).not.toHaveBeenCalled()
  })
})
