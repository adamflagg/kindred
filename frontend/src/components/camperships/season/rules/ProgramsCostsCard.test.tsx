import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDraft, ApiAidValidationIssue } from '../../../../types/api-types'
import { ProgramsCostsCard, combinedStatus, type ProgramsCostsCardProps } from './ProgramsCostsCard'
import { ProgramsCostsEditor } from './ProgramsCostsEditor'
import { CATALOG, GROUPS, pcDoc } from './programsCostsFixtures'
import type { ProgramsCostsDoc } from './programsCostsModel'
import { rulesDraft } from './rulesFixtures'
import type { StatusWords } from './rulesModel'

// jsdom measures every height as 0: the flow is mocked to one column, as Task 10.3's last test pins for the real cut.
vi.mock('./useFlowColumns', () => ({
  useFlowColumns: () => ({
    ref: { current: null },
    cut: (heights: number[]) => [heights.map((_, index) => ({ index, continued: false }))],
  }),
}))

const writes = vi.hoisted(() => ({ send: vi.fn(), fresh: vi.fn() }))
vi.mock('../../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidSaveRulesSections: () => ({ mutateAsync: writes.send, isPending: false }),
  useFreshAidRulesDraft: () => writes.fresh,
}))

const wrap = (d: ProgramsCostsDoc) => ({
  programs: d.programs,
  cost: d.cost,
  budget: { pools: d.pools },
})

interface Over extends Partial<ProgramsCostsCardProps> {
  draftDoc?: ProgramsCostsDoc
}

function props(over: Over = {}): ProgramsCostsCardProps {
  const { draftDoc, ...rest } = over
  return {
    document: wrap(draftDoc ?? pcDoc()),
    approved: wrap(pcDoc()),
    approvedVersion: 3,
    groups: GROUPS,
    sessions: CATALOG,
    cancelled: new Set<number>(),
    status: { pill: 'In effect', tone: 'emerald', meta: '', note: null },
    issues: [],
    canEdit: true,
    onEdit: vi.fn(),
    ...rest,
  }
}

