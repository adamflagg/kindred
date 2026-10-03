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

  // #2996: the card's stage is the server's (card.row is the grid's own row). A C1 round still reads
  // needs_offer in rounds[] until tonight's tick, but the server already calls the request posted.
  it("reads the server's stage on a C1 round, not the round's own status", () => {
    renderCard(
      householdRequest(
        gridRow({
          rounds: [roundOut(1, 'needs_offer', { decided: 1500, cm_pending: true })],
          stage: { round: 1, code: 'posted', label: 'R1 · Posted' },
        })
      )
    )
    expect(screen.getByText('R1 · Posted')).toBeInTheDocument()
    expect(screen.queryByText('R1 · Needs an offer')).toBeNull()
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

  it("shows each round's amount, state, lock and ticks", () => {
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
    expect(within(shares).getByText('Missing in CM')).toBeInTheDocument()
    expect(within(shares).getByText(/confirmed/)).toBeInTheDocument()
  })

  it('names who applied when several households are on the page', () => {
    renderCard(SPLIT_PAGE.requests[0], SPLIT_PAGE)
    expect(screen.getByText('applied by')).toBeInTheDocument()
  })

  it('calls a 2026 receipt reproduced, never posted (M18)', () => {
    renderCard(
      householdRequest(ROW_EMMA, {
        receipts: [receiptOut(1, { kind: 'reproduced', season: 2026 }), receiptOut(2)],
      })
    )
    expect(
      screen.getByRole('button', { name: 'Round 1 as reproduced from the 2026 sheet ▾' })
    ).toBeInTheDocument()
  })

  it("names the receipt's own season, never a hardcoded year (M5)", () => {
    renderCard(
      householdRequest(ROW_EMMA, {
        receipts: [receiptOut(1, { kind: 'reproduced', season: 2025 }), receiptOut(2)],
      })
    )
    expect(
      screen.getByRole('button', { name: 'Round 1 as reproduced from the 2025 sheet ▾' })
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

  describe('fix round 1 (review of Task 20)', () => {
    const SHARE = {
      household_cm_id: 1000001,
      chip: 1,
      share_pct: 100,
      decided: 1800,
      posted: 1800,
      in_campminder: 1590,
      status: 'short',
    } as const

    it('reads a clawed-back round as reversed, never as posted money that stands (I1; D54)', () => {
      const row = gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1420,
            posted: 1420,
            posted_on: '2027-03-09',
            would_change_by: -40,
            clawed_back: true,
          }),
        ],
      })
      renderCard(householdRequest(row))
      const panel = screen.getByRole('table', { name: 'Decision panel' })
      expect(within(panel).getByText('reversed')).toBeInTheDocument()
      expect(within(panel).queryByText('posted')).toBeNull()
      expect(screen.queryByText(/stands/)).toBeNull()
      expect(screen.queryByText(/clawed back/)).toBeNull()
      expect(screen.queryByText(/rules now/)).toBeNull()
    })

    it('keeps the posted-stands wording on a round that was not reversed (I1 regression guard)', () => {
      const row = gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1420,
            posted: 1420,
            posted_on: '2027-03-09',
            would_change_by: -40,
            clawed_back: false,
          }),
        ],
      })
      renderCard(householdRequest(row))
      expect(screen.getByText(/The posted \$1,420 stands/)).toBeInTheDocument()
    })

    it("shows a dash, not the request's CampMinder figure, on a share with no posted figure of its own (I2)", () => {
      const request = householdRequest(ROW_SAMUEL, {
        shares: [
          { ...SHARE, share_pct: 60, decided: null, posted: null },
          {
            ...SHARE,
            household_cm_id: 1000003,
            chip: 2,
            share_pct: 30,
            decided: null,
            posted: null,
          },
        ],
      })
      renderCard(request, SPLIT_PAGE)
      const shares = screen.getByRole('table', { name: 'Payer shares' })
      expect(within(shares).queryByText(/over/)).toBeNull()
      expect(within(shares).queryByText(/CampMinder shows/)).toBeNull()
      expect(within(shares).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    })

    it("shows each payer's own decided and posted figures, and no one-payer money line (M7)", () => {
      const request = householdRequest(ROW_SAMUEL, {
        shares: [
          {
            ...SHARE,
            share_pct: 60,
            decided: 1080,
            posted: 1080,
            in_campminder: 1080,
            status: 'confirmed',
          },
          {
            ...SHARE,
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
      expect(within(shares).getAllByText('$1,080').length).toBe(2)
      expect(within(shares).getAllByText('$720').length).toBe(2)
      expect(screen.queryByText('CampMinder shows $1,590')).toBeNull()
    })

    it('draws no "applied by" when one household is on the page (M7)', () => {
      renderCard()
      expect(screen.queryByText('applied by')).toBeNull()
    })

    it('names a payer from outside the page by its household, never a "0" chip (M6)', () => {
      const request = householdRequest(ROW_SAMUEL, {
        shares: [
          {
            ...SHARE,
            share_pct: 50,
            decided: 900,
            posted: 900,
            in_campminder: 900,
            status: 'confirmed',
          },
          {
            ...SHARE,
            household_cm_id: 1000009,
            chip: 0,
            share_pct: 50,
            decided: 900,
            posted: 900,
            in_campminder: 900,
            status: 'confirmed',
          },
        ],
      })
      renderCard(request)
      const shares = screen.getByRole('table', { name: 'Payer shares' })
      expect(within(shares).getByText('Household 1000009')).toBeInTheDocument()
      expect(within(shares).queryByText(/^0 ·/)).toBeNull()
    })

    it('shows the live receipt once when several unposted rounds share it (M8)', () => {
      renderCard(householdRequest(ROW_OLIVIA, { receipts: [receiptOut(1), receiptOut(2)] }))
      expect(screen.queryByRole('button', { name: /^Round 1 as/ })).toBeNull()
    })

    it('says "Cancelled" once on a cancelled card (M9)', () => {
      renderCard(
        householdRequest({
          ...ROW_EMMA,
          cancellation: { by: 'campminder', on: '2027-06-02', reason: null, note: '' },
        })
      )
      expect(screen.queryByText('Cancelled')).toBeNull()
      expect(screen.getAllByText(/Cancelled/)).toHaveLength(1)
    })

    it("names who pays when the only payer isn't the applicant (M10)", () => {
      const request = householdRequest(ROW_EMMA, {
        shares: [
          {
            ...SHARE,
            household_cm_id: 1000003,
            chip: 2,
            posted: null,
            decided: 1420,
            in_campminder: null,
            status: null,
          },
        ],
      })
      renderCard(request, SPLIT_PAGE)
      expect(screen.getByText('paid by')).toBeInTheDocument()
    })

    it('does not name a payer when the applicant pays (M10 regression guard)', () => {
      renderCard()
      expect(screen.queryByText('paid by')).toBeNull()
    })
  })

  describe('PR 5 final fix wave', () => {
    it("shows each of the request's notes as an amber line, in the server's words (I2; D81)", () => {
      const message = 'CampMinder shows $780 for this family; not yet ticked'
      const request = householdRequest({
        ...ROW_EMMA,
        notes: [{ code: 'ledger_note', severity: 'warn', message }],
      })
      renderCard(request)
      expect(screen.getByText(message)).toBeInTheDocument()
    })

    it('draws no note line when the request carries none (I2 regression guard)', () => {
      renderCard()
      expect(screen.queryByText(/not yet ticked/)).toBeNull()
    })

    it("keeps a reversed round's receipt folded even with a stale would-change figure (M1)", () => {
      const row = gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1420,
            posted: 1420,
            posted_on: '2027-03-09',
            would_change_by: 40,
            clawed_back: true,
          }),
        ],
      })
      renderCard(householdRequest(row))
      expect(screen.getByRole('button', { name: /^Show the receipt/ })).toBeInTheDocument()
    })

    it.each([
      ['withdrawn', 'Withdrawn'],
      ['duplicate', 'Duplicate'],
      ['duplicate_pending', 'Possible duplicate'],
    ])('says a %s request is %s, and draws no empty decision panel (M2)', (status, words) => {
      renderCard(
        householdRequest(gridRow({ request_status: status, rounds: [], total_decided: null }))
      )
      expect(screen.getByText(words)).toBeInTheDocument()
      expect(screen.queryByRole('table', { name: 'Decision panel' })).toBeNull()
    })

    it('draws no status word for a live request (M2 regression guard)', () => {
      renderCard()
      expect(screen.queryByText(/^(Withdrawn|Duplicate|Possible duplicate)$/)).toBeNull()
    })
  })
})
