import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import type { ApiAidRulesDraft } from '../../../types/api-types'
import { EditPlan } from './EditPlan'
import type { TypedPlan } from './planModel'
import { rulesDraft } from './rules/rulesFixtures'
import { SeasonChromeContext, type SeasonChrome } from './seasonChrome'

const save = vi.fn()
vi.mock('../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidSaveRulesSection: () => ({ mutate: save, isPending: false }),
}))

const POOLS = [
  { key: 'pool_a', label: 'Pool A' },
  { key: 'pool_b', label: 'Pool B' },
]
const OPENED = { total: '1000000', shares: { pool_a: '90', pool_b: '10' } }
const CHROME: SeasonChrome = {
  notice: null,
  setNotice: () => undefined,
  approving: false,
  canApprove: false,
  editing: false,
  setEditing: () => undefined,
  setApproveBusy: () => undefined,
  openApprove: () => undefined,
  closeApprove: () => undefined,
  section: 'budget',
  done: false,
  locked: false,
  unreadable: null,
  unlocked: null,
  unlocking: false,
  openUnlock: () => undefined,
  closeUnlock: () => undefined,
  unlock: () => undefined,
  lockAgain: () => undefined,
  pastSeasonReason: null,
  relocks: 0,
}
type SectionStatus = ApiAidRulesDraft['sections'][number]['status']

/** rulesDraft() with the two-pool budget, and its budget section row in `state` with the fingerprint a save sends. */
function draftWithBudget(state: 'draft' | 'locked' = 'draft'): ApiAidRulesDraft {
  const d = rulesDraft()
  const status: SectionStatus =
    state === 'locked'
      ? {
          state,
          approved_by: 'Test User',
          approved_at: '2027-01-20T18:00:00Z',
          locked_at: '2027-03-09T18:00:00Z',
        }
      : { state, edited_by: 'Test User', edited_at: '2027-01-21T17:00:00Z' }
  return {
    ...d,
    document: {
      ...d.document,
      budget: {
        total: '1000000',
        pools: {
          pool_a: { label: 'Pool A', share_pct: '90' },
          pool_b: { label: 'Pool B', share_pct: '10' },
        },
      },
    },
    sections: d.sections.map((s) =>
      s.section === 'budget' ? { ...s, status, fingerprint: 'fp-budget', changes: [] } : s
    ),
  }
}

/** The server's 409 for a section that moved since it was read. */
const conflict = () => new AidWriteError('The rules draft changed', 409)

function Harness({
  onClose = vi.fn(),
  setNotice = vi.fn(),
  setEditing = vi.fn(),
  draft = draftWithBudget(),
  inEffectTotal,
}: {
  inEffectTotal?: number | null
  setEditing?: (on: boolean) => void
  onClose?: () => void
  setNotice?: (text: string | null) => void
  draft?: ApiAidRulesDraft
}) {
  const [typed, setTyped] = useState<TypedPlan>(OPENED)
  return (
    <SeasonChromeContext.Provider value={{ ...CHROME, setNotice, setEditing }}>
      <EditPlan
        draft={draft}
        pools={POOLS}
        opened={OPENED}
        typed={typed}
        shareNote={11}
        inEffectTotal={inEffectTotal ?? null}
        onType={setTyped}
        onClose={onClose}
      />
    </SeasonChromeContext.Provider>
  )
}

describe('Edit Plan… as an editor (design-language §24)', () => {
  it('puts every pool share in the ONE "Program split" field, so no share sits under Total', () => {
    render(<Harness />)
    const grid = screen.getByTestId('aid-editor-grid')
    expect(within(grid).getAllByText(/^Program split/)).toHaveLength(1)
    const holder = within(grid).getByText(/^Program split/).nextElementSibling as HTMLElement
    expect(within(holder).getByLabelText('Pool A')).toBeInTheDocument()
    expect(within(holder).getByLabelText('Pool B')).toBeInTheDocument()
    expect(within(holder).queryByLabelText('Total')).toBeNull()
  })

  it('lays Total and the pool shares in the two-column field grid, the split words beside them', () => {
    render(<Harness />)
    const grid = screen.getByTestId('aid-editor-grid')
    expect(within(grid).getByLabelText('Total')).toBeInTheDocument()
    expect(within(grid).getByLabelText('Pool A')).toBeInTheDocument()
    expect(within(grid).getByLabelText('Pool B')).toBeInTheDocument()
    const form = screen.getByTestId('aid-editor-form')
    expect(
      within(form).getByText('sums to 100% · Pool A $900,000 · Pool B $100,000')
    ).toBeInTheDocument()
  })

  it('puts the buttons, Esc and the reason on ONE row, Title Case', () => {
    render(<Harness />)
    const save = screen.getByRole('button', { name: 'Save to Rules Draft' })
    const row = save.parentElement as HTMLElement
    expect(row).toHaveClass('flex-nowrap')
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(row).getByText('Esc cancels')).toBeInTheDocument()
    expect(within(row).getByText('No change yet')).toBeInTheDocument()
  })
})