describe('ProgramsCostsCard', () => {
  it('draws one card titled "Programs and costs" with its groups in pool order', () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(screen.getByRole('heading', { name: 'Programs and costs' })).toBeInTheDocument()
    expect(screen.getAllByTestId('pc-group-name').map((n) => n.textContent)).toEqual([
      'Camp',
      'Weekends',
      'School',
    ])
  })

  it('counts running sessions, not AG, and says the AG rule once', () => {
    render(<ProgramsCostsCard {...props()} />)
    const camp = screen.getByTestId('pc-group-camp_pool')
    expect(within(camp).getByText('· 5 running')).toBeInTheDocument()
    expect(
      within(camp).getByText("· 1 AG session uses its parent session's price")
    ).toBeInTheDocument()
  })

  it('labels sub-sections only in a mixed group, as SCIT', () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(within(screen.getByTestId('pc-group-camp_pool')).getByText('SCIT')).toBeInTheDocument()
    expect(within(screen.getByTestId('pc-group-weekend_pool')).queryByText('Other')).toBeNull()
  })

  it('shows whole dollars as stored, and "No price yet"', () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(within(screen.getByTestId('pc-row-1000101')).getByText('$6,695')).toBeInTheDocument()
    expect(within(screen.getByTestId('pc-row-1000202')).getAllByText('No price yet')).toHaveLength(
      2
    )
  })

  it('marks a minimum-only program and a lodging-board cancellation', () => {
    render(<ProgramsCostsCard {...props({ cancelled: new Set([1000202]) })} />)
    expect(
      within(screen.getByTestId('pc-row-1000401')).getByText('minimum only')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('pc-row-1000202')).getByText('cancelled on the lodging board')
    ).toBeInTheDocument()
  })

  it('folds Not running and Not open to aid, opening on a click', async () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(screen.queryByText('Quest: Rivers')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Not running \(1\)/ }))
    expect(screen.getByText('Quest: Rivers')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Not open to aid \(2\)/ }))
    expect(screen.getByText('Staff Week')).toBeInTheDocument()
  })

  it('says "newly" only on a session whose Not running flag changed, wherever it was drawn', async () => {
    const approved = pcDoc()
    approved.cost.not_running_session_cm_ids = [1000106, 1000901] // Staff Week: not open, and not running
    const draft = pcDoc()
    draft.cost.not_running_session_cm_ids = [1000106, 1000901, 1000104] // Starter Session newly
    draft.programs['summer']?.session_cm_ids?.push(1000901) // Staff Week moved into Camp, still not running
    if (draft.programs['not_aided']) draft.programs['not_aided'].session_cm_ids = []
    render(<ProgramsCostsCard {...props({ draftDoc: draft, approved: wrap(approved) })} />)
    await userEvent.click(screen.getByRole('button', { name: /Not running \(3\)/ }))
    expect(within(screen.getByTestId('pc-off-1000104')).getByText('newly')).toBeInTheDocument()
    expect(within(screen.getByTestId('pc-off-1000901')).queryByText('newly')).toBeNull()
    expect(within(screen.getByTestId('pc-off-1000106')).queryByText('newly')).toBeNull()
  })

  it('marks a session in no group red, with the line’s chip counting drawn rows only', async () => {
    const issues: ApiAidValidationIssue[] = [
      {
        section: 'programs',
        code: 'unmapped_session',
        severity: 'error',
        path: 'programs',
        message: 'New Session Nobody Placed is in no group, so it can’t get aid.',
        session_cm_ids: [1000902],
      },
      {
        section: 'programs',
        code: 'unmapped_session',
        severity: 'error',
        path: 'programs',
        message: 'AG Session 2 is in no group, so it can’t get aid.',
        session_cm_ids: [1000103],
      }, // an AG session: not drawn
    ]
    render(<ProgramsCostsCard {...props({ issues })} />)
    expect(screen.getByText('1 in no group')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Not open to aid/ }))
    expect(within(screen.getByTestId('pc-noopen-1000902')).getByText('in no group')).toHaveClass(
      /red/
    )
  })

  it('says, with no infant age set, that CampMinder’s billing decides who is an infant', () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(screen.getByText(/everyone but infants pays the standard rate/)).toHaveTextContent(
      'who counts as an infant: as CampMinder bills them'
    )
  })

  it('puts each changed price on its own line under the row, old → new, with no "was" and no Changed since line', () => {
    const draft = pcDoc()
    draft.cost.tuition = { ...draft.cost.tuition, '1000101': '6895' }
    draft.cost.family_rates = [
      ...(draft.cost.family_rates ?? []),
      { session_cm_id: 1000202, standard: '750', infant: '230' },
    ]
    render(<ProgramsCostsCard {...props({ draftDoc: draft })} />)
    const family = within(screen.getByTestId('pc-row-1000202')).getAllByTestId('pc-change')
    expect(family).toHaveLength(2)
    expect(family[0]).toHaveTextContent('Standard No price yet $750')
    expect(family[1]).toHaveTextContent('Infant No price yet $230')
    expect(within(screen.getByTestId('pc-row-1000101')).getByTestId('pc-change')).toHaveTextContent(
      '$6,695 $6,895'
    )
    expect(screen.queryByText(/^was /)).toBeNull()
    expect(screen.queryByTestId('changed-since')).toBeNull()
  })

  it('lists a group move or a Not running flip under Changed since, one per line, and none for the registrar', () => {
    const draft = pcDoc()
    draft.cost.tuition = { ...draft.cost.tuition, '1000101': '6895' }
    if (draft.programs['teen']) draft.programs['teen'].budget_pool = 'school_pool'
    draft.cost.not_running_session_cm_ids = [1000106, 1000104]
    const { rerender } = render(<ProgramsCostsCard {...props({ draftDoc: draft })} />)
    const since = screen.getByTestId('changed-since')
    expect(since).toHaveTextContent(/^Changed since v3:/)
    const lines = within(since).getAllByRole('listitem')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('Winter Retreat: Camp School')
    expect(lines[1]).toHaveTextContent('Starter Session: not running')
    rerender(<ProgramsCostsCard {...props({ draftDoc: draft, approved: null })} />)
    expect(screen.queryByTestId('changed-since')).toBeNull()
    expect(screen.queryByTestId('pc-change')).toBeNull()
  })

  it('combines the two sections’ statuses: Draft beats In effect beats Locked', () => {
    const words = (pill: string): StatusWords => ({ pill, tone: 'muted', meta: '', note: null })
    expect(combinedStatus(words('In effect'), words('Draft · 2 changes')).pill).toBe(
      'Draft · 2 changes'
    )
    expect(combinedStatus(words('Locked'), words('In effect')).pill).toBe('In effect')
  })

  it('on a tie, keeps the words of the section with the newer stamp (spec §5.2 B)', () => {
    const words = (meta: string): StatusWords => ({
      pill: 'In effect',
      tone: 'emerald',
      meta,
      note: null,
    })
    const older = '2027-01-20T18:00:00Z'
    const newer = '2027-01-22T18:00:00Z'
    expect(
      combinedStatus(words('programs'), words('cost'), { programs: older, cost: newer }).meta
    ).toBe('cost')
    expect(
      combinedStatus(words('programs'), words('cost'), { programs: newer, cost: older }).meta
    ).toBe('programs')
    expect(combinedStatus(words('programs'), words('cost')).meta).toBe('programs') // no stamps: the first's
  })

  it('does not say "typed on the request": no program prices that way', () => {
    const doc = pcDoc()
    doc.programs['summer']!.cost_source = 'typed'
    render(<ProgramsCostsCard {...props({ draftDoc: doc })} />)
    expect(screen.queryAllByText(/typed on the request/)).toHaveLength(0)
  })
})

