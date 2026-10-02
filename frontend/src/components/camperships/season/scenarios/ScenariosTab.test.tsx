/**
 * Season › Scenarios on screen (spec §7.4; D35–D38). The workspace read and the draft's work are
 * mocked; useAidScenarioDraft has its own tests for the order of the calls.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiveResults } from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidApiError } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioWorkspace } from '../../../../types/api-types'
import { NO_PENDING, type Pending } from './scenarioModel'
import { results, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

interface Read<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}
let read: Read<ApiAidScenarioWorkspace>
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({
  useAidScenarios: () => read,
  useAidScenarioSensitivity: () => ({
    data: {
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
    },
  }),
}))

const work = {
  pending: NO_PENDING,
  live: { status: 'idle' } as LiveResults,
  busy: null as string | null,
  error: null as string | null,
  move: vi.fn<(patch: Partial<Pending>) => void>(),
  release: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  load: vi.fn<(from: { option: string } | { trail_row: string }) => Promise<void>>(() =>
    Promise.resolve()
  ),
  keep: vi.fn<(startingPoint: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
  freeze: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  start: vi.fn<(from: 'rules' | 'last_season') => Promise<boolean>>(() => Promise.resolve(true)),
}
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => work,
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
  work.pending = NO_PENDING
  work.live = { status: 'idle' }
  work.busy = null
  work.error = null
  for (const fn of [work.move, work.release, work.load, work.keep, work.freeze, work.start])
    fn.mockClear()
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
    expect(screen.getByTestId('scenario-draft')).toHaveTextContent(
      'from B: bands $5,000 wider · Round 1 % −5 pts'
    )
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
})