describe('Edit Plan… editor as the final design draws it (rounds-12; §24)', () => {
  it('is a titled panel: "Edit Plan · the rules draft\'s budget section"', () => {
    render(<Harness />)
    expect(screen.getByText("Edit Plan · the rules draft's budget section")).toBeInTheDocument()
  })

  it("titles the panel in the kit's panel-head grammar: 11px, 700, uppercase, muted (mock .cf-phead)", () => {
    render(<Harness />)
    const head = screen.getByText("Edit Plan · the rules draft's budget section")
    expect(head).toHaveClass('uppercase', 'text-[11px]', 'font-bold', 'text-muted-foreground')
  })

  it('sets the split line as a result: 600, in the ok ink (mock .cf-res)', () => {
    render(<Harness />)
    const line = screen.getByText('sums to 100% · Pool A $900,000 · Pool B $100,000')
    expect(line).toHaveClass('font-semibold', 'text-forest-800')
  })

  it('lays Total and Program split in the two-column grid, label then field', () => {
    render(<Harness />)
    const grid = screen.getByTestId('aid-editor-grid')
    expect(grid).toHaveClass('grid-cols-[max-content_minmax(0,1fr)]')
    expect(grid).not.toHaveClass('grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]')
  })

  it('draws the three shares as ONE joined field, a divider between pools', () => {
    render(<Harness />)
    const field = screen.getByTestId('aid-split-field')
    expect(within(field).getByLabelText('Pool A')).toBeInTheDocument()
    expect(within(field).getByLabelText('Pool B')).toBeInTheDocument()
    expect(within(field).getAllByTestId('aid-split-divider')).toHaveLength(1)
  })

  it('keeps the split line on ONE line: truncated, with its whole words as the title', () => {
    render(<Harness />)
    const words = 'sums to 100% · Pool A $900,000 · Pool B $100,000'
    const line = screen.getByText(words)
    expect(line).toHaveClass('truncate')
    expect(line).toHaveAttribute('title', words)
  })

  it('ends the button row with "saving prices nothing until it\'s approved"', () => {
    render(<Harness />)
    const row = screen.getByRole('button', { name: 'Save to Rules Draft' })
      .parentElement as HTMLElement
    expect(within(row).getByText("saving prices nothing until it's approved")).toBeInTheDocument()
  })
})

