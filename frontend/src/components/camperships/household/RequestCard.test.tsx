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
  it('heads the card with the camper, session, CampMinder Person link, stage and cost', () => {
    renderCard()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('· Session 2 ·')).toBeInTheDocument()
    // N7: "Person", Title Case, CampMinder's own link (the CM icon and the external-link glyph).
    const person = screen.getByRole('link', { name: 'Person' })
    expect(person).toHaveAttribute(
      'href',
      'https://system.campminder.com/ui/person/Record#1000002:2027'
    )
    expect(person).toHaveAttribute('target', '_blank')
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
    // The state pill and the tick's label.
    expect(within(panel).getAllByText('Posted')).toHaveLength(2)
    expect(within(panel).getByText('locked Mar 9 · Test User')).toBeInTheDocument()
    // D6: the mock's forest boxes, the date muted beside the label.
    expect(within(panel).getByTestId('tick-Posted-1')).toHaveTextContent('✓Posted Mar 9')
    expect(within(panel).getByTestId('tick-Accepted-1')).toHaveTextContent(/^Accepted$/)
  })

  it('draws no would-change flag or sentence on a locked round, whichever way rules would move it (owner Decision 1)', () => {
    for (const by of [67, -40]) {
      const row = gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1420,
            posted: 1420,
            posted_on: '2027-03-09',
            would_change_by: by,
          }),
        ],
      })
      const { unmount } = renderCard(householdRequest(row))
      expect(screen.queryByText(/posted stands/)).toBeNull()
      expect(screen.queryByText(/rules now/)).toBeNull()
      expect(screen.queryByText(/Today's rules would/)).toBeNull()
      expect(screen.queryByText(/would change by/)).toBeNull()
      unmount()
    }
  })

  it('keeps the receipt folded on a would-change figure alone (owner Decision 1)', () => {
    const row = gridRow({
      rounds: [roundOut(1, 'posted', { decided: 1420, posted: 1420, would_change_by: -40 })],
    })
    renderCard(householdRequest(row, { receipts: [receiptOut(1)] }))
    expect(screen.getByRole('button', { name: /^Show the receipt/ })).toBeInTheDocument()
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
    expect(screen.getByText('Cancelled in CampMinder Jun 2 · none recorded')).toBeInTheDocument()
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
      // D26: nor an empty "Decided — Posted —" line.
      expect(screen.queryByText(/Decided/)).toBeNull()
    })

    it('draws no status word for a live request (M2 regression guard)', () => {
      renderCard()
      expect(screen.queryByText(/^(Withdrawn|Duplicate|Possible duplicate)$/)).toBeNull()
    })
  })

  describe("sitting B's true-up (household polish)", () => {
    const PAYER = {
      household_cm_id: 1000001,
      chip: 1,
      share_pct: 100,
      decided: 900,
      posted: 900,
      in_campminder: 900,
      status: 'confirmed',
    } as const

    // O2 (ruled 10-04 late): every live card has the same shape, three round rows.
    it('draws the rounds not reached as muted "Round N —" rows', () => {
      renderCard()
      const panel = screen.getByRole('table', { name: 'Decision panel' })
      const rows = within(panel).getAllByRole('row')
      expect(rows.map((row) => row.textContent)).toEqual(
        expect.arrayContaining(['Round 2—', 'Round 3—'])
      )
    })

    // O6 (ruled 10-04 late, a number's meaning): the session's price still shows on a cancelled card.
    it("shows a cancelled request's cost from its receipt when the row leaves it out", () => {
      renderCard(
        householdRequest(
          {
            ...ROW_EMMA,
            cost: null,
            cancellation: { by: 'kindred', on: '2027-05-02', reason: 'schedule', note: '' },
          },
          { receipts: [receiptOut(1)] }
        )
      )
      expect(screen.getByText('cost', { exact: false })).toHaveTextContent('cost $5,000')
    })

    // B21 (ruled 10-04 late): the grid's Not reconciled reason pill, beside the server's sentence.
    it("draws a round's Not reconciled reason as the grid's pill beside the server's words", () => {
      const message = 'Round 1 is posted in CampMinder for less than was decided.'
      renderCard(
        householdRequest({
          ...ROW_EMMA,
          unticked: [
            { round: 1, code: 'short_posting', message, mark_posted: true, label: 'Short in CM' },
          ],
        })
      )
      const pill = screen.getByText('Short in CM')
      expect(pill.closest('p')).toHaveTextContent(`Short in CM${message}`)
    })

    // D12, D13: the mock's share-table header and money-line separator.
    it('heads the share table "Confirmation", and separates Decided and Posted with a "·"', () => {
      const { unmount } = renderCard(PAGE.requests[1])
      expect(screen.getByText(/^Decided/).parentElement).toHaveTextContent(
        /Decided \$[\d,]+ · Posted/
      )
      unmount()
      renderCard(
        householdRequest(ROW_SAMUEL, {
          shares: [
            { ...PAYER, household_cm_id: 1000001, chip: 1, share_pct: 60 },
            { ...PAYER, household_cm_id: 1000003, chip: 2, share_pct: 40 },
          ],
        }),
        SPLIT_PAGE
      )
      const shares = screen.getByRole('table', { name: 'Payer shares' })
      expect(within(shares).getByRole('columnheader', { name: 'Confirmation' })).toBeInTheDocument()
    })
  })
})

// B21 (owner, sitting B): a C1 round (in CampMinder in full, tonight's tick posts it) is waiting on
// the overnight sync, not on an offer: "Pending", not the row to act on, with the server's sentence.
describe('a C1 round on the decision panel', () => {
  const C1_SENTENCE = "In CampMinder in full; tonight's sync will mark it posted."
  const c1 = (message: string | null = C1_SENTENCE) =>
    householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'needs_offer', {
            decided: 1500,
            cm_pending: true,
            cm_pending_message: message,
          }),
        ],
      })
    )
  const roundRow = (panel: HTMLElement) => within(panel).getByText('Round 1').closest('tr')!

  it('reads Pending, not Needs an offer', () => {
    renderCard(c1())
    const panel = screen.getByRole('table', { name: 'Decision panel' })
    expect(within(panel).getByText('Pending')).toBeInTheDocument()
    expect(within(panel).queryByText('Needs an offer')).toBeNull()
  })

  it('is not tinted as the row to act on, while a plain needs-offer round is', () => {
    const { unmount } = renderCard(c1())
    expect(roundRow(screen.getByRole('table', { name: 'Decision panel' })).className).not.toContain(
      'bg-amber-100/45'
    )
    unmount()
    renderCard(
      householdRequest(gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 1500 })] }))
    )
    const panel = screen.getByRole('table', { name: 'Decision panel' })
    expect(within(panel).getByText('Needs an offer')).toBeInTheDocument()
    expect(roundRow(panel).className).toContain('bg-amber-100/45')
  })

  it("shows the server's cm_pending_message under the line, and nothing when there is none", () => {
    const { unmount } = renderCard(c1())
    expect(
      within(screen.getByRole('table', { name: 'Decision panel' })).getByText(C1_SENTENCE)
    ).toBeInTheDocument()
    unmount()
    renderCard(c1(null))
    expect(screen.queryByText(C1_SENTENCE)).toBeNull()
  })
})
