import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_SAMUEL } from '../requests/gridFixtures'
import { householdPage, householdRequest, receiptOut, SPLIT_PAGE } from './householdFixtures'
import { RequestCard } from './RequestCard'

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const PAGE = householdPage()

function renderCard(request = PAGE.requests[0]!, page = PAGE) {
  return render(
    <MemoryRouter>
      <RequestCard request={request} page={page} view={VIEW} />
    </MemoryRouter>
  )
}

describe('RequestCard (§6.3 item 4; D50; decision-panel.html)', () => {
  it('heads the card with the camper, session, person id, stage and cost', () => {
    renderCard()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('· Session 2 · person 1000002')).toBeInTheDocument()
    expect(screen.getByText('R1 · Needs an offer')).toBeInTheDocument()
    expect(screen.getByText('$6,760')).toBeInTheDocument()
  })

  it('folds the receipt under its sentence (D34), and opens it by itself on a hold', () => {
    const { unmount } = renderCard()
    expect(screen.getByRole('button', { name: /^Show the receipt/ })).toBeInTheDocument()
    unmount()
    renderCard(
      householdRequest({
        ...ROW_EMMA,
        holds: [{ code: 'manual_hold', severity: 'hold', message: 'Waiting on a call' }],
      })
    )
    expect(screen.getByRole('button', { name: 'Hide the receipt ▴' })).toBeInTheDocument()
  })

  it("shows each round's award, state, lock and ticks", () => {
    renderCard(PAGE.requests[1])
    const panel = screen.getByRole('table', { name: 'Decision panel' })
    expect(within(panel).getByText('Posted')).toBeInTheDocument()
    expect(within(panel).getByText('locked Mar 9 · Test User')).toBeInTheDocument()
    expect(within(panel).getByText('☑ Posted Mar 9')).toBeInTheDocument()
    expect(within(panel).getByText('☐ Accepted')).toBeInTheDocument()
  })

  it('flags a locked round that rules now would change, and says the posted amount stands (D43; owner S1 Q1)', () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', {
          decided: 1420,
          posted: 1420,
          posted_on: '2027-03-09',
          would_change_by: 67,
        }),
      ],
    })
    renderCard(householdRequest(row))
    expect(screen.getByText('would change by $67')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Today's rules would change Round 1 by $67. The posted $1,420 stands; this is information only."
      )
    ).toBeInTheDocument()
  })

  it('never implies a posted amount drops when rules would lower it (owner ruling S1 Q1)', () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', {
          decided: 1420,
          posted: 1420,
          posted_on: '2027-03-09',
          would_change_by: -40,
        }),
      ],
    })
    renderCard(householdRequest(row))
    expect(
      screen.getByText(
        "Today's rules would lower Round 1 by $40. The posted $1,420 stands; nothing is clawed back."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/would change by/)).toBeNull()
    expect(screen.getByText('rules now $40 lower · posted stands')).toBeInTheDocument()
  })

  it("draws a pending Round 3 the grid's way, outside the total, and names each line's basis", () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', { ask: 2000, decided: 1420, posted: 1420, posted_on: '2027-03-09' }),
        roundOut(3, 'pending_approval', {
          ask: 900,
          asked_on: '2027-05-01',
          pending_approval: 450,
        }),
      ],
      total_decided: 1420,
    })
    renderCard(householdRequest(row))
    const panel = screen.getByRole('table', { name: 'Decision panel' })
    expect(within(panel).getByText('pending $450')).toBeInTheDocument()
    expect(within(panel).getAllByText('$1,420')).toHaveLength(2)
    expect(within(panel).getByText('posted')).toBeInTheDocument()
    expect(
      within(panel).getByText(
        'Total of the posted and decided amounts; a pending amount waits on finance'
      )
    ).toBeInTheDocument()
  })

  it("notes each round's ask and the day it came (I6; decision-panel.html)", () => {
    renderCard(householdRequest(ROW_OLIVIA))
    expect(screen.getByText('ask $1,200 · Apr 9')).toBeInTheDocument()
  })

  it('shows one money line for one payer, with the confirmation beside Posted (D59)', () => {
    renderCard(PAGE.requests[1])
    expect(screen.getByText('CampMinder shows $1,590')).toBeInTheDocument()
    expect(screen.getByText('short $210')).toBeInTheDocument()
  })

  it('shows a share table for several payers, each with its own confirmation (D81)', () => {
    const request = householdRequest(ROW_SAMUEL, {
      shares: [
        {
          household_cm_id: 1000001,
          chip: 1,
          share_pct: 60,
          decided: 1080,
          posted: 1080,
          in_campminder: 1080,
          status: 'confirmed',
        },
        {
          household_cm_id: 1000003,
          chip: 2,
          share_pct: 40,
          decided: 720,
          posted: 720,
          in_campminder: 0,
          status: 'not_in_campminder',
        },
      ],
    })
    renderCard(request, SPLIT_PAGE)
    const shares = screen.getByRole('table', { name: 'Payer shares' })
    expect(within(shares).getByText('2 · The Garcia Family')).toBeInTheDocument()
    expect(within(shares).getByText('40%')).toBeInTheDocument()
    expect(within(shares).getByText('not in CampMinder')).toBeInTheDocument()
    expect(within(shares).getByText(/confirmed/)).toBeInTheDocument()
  })

  it('names who applied when several households are on the page', () => {
    renderCard(SPLIT_PAGE.requests[0], SPLIT_PAGE)
    expect(screen.getByText('applied by')).toBeInTheDocument()
  })

  it('calls a 2026 receipt reproduced, never posted (M18)', () => {
    renderCard(
      householdRequest(ROW_EMMA, {
        receipts: [receiptOut(1, { kind: 'reproduced' }), receiptOut(2)],
      })
    )
    expect(
      screen.getByRole('button', { name: 'Round 1 as reproduced from the 2026 sheet ▾' })
    ).toBeInTheDocument()
  })

  it("opens an earlier round's receipt on click (Decision 35)", async () => {
    renderCard(
      householdRequest(ROW_EMMA, {
        receipts: [
          receiptOut(1, {
            kind: 'locked',
            locked_on: '2027-03-09',
            lock_source: 'tick',
            ticked_by_name: 'Test User',
          }),
          receiptOut(2),
        ],
      })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Round 1 as posted ▾' }))
    expect(screen.getByText(/locked Mar 9 by Test User's Posted tick/)).toBeInTheDocument()
  })

  it('says a cancelled request was cancelled, where, and why (D101)', () => {
    renderCard(
      householdRequest({
        ...ROW_EMMA,
        cancellation: { by: 'campminder', on: '2027-06-02', reason: null, note: '' },
      })
    )
    expect(
      screen.getByText('Cancelled in CampMinder Jun 2 · no reason given yet')
    ).toBeInTheDocument()
  })
})