describe('Edit Plan… (spec §5.2 B)', () => {
  it('shows Total $, Program split with a box per pool, the split words and No change yet', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Total')).toHaveValue('1000000')
    expect(screen.getByLabelText('Pool A')).toHaveValue('90')
    expect(screen.getByText('sums to 100% · Pool A $900,000 · Pool B $100,000')).toBeInTheDocument()
    expect(screen.getByText('No change yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save to Rules Draft' })).toBeDisabled()
  })

  it('says which draft is open and what is in effect when the draft differs from it', () => {
    const draft = draftWithBudget()
    render(<Harness draft={draft} inEffectTotal={1111000} />)
    expect(
      screen.getByText(`Draft v${String(draft.version)} · in effect $1,111,000`)
    ).toBeInTheDocument()
    expect(screen.queryByText('No change yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save to Rules Draft' })).toBeDisabled()
  })

  it('keeps "No change yet" when the draft equals what is in effect', () => {
    render(<Harness inEffectTotal={1000000} />)
    expect(screen.getByText('No change yet')).toBeInTheDocument()
  })

  it('holds Save while the shares miss 100%', async () => {
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Pool B'))
    await userEvent.type(screen.getByLabelText('Pool B'), '9')
    expect(screen.getByText('Shares sum to 99%, not 100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save to Rules Draft' })).toBeDisabled()
  })

  it('saves {total, pools} with base_version and the fingerprint, and closes with no notice to dismiss', async () => {
    const onClose = vi.fn()
    const setNotice = vi.fn()
    save.mockImplementation((_vars, { onSuccess }) =>
      onSuccess({ ...draftWithBudget(), version: 5 })
    )
    render(<Harness onClose={onClose} setNotice={setNotice} />)
    await userEvent.clear(screen.getByLabelText('Pool A'))
    await userEvent.type(screen.getByLabelText('Pool A'), '89')
    await userEvent.clear(screen.getByLabelText('Pool B'))
    await userEvent.type(screen.getByLabelText('Pool B'), '11')
    await userEvent.click(screen.getByRole('button', { name: 'Save to Rules Draft' }))
    expect(save.mock.calls[0]![0]).toEqual({
      section: 'budget',
      body: {
        base_version: draftWithBudget().version,
        content: {
          total: '1000000',
          pools: {
            pool_a: { label: 'Pool A', share_pct: '89' },
            pool_b: { label: 'Pool B', share_pct: '11' },
          },
        },
        expected_fingerprint: 'fp-budget',
      },
    })
    expect(onClose).toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved to the rules draft/))
  })

  it("keeps the typing on a 409, in the editor's words", async () => {
    save.mockImplementation((_vars, { onError }) => onError(conflict()))
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Total'))
    await userEvent.type(screen.getByLabelText('Total'), '1010000')
    await userEvent.click(screen.getByRole('button', { name: 'Save to Rules Draft' }))
    expect(
      screen.getByText(
        /Someone else changed the rules draft since you opened this section\. Nothing was saved; your typing is kept\./
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Total')).toHaveValue('1010000')
  })

  it('Esc or Cancel closes and drops the typing', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // Owner 10-06 (b): "budget does lock but only the total dollar number." The shares stay editable all season.
  it('once the budget is approved, shows Total read-only with the lock mark and words, and still saves the shares', async () => {
    save.mockReset()
    render(<Harness draft={{ ...draftWithBudget('locked'), budget_total_locked: true }} />)
    const total = screen.getByLabelText('Total')
    expect(total).toHaveAttribute('readonly')
    await userEvent.type(total, '5')
    expect(total).toHaveValue('$1,000,000')
    expect(screen.getByLabelText('Total locked')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Locked: the first approved budget total stands all season. The program shares still edit.'
      )
    ).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Pool A'))
    await userEvent.type(screen.getByLabelText('Pool A'), '89')
    await userEvent.clear(screen.getByLabelText('Pool B'))
    await userEvent.type(screen.getByLabelText('Pool B'), '11')
    await userEvent.click(screen.getByRole('button', { name: 'Save to Rules Draft' }))
    expect(save.mock.calls[0]![0].body.content).toEqual({
      total: '1000000',
      pools: {
        pool_a: { label: 'Pool A', share_pct: '89' },
        pool_b: { label: 'Pool B', share_pct: '11' },
      },
    })
  })

  it("keeps Total read-only after a shares save put the budget back in draft: the server's flag decides, not the section's state", () => {
    render(<Harness draft={{ ...draftWithBudget('draft'), budget_total_locked: true }} />)
    expect(screen.getByLabelText('Total')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Total locked')).toBeInTheDocument()
  })

  it('leaves Total editable, with no lock mark or words, before any round posts', () => {
    render(<Harness draft={draftWithBudget()} />)
    expect(screen.getByLabelText('Total')).not.toHaveAttribute('readonly')
    expect(screen.queryByLabelText('Total locked')).toBeNull()
    expect(screen.queryByText(/^Locked: the first approved budget/)).toBeNull()
  })

  // Slice 2: Approve… showed only when nothing was being edited. The plan's typing is unsaved text Approve must not
  // approve around, so the chrome hides Approve… for as long as this editor is open.
  it('tells the Season chrome it is editing while open, and clears that when it closes', () => {
    const setEditing = vi.fn()
    const view = render(<Harness setEditing={setEditing} />)
    expect(setEditing).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(setEditing).toHaveBeenLastCalledWith(false)
  })
})