/** The rules draft as the editor opens on it: the fixture's programs and cost, each with a fingerprint. */
function editDraft(): ApiAidRulesDraft {
  const base = rulesDraft()
  const d = pcDoc()
  return {
    ...base,
    document: {
      ...base.document,
      programs: d.programs,
      cost: d.cost,
      budget: { ...base.document.budget, pools: d.pools },
    },
    sections: base.sections.map((sec) =>
      sec.section === 'programs' || sec.section === 'cost'
        ? { ...sec, fingerprint: `fp-${sec.section}` }
        : sec
    ),
  }
}

function mockSave() {
  writes.send.mockReset().mockResolvedValue(editDraft())
  writes.fresh.mockReset().mockImplementation(() => Promise.resolve(editDraft()))
  return writes.send
}

function renderEditor(over: { cancelled?: ReadonlySet<number>; onDone?: () => void } = {}) {
  const editor = (
    <ProgramsCostsEditor
      draft={editDraft()}
      groups={GROUPS}
      sessions={CATALOG}
      cancelled={over.cancelled ?? new Set<number>()}
      onDone={over.onDone ?? vi.fn()}
    />
  )
  return render(<ProgramsCostsCard {...props({ editor })} />)
}

describe('ProgramsCostsEditor', () => {
  it('lists every session, never pre-checks Not running, and offers only reachable groups', () => {
    mockSave()
    renderEditor({ cancelled: new Set([1000202]) })
    expect(
      screen
        .getAllByRole('checkbox', { checked: true })
        .map((c) => c.closest('[data-testid]')?.getAttribute('data-testid'))
    ).toEqual(['pc-row-1000106']) // the stored list only: the lodging board's flag is a tag, not a check
    const group = within(screen.getByTestId('pc-row-1000202')).getByRole('combobox')
    expect(
      within(group).getByRole('option', { name: 'School (no program prices this kind here)' })
    ).toBeDisabled()
  })

  it('keeps Save off until something is typed, then sends only the section it changed, with its fingerprint', async () => {
    const send = mockSave()
    renderEditor()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(
      within(screen.getByTestId('pc-row-1000202')).getByLabelText('Standard'),
      '450'
    )
    await userEvent.type(within(screen.getByTestId('pc-row-1000202')).getByLabelText('Infant'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        base_version: 4,
        expected_fingerprints: { cost: 'fp-cost' }, // prices only: programs keeps its approval (Review Focus 8)
        contents: {
          cost: expect.objectContaining({
            family_rates: expect.arrayContaining([
              { session_cm_id: 1000202, standard: '450', infant: '0' },
            ]),
          }),
        },
      })
    )
  })

  it('sends both sections, with both fingerprints, when a group and a price change together', async () => {
    const send = mockSave()
    renderEditor()
    await userEvent.selectOptions(
      within(screen.getByTestId('pc-row-1000110')).getByRole('combobox'),
      'Not open to aid'
    )
    const tuition = within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')
    await userEvent.clear(tuition)
    await userEvent.type(tuition, '6895')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          expected_fingerprints: { programs: 'fp-programs', cost: 'fp-cost' },
          contents: { programs: expect.any(Object), cost: expect.any(Object) },
        })
      )
    )
  })

  it('shows the fix line and marks the box when a per-person pair is half typed', async () => {
    mockSave()
    renderEditor()
    await userEvent.type(
      within(screen.getByTestId('pc-row-1000202')).getByLabelText('Standard'),
      '450'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      screen.getByText(/A per-person price needs both Standard and Infant/)
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('pc-row-1000202')).getByLabelText('Infant')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })

  it('marks a typed box amber with no "was" beside it, and no "read-only" on the formula', async () => {
    mockSave()
    renderEditor()
    const row = screen.getByTestId('pc-row-1000202')
    await userEvent.type(within(row).getByLabelText('Standard'), '750')
    await userEvent.type(within(row).getByLabelText('Infant'), '230')
    expect(within(row).getByLabelText('Standard')).toHaveClass('border-amber-500')
    expect(within(row).queryByText(/^was /)).toBeNull()
    expect(screen.queryByText('read-only')).toBeNull()
  })

  it('disables a checked row’s boxes', async () => {
    mockSave()
    renderEditor()
    await userEvent.click(within(screen.getByTestId('pc-row-1000101')).getByRole('checkbox'))
    expect(within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')).toBeDisabled()
  })

  it('refuses, and keeps the typing, when the cost section changed since the editor opened', async () => {
    const send = mockSave()
    const theirs = editDraft()
    theirs.sections = theirs.sections.map((sec) =>
      sec.section === 'cost' ? { ...sec, fingerprint: 'fp-cost-theirs' } : sec
    )
    writes.fresh.mockImplementation(() => Promise.resolve(theirs))
    renderEditor()
    const box = within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')
    await userEvent.clear(box)
    await userEvent.type(box, '6895')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Someone else changed Programs and costs/)).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
    expect(box).toHaveValue('6895')
  })

  it('still refuses on a second Save after the refusal, though the cache now holds their draft', async () => {
    const send = mockSave()
    const theirs = editDraft()
    theirs.sections = theirs.sections.map((sec) =>
      sec.section === 'cost' ? { ...sec, fingerprint: 'fp-cost-theirs' } : sec
    )
    writes.fresh.mockImplementation(() => Promise.resolve(theirs))
    const editor = (draft: ApiAidRulesDraft) => (
      <ProgramsCostsEditor
        draft={draft}
        groups={GROUPS}
        sessions={CATALOG}
        cancelled={new Set<number>()}
        onDone={vi.fn()}
      />
    )
    const { rerender } = render(<ProgramsCostsCard {...props({ editor: editor(editDraft()) })} />)
    const box = within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')
    await userEvent.clear(box)
    await userEvent.type(box, '6895')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Someone else changed Programs and costs/)
    // fetchFresh() wrote their draft into the cache the card reads: the prop is now theirs.
    rerender(<ProgramsCostsCard {...props({ editor: editor(theirs) })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Someone else changed Programs and costs/)).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing, and just closes, when the typing leaves every stored value as it was', async () => {
    const send = mockSave()
    const onDone = vi.fn()
    renderEditor({ onDone })
    const box = within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')
    await userEvent.clear(box)
    await userEvent.type(box, '6,695.0') // the stored value, typed a different way
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null))
    expect(send).not.toHaveBeenCalled()
  })

  it('shows a stored 6695.0 as 6,695 and 6695.50 as 6,695.50 in the box', () => {
    mockSave()
    const draft = editDraft()
    draft.document.cost = {
      ...draft.document.cost,
      tuition: { ...draft.document.cost.tuition, '1000102': '6695.50' },
    }
    render(
      <ProgramsCostsCard
        {...props({
          editor: (
            <ProgramsCostsEditor
              draft={draft}
              groups={GROUPS}
              sessions={CATALOG}
              cancelled={new Set<number>()}
              onDone={vi.fn()}
            />
          ),
        })}
      />
    )
    expect(within(screen.getByTestId('pc-row-1000101')).getByLabelText('Tuition')).toHaveValue(
      '6,695'
    )
    expect(within(screen.getByTestId('pc-row-1000102')).getByLabelText('Tuition')).toHaveValue(
      '6,695.50'
    )
  })

  it('Esc cancels', async () => {
    mockSave()
    const onDone = vi.fn()
    renderEditor({ onDone })
    await userEvent.keyboard('{Escape}')
    expect(onDone).toHaveBeenCalledWith(null)
  })
})
