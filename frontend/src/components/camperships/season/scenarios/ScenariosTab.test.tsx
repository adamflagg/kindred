/**
 * Season › Scenarios on screen (Scenarios addendum §S4–§S5): the workspace, the draft's work, the pricing and the
 * compare are mocked; each model and component has its own tests. Fictional only.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { useAidScenarioDraft } from '../../../../hooks/camperships/useAidScenarioDraft'
import {
  AidApiError,
  type AidRequestSet,
  type CompareQuery,
} from '../../../../services/camperships/aidApi'
import type {
  ApiAidRulesDocumentIn,
  ApiAidScenarioResults,
  ApiAidScenarioWorkspace,
} from '../../../../types/api-types'
import { compareOut, results, scenarioDraft, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

let read: { data: ApiAidScenarioWorkspace | undefined; isLoading: boolean; error: Error | null }
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({ useAidScenarios: () => read }))

const work = {
  edits: new Map<string, string>() as ReadonlyMap<string, string>,
  pricedDocument: scenarioDraft().document,
  busy: null as string | null,
  error: null as string | null,
  nothingNew: false as boolean,
  type: vi.fn<(key: string, raw: string) => void>(),
  release: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  load: vi.fn<
    (
      from: { option: string } | { start: 'rules' | 'rules_draft' | 'last_rules' }
    ) => Promise<boolean>
  >(() => Promise.resolve(true)),
  discard: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  keep: vi.fn<(name: string) => Promise<string | null>>(() => Promise.resolve('C')),
  update: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  adopt: vi.fn<(document: ApiAidRulesDocumentIn, basedOn: string | null) => Promise<boolean>>(() =>
    Promise.resolve(true)
  ),
} satisfies ReturnType<typeof useAidScenarioDraft>
let rerenderWork: () => void = () => undefined
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => {
    const [, bump] = useReducer((n: number) => n + 1, 0)
    rerenderWork = bump
    return work
  },
}))

const pricingCalls: Array<{ requestSet: AidRequestSet; snapshot: string | null }> = []
let pricing: {
  data?: { results: ApiAidScenarioResults }
  error: Error | null
  isPlaceholderData: boolean
  isFetching: boolean
}
vi.mock('../../../../hooks/camperships/useAidScenarioPricing', () => ({
  useAidScenarioPricing: (
    _document: unknown,
    requestSet: AidRequestSet,
    snapshot: string | null
  ) => {
    pricingCalls.push({ requestSet, snapshot })
    return pricing
  },
}))

const compareCalls: Array<{ query: CompareQuery; enabled: boolean | undefined }> = []
vi.mock('../../../../hooks/camperships/useAidScenarioCompare', () => ({
  useAidScenarioCompare: (query: CompareQuery, options: { enabled?: boolean } = {}) => {
    compareCalls.push({ query, enabled: options.enabled })
    return { data: compareOut(), isLoading: false, error: null, isPlaceholderData: false }
  },
}))

const rename = { mutate: vi.fn(), error: null }
vi.mock('../../../../hooks/camperships/useAidRenameOption', () => ({
  useAidRenameOption: () => rename,
}))
const fit = { mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false }
vi.mock('../../../../hooks/camperships/useAidPromotion', () => ({
  useAidScenarioFit: () => fit,
  useAidPromotionPreview: () => ({ data: undefined, isLoading: false, error: null }),
  useAidMakeRulesDraft: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}))
vi.mock('../../../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({ notes: [], numberOf: () => null, isPending: false, error: null }),
}))
vi.mock('../../../../hooks/camperships/useAidAsOf', () => ({
  useAidAsOf: () => ({ kind: 'live' }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let granted = true
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => granted }),
}))

let location = ''
function Where() {
  location = useLocation().search
  return null
}

function renderAt(search = '', ws: Partial<ApiAidScenarioWorkspace> = {}) {
  read = {
    data: workspace({ last_rules_version: 3, locked_sections: [], locked_by_round: null, ...ws }),
    isLoading: false,
    error: null,
  }
  render(
    <MemoryRouter initialEntries={[`/aid/season/scenarios${search}`]}>
      <ScenariosTab />
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = true
  pricingCalls.length = 0
  compareCalls.length = 0
  work.edits = new Map()
  work.error = null
  work.nothingNew = false
  for (const fn of [
    work.type,
    work.release,
    work.load,
    work.discard,
    work.keep,
    work.update,
    rename.mutate,
    fit.mutate,
  ])
    fn.mockClear()
  pricing = {
    data: { results: results(735000, { allocated: 1000000 }) },
    error: null,
    isPlaceholderData: false,
    isFetching: false,
  }
})

describe('the control line (§S5 A)', () => {
  it('says the held pile, or that nothing is held yet, and updates it only on the button', async () => {
    renderAt()
    expect(screen.getByText('420 applications · as of Jan 12, 10:00 am')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Update Applications' }))
    expect(work.update).toHaveBeenCalledOnce()
  })

  it('says nothing new since the pile, after an update that found nothing', () => {
    work.nothingNew = true
    renderAt()
    expect(screen.getByText('Nothing new since Jan 12, 10:00 am')).toBeInTheDocument()
  })

  it('prices both the sandbox and Compare on Price ▾ (N6)', async () => {
    renderAt('?panel=compare')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'deadline')
    expect(location).toContain('through=deadline')
    expect(compareCalls.at(-1)?.query.requestSet).toEqual({ kind: 'deadline' })
    await userEvent.click(screen.getByRole('button', { name: 'Sandbox' }))
    expect(pricingCalls.at(-1)?.requestSet).toEqual({ kind: 'deadline' })
  })

  it('offers the rules draft in Start from only while it differs (§S15 item 4)', () => {
    renderAt('', { pricing_version: 4, rules_version: 5, rules_draft_version: 5 })
    expect(
      within(screen.getByRole('combobox', { name: 'Start from' })).getByRole('option', {
        name: 'Rules draft · v5',
      })
    ).toBeInTheDocument()
  })

  it('loads a chip at once with nothing unkept, and asks first with changes (§S5 C)', async () => {
    renderAt()
    await userEvent.click(screen.getByRole('button', { name: /^A rules draft v4 as they were$/ }))
    expect(work.load).toHaveBeenCalledWith({ option: 'A' })
    work.edits = new Map([['awards.minimum', '125']])
    rerenderWork()
    await userEvent.click(
      await screen.findByRole('button', { name: /^A rules draft v4 as they were$/ })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Drop and Load A' }))
    expect(work.load).toHaveBeenCalledTimes(2)
  })

  it('renames the loaded chip through the rename write', async () => {
    renderAt()
    await userEvent.click(screen.getByRole('button', { name: 'Rename B' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name of B' }), ' more{Enter}')
    expect(rename.mutate).toHaveBeenCalledWith({ code: 'B', name: 'bands $5,000 wider more' })
  })

  it('keeps with the draft’s label prefilled and what it prices now on the whole pile', async () => {
    work.edits = new Map([['awards.minimum', '125']])
    renderAt()
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    const pop = screen.getByTestId('keep-popover')
    expect(within(pop).getByRole('textbox', { name: 'Name' })).toHaveValue(scenarioDraft().label)
    // The recorded draft's results: Round 1 735,000 + Round 2 20,500 on 420 applications.
    expect(
      within(pop).getByText('with what it prices now: $755,500 on 420 applications')
    ).toBeInTheDocument()
    await userEvent.click(within(pop).getByRole('button', { name: 'Keep as C' }))
    expect(work.keep).toHaveBeenCalledWith(scenarioDraft().label)
  })

  it('shows a refusal as one amber line in the server’s words', () => {
    work.error =
      'Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.'
    renderAt()
    expect(screen.getByText(work.error)).toBeInTheDocument()
  })

  it('keeps Start from open after a refused load, so the way back is one choice away (disagreement 16)', () => {
    // A load of last season's rules is still refused when they don't fit; the tab stays open on the draft, and the
    // rules in effect are the first entry of Start from.
    work.error =
      "2026's criteria don't fit 2027's rules in effect (programs.teen.r1_table: no such table): start from the rules and edit instead"
    renderAt()
    expect(screen.getByText(work.error)).toBeInTheDocument()
    const start = screen.getByRole('combobox', { name: 'Start from' })
    expect(start).toBeEnabled()
    expect(within(start).getByRole('option', { name: 'Rules in effect · v3' })).toBeEnabled()
  })
})

describe('the sandbox (§S5 E–G)', () => {
  it('shows the strip and the three cards', () => {
    renderAt()
    expect(screen.getByTestId('spend-strip')).toBeInTheDocument()
    expect(screen.getByText('Tiers & Round 1')).toBeInTheDocument()
    expect(screen.getByText('Equity')).toBeInTheDocument()
    expect(screen.getByText('Income counting')).toBeInTheDocument()
  })

  it('a refused Price ▾ leaves the last figures and says the server’s words (Review Focus 5)', () => {
    // Priced through the deadline, so the draft's own stored results (priced on every application held) are no
    // fallback: only the last good read can keep 1,000,000 − 735,000 − 21,450 = $243,550 on the strip (plan review M6).
    renderAt('?through=deadline')
    expect(screen.getByText('$243,550')).toBeInTheDocument()
    pricing = {
      error: new AidApiError(
        "2027's approved rules set no application deadline (milestones): choose a received-through date",
        422
      ),
      isPlaceholderData: false,
      isFetching: false,
    }
    act(() => rerenderWork())
    expect(screen.getByText(/set no application deadline/)).toBeInTheDocument()
    expect(screen.getByText('$243,550')).toBeInTheDocument()
  })

  it('shows whole dollars across the strip when the server sends cents (coordinator ruling 2026-10-07)', () => {
    const fractional = results(735000.4, { allocated: 1000000 })
    pricing = {
      data: {
        results: {
          ...fractional,
          remaining: 243550.4,
          pools: [{ ...fractional.pools[0]!, remaining: 41495.66 }, fractional.pools[1]!],
        },
      },
      error: null,
      isPlaceholderData: false,
      isFetching: false,
    }
    renderAt()
    const strip = screen.getByTestId('spend-strip')
    expect(within(strip).getByText('$243,550')).toBeInTheDocument()
    expect(within(strip).getByText('$41,496')).toBeInTheDocument()
    expect(strip.textContent).not.toMatch(/\.\d/)
  })

  it('turns Fit off under Price ▾, with its reason', () => {
    renderAt('?through=deadline')
    expect(screen.getByRole('button', { name: 'Fit to Budget' })).toBeDisabled()
    expect(screen.getByText('Fit uses every application held')).toBeInTheDocument()
  })

  it('turns Fit off after Round 1 posts', () => {
    renderAt('', { locked_sections: ['award_tables'], locked_by_round: 1 })
    expect(screen.getByRole('button', { name: 'Fit to Budget' })).toBeDisabled()
    expect(screen.queryByText('Fit uses every application held')).toBeNull()
  })

  it('greys the locked cards with one note each', () => {
    renderAt('', {
      locked_sections: ['income', 'tiers', 'equity', 'award_tables', 'awards'],
      locked_by_round: 1,
    })
    expect(
      screen.getByText('Locked: Round 1 is posted · the Round 1 + 2 cap stays open')
    ).toBeInTheDocument()
    expect(screen.getAllByText('Locked: Round 1 is posted')).toHaveLength(2)
  })
})

describe('Compare (§S5 H) and the URL (§S5 L)', () => {
  it('opens on its default columns the first time, and asks for exactly them', () => {
    renderAt('?panel=compare')
    expect(compareCalls.at(-1)).toEqual({
      query: {
        codes: ['A', 'A1', 'B'],
        requestSet: { kind: 'all' },
        lastSeason: true,
        rules: true,
        lastRules: false,
        draft: false,
      },
      enabled: true,
    })
    expect(screen.getByTestId('compare-table')).toBeInTheDocument()
  })

  it('drops a kept code the year doesn’t hold, and says so once', () => {
    renderAt('?panel=compare&compare=A,Q')
    expect(
      screen.getByText("Q isn't kept in 2027, so it was left out of the compare.")
    ).toBeInTheDocument()
    expect(location).toContain('compare=A')
    expect(location).not.toContain('Q')
  })

  it('reads an old trail link as the sandbox and drops its params on the next write', async () => {
    renderAt('?panel=trail&trail_page=2')
    expect(screen.getByTestId('spend-strip')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'deadline')
    expect(location).not.toContain('trail_page')
    expect(location).not.toContain('panel=trail')
  })

  it('asks for the draft column only while the draft holds changes no kept option has (N11; plan review, minor 16)', () => {
    renderAt('?panel=compare&draft=1&compare=B')
    expect(compareCalls.at(-1)?.query.draft).toBe(true)
    cleanup()
    // Kept since: the draft is the same as B with nothing typed. Columns ▾ no longer lists "Your draft", so a
    // `draft=1` left in the URL must not ask for a column nobody can uncheck.
    renderAt('?panel=compare&draft=1&compare=B', { draft: scenarioDraft({ same_as: 'B' }) })
    expect(compareCalls.at(-1)?.query.draft).toBe(false)
  })

  it('adds a new keep to Compare’s columns while there is room (§S5 B; plan review M5)', async () => {
    work.edits = new Map([['awards.minimum', '125']])
    renderAt('?compare=B&rules=1') // the sandbox, with Compare's columns already chosen
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    await userEvent.click(
      within(screen.getByTestId('keep-popover')).getByRole('button', { name: 'Keep as C' })
    )
    await waitFor(() => expect(location).toContain('compare=B%2CC'))
    expect(location).toContain('rules=1')
  })

  it('never fetches the compare without the rules permission', () => {
    granted = false
    renderAt('?panel=compare')
    expect(compareCalls.every((call) => call.enabled === false)).toBe(true)
  })
})

describe('states (§S5 M)', () => {
  it('says why the tab can’t open for a season with no rules', () => {
    read = {
      data: undefined,
      isLoading: false,
      error: new AidApiError('No aid rules for 2028', 404),
    }
    render(
      <MemoryRouter>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(screen.getByText('No aid rules for 2028')).toBeInTheDocument()
  })

  it('says nothing is held yet before the first update, the strip says to update, and Keep… is off', () => {
    work.edits = new Map([['awards.minimum', '125']])
    renderAt('', { snapshot: null })
    expect(screen.getByText('No applications held yet')).toBeInTheDocument()
    expect(
      screen.getByText('Update Applications to price the applications held.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep…' })).toBeDisabled() // disagreement 17: nothing can be recorded yet
  })
})

describe('a refused Price ▾ read (CodeRabbit on #3047; lead #29 ruling 3)', () => {
  it('words By tier by what the kept figures were priced on after a refused deadline read (CodeRabbit; lead #29 ruling 3)', async () => {
    // Priced on every application held, then Price ▾ asks for the deadline and the server refuses (422): the strip
    // keeps the last good figures, and By tier names their set, never "received through  (the Round 1 deadline)".
    renderAt()
    pricing = {
      error: new AidApiError(
        "2027's approved rules set no application deadline (milestones): choose a received-through date",
        422
      ),
      isPlaceholderData: false,
      isFetching: false,
    }
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'deadline')
    await userEvent.click(screen.getByRole('button', { name: 'By tier ▸' }))
    expect(
      within(screen.getByTestId('tier-popover')).getByText('By tier · 420 applications held')
    ).toBeInTheDocument()
  })
})
