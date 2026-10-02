/**
 * Fit to budget, All settings and "Make it the rules draft" on screen (spec §7.4, §7.5; D39, D119).
 * The workspace and the draft's work are mocked; each test sets the fit's answer or the preview.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiveResults } from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidWriteError } from '../../../../services/camperships/aidApi'
import type {
  ApiAidPromotionPreview,
  ApiAidRulesDocumentIn,
  ApiAidScenarioFit,
} from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { NO_PENDING, type Pending } from './scenarioModel'
import { compareOut, results, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({
  useAidScenarios: () => ({ data: workspace(), isLoading: false, error: null }),
  useAidScenarioSensitivity: () => ({ data: { results: results(735000), levers: [] } }),
}))
vi.mock('../../../../hooks/camperships/useAidScenarioCompare', () => ({
  useAidScenarioCompare: () => ({
    data: compareOut(),
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
  useAidScenarioTrail: () => ({ data: undefined, isLoading: true, error: null }),
}))
type Build = (current: ApiAidRulesDocumentIn) => ApiAidRulesDocumentIn
const adopt = vi.fn<
  (label: string, build: Build, options?: { readonly basedOn?: string }) => Promise<boolean>
>(() => Promise.resolve(true))
let pending: Pending = NO_PENDING
let busy: string | null = null
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => ({
    pending,
    live: { status: 'idle' } as LiveResults,
    busy,
    error: null,
    nothingToFreeze: false,
    move: vi.fn(),
    release: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(() => Promise.resolve(true)),
    keep: vi.fn(() => Promise.resolve(true)),
    adopt,
    freeze: vi.fn(() => Promise.resolve(true)),
    start: vi.fn(() => Promise.resolve(true)),
  }),
}))
let fitAnswer: ApiAidScenarioFit | undefined
let preview: ApiAidPromotionPreview | undefined
const fitAsked: unknown[] = []
const promoted: unknown[] = []
let promoteRefusal: string | null = null
vi.mock('../../../../hooks/camperships/useAidPromotion', () => ({
  useAidScenarioFit: () => ({
    data: fitAnswer,
    error: null,
    isPending: false,
    mutate: (document: unknown) => fitAsked.push(document),
    reset: vi.fn(),
  }),
  useAidPromotionPreview: (code: string | null) => ({
    data: code === null ? undefined : preview,
    isLoading: false,
    error: null,
  }),
  useAidMakeRulesDraft: () => ({
    isPending: false,
    reset: vi.fn(),
    mutate: (
      vars: unknown,
      handlers: { onSuccess: (draft: { version: number }) => void; onError: (error: Error) => void }
    ) => {
      promoted.push(vars)
      if (promoteRefusal === null) handlers.onSuccess({ version: 5 })
      else handlers.onError(new AidWriteError(promoteRefusal, 409))
    },
  }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function renderAt(path = '/aid/season/scenarios') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScenariosTab />
    </MemoryRouter>
  )
}

const PREVIEW: ApiAidPromotionPreview = {
  code: 'A1',
  origin_version: 3,
  base_version: 4,
  sections: [
    {
      section: 'award_tables',
      changes: [
        { path: ['general', 'tiers', '2', 'r1_pct'], kind: 'changed', before: '55', after: '58' },
      ],
      warning: {
        kind: 'unapproved_edit',
        by: 'Test User',
        at: '2027-01-21T17:00:00Z',
        via: 'B2',
        token: 'tok-1',
      },
    },
  ],
  unchanged: ['income', 'tiers'],
}

const FITS: ApiAidScenarioFit = {
  tier_shift: -4.5,
  outcome: 'fits',
  tightest_pool: 'pool_b',
  tried: 11,
  document: { ...RULES_DOCUMENT, year: 2027 },
  results: results(800000),
  report: { issues: [] },
}

beforeEach(() => {
  fitAnswer = undefined
  preview = PREVIEW
  fitAsked.length = 0
  promoted.length = 0
  promoteRefusal = null
  pending = NO_PENDING
  busy = null
  adopt.mockClear()
})

describe('Fit to budget (D119)', () => {
  it('says the shift it found, and records the fitted document only on "Use it", on the trail row it was fitted on', async () => {
    // The mutation's answer is mocked as already there; the click is what asks (and notes the row).
    fitAnswer = FITS
    renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    expect(fitAsked).toEqual([workspace().draft?.document])
    expect(
      within(fit).getByText(/Shifting every tier −4.5 pts uses Round 1's allocation/)
    ).toBeInTheDocument()
    expect(within(fit).getByText(/Tightest pool: Pool B/)).toBeInTheDocument()
    expect(adopt).not.toHaveBeenCalled()
    await userEvent.click(within(fit).getByRole('button', { name: 'Use it' }))
    expect(adopt).toHaveBeenCalledTimes(1)
    const [label, build, options] = adopt.mock.calls[0]!
    expect(label).toBe('Recording…')
    expect(build(RULES_DOCUMENT)).toBe(FITS.document)
    expect(options).toEqual({ basedOn: 'trail0000000001' })
  })

  it("offers nothing to use when even the range's end doesn't fit", () => {
    fitAnswer = {
      tier_shift: -100,
      outcome: 'over_at_lowest',
      tightest_pool: null,
      tried: 1,
      document: RULES_DOCUMENT,
      results: results(900000),
      report: { issues: [] },
    }
    renderAt()
    expect(
      screen.getByText('Even the lowest shift (−100 pts) leaves Round 1 over its allocation.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull()
  })

  it('is held while a slider is moving: neither asking nor "Use it" goes through', async () => {
    fitAnswer = FITS
    const view = renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeEnabled()
    pending = { ...NO_PENDING, tierShift: -2 }
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(fit).getByRole('button', { name: /^Fit to budget/ })).toBeDisabled()
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeDisabled()
  })
})

describe('All settings (D39: one editor, two homes)', () => {
  async function typeMinimum() {
    renderAt()
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(all).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    return all
  }

  it('opens the same editor against the scenario draft, says it is not the rules, and records the draft', async () => {
    const all = await typeMinimum()
    expect(
      within(all).getByText(
        'Editing Minimum award and limits in your scenario draft (from B), not the rules'
      )
    ).toBeInTheDocument()
    await userEvent.click(within(all).getByRole('button', { name: 'Save' }))
    expect(adopt).toHaveBeenCalledTimes(1)
    const [label, build, options] = adopt.mock.calls[0]!
    expect(label).toBe('Recording…')
    expect(options).toBeUndefined()
    // The builder works on the draft as it is when the write runs, not as it was when the box opened.
    const other = { ...RULES_DOCUMENT, year: 2030 }
    expect(build(other)).toEqual({
      ...other,
      awards: { ...RULES_DOCUMENT.awards, minimum: '150' },
    })
  })

  it('holds Save while a slider is moving or a write runs', async () => {
    const all = await typeMinimum()
    expect(within(all).getByRole('button', { name: 'Save' })).toBeEnabled()
    pending = { ...NO_PENDING, tierShift: -2 }
    renderAt()
    const held = screen.getAllByTestId('all-settings')[1]!
    await userEvent.click(within(held).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(held).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    expect(within(held).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('Make it the rules draft (D39; Decision 21)', () => {
  it('lists each change, makes a replaced edit be confirmed, and sends its token', async () => {
    renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    const dialog = screen.getByTestId('promotion-preview')
    expect(
      within(dialog).getByText('General › Tiers › Tier 2 › Round 1 %: 55% → 58%')
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Unchanged: the other 2 sections.')).toBeInTheDocument()
    const make = screen.getByRole('button', { name: 'Make it the rules draft' })
    expect(make).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(make)
    expect(promoted[0]).toEqual({
      code: 'A1',
      body: { base_version: 4, acknowledged: { award_tables: 'tok-1' } },
    })
    expect(screen.getByTestId('promotion-done')).toHaveTextContent(
      "A1's changes are in the rules draft, v5."
    )
    expect(screen.getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027'
    )
    // Done closes it.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('promotion-done')).toBeNull()
  })

  it('has no promote control on the draft column', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    expect(screen.getAllByRole('button', { name: /the rules draft…$/ })).toHaveLength(1)
  })

  it('forgets a tick when it is closed and opened again', async () => {
    renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('promotion-preview')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
  })

  it('writes nothing on a 409, and a tick on a warning that changed since no longer counts', async () => {
    promoteRefusal = 'The rules draft is version 5 now, not 4: look at the changes again'
    const view = renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it the rules draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')

    // The rules write's invalidation refreshes the preview: the section was re-edited, so a new token.
    const section = PREVIEW.sections[0]!
    preview = {
      ...PREVIEW,
      base_version: 5,
      sections: [{ ...section, warning: { ...section.warning!, token: 'tok-2' } }],
    }
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios?compare=A1']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Make it the rules draft' })).toBeDisabled()
  })
})
