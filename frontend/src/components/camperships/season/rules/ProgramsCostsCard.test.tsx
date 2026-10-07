import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidValidationIssue } from '../../../../types/api-types'
import { ProgramsCostsCard, combinedStatus, type ProgramsCostsCardProps } from './ProgramsCostsCard'
import { CATALOG, GROUPS, pcDoc } from './programsCostsFixtures'
import type { ProgramsCostsDoc } from './programsCostsModel'
import type { StatusWords } from './rulesModel'

// jsdom measures every height as 0: the flow is mocked to one column, as Task 10.3's last test pins for the real cut.
vi.mock('./useFlowColumns', () => ({
  useFlowColumns: () => ({
    ref: { current: null },
    cut: (heights: number[]) => [heights.map((_, index) => ({ index, continued: false }))],
  }),
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

  it('says the per-person formula with the infant age not set', () => {
    render(<ProgramsCostsCard {...props()} />)
    expect(screen.getByText(/everyone but infants pays the standard rate/)).toHaveTextContent(
      'infant age not set'
    )
  })

  it('lists the draft’s changes since the version in effect, and none for the registrar', () => {
    const draft = pcDoc()
    draft.cost.tuition = { ...draft.cost.tuition, '1000101': '6895' }
    const { rerender } = render(<ProgramsCostsCard {...props({ draftDoc: draft })} />)
    expect(screen.getByText(/Changed since v3:/)).toHaveTextContent('Session 2: $6,695 → $6,895')
    rerender(<ProgramsCostsCard {...props({ draftDoc: draft, approved: null })} />)
    expect(screen.queryByText(/Changed since/)).toBeNull()
  })

  it('combines the two sections’ statuses: Draft beats In effect beats Locked', () => {
    const words = (pill: string): StatusWords => ({ pill, tone: 'muted', meta: '', note: null })
    expect(combinedStatus(words('In effect'), words('Draft · 2 changes')).pill).toBe(
      'Draft · 2 changes'
    )
    expect(combinedStatus(words('Locked'), words('In effect')).pill).toBe('In effect')
  })
})
