import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA } from '../requests/gridFixtures'
import { HoldActions, ReleasedHolds } from './HoldActions'
import { householdRequest } from './householdFixtures'

const withHold = (code: string, severity: 'hold' | 'warn' = 'hold') =>
  householdRequest(gridRow({ ...ROW_EMMA, holds: [{ code, severity, message: 'm' }] }))

const release = vi.fn()
const manual = vi.fn()
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidHoldRelease: () => ({
    mutateAsync: (vars: unknown) => {
      release(vars)
      return Promise.resolve({})
    },
  }),
  useAidManualHold: () => ({
    mutateAsync: (vars: unknown) => {
      manual(vars)
      return Promise.resolve({})
    },
  }),
}))

beforeEach(() => {
  release.mockReset()
  manual.mockReset()
})

describe('HoldActions (Decision 25)', () => {
  it('releases a releasable hold with a note', async () => {
    render(
      <HoldActions request={withHold('py_confirm_tier_change')} code="py_confirm_tier_change" />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Release…' }))
    await userEvent.type(screen.getByLabelText('Release note'), 'Checked{Enter}')
    expect(release).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { code: 'py_confirm_tier_change', released: true, note: 'Checked' },
    })
  })

  it('offers the fix, and no release, for a hold only its cause clears', () => {
    render(
      <HoldActions
        request={withHold('household_income_conflict')}
        code="household_income_conflict"
      />
    )
    expect(screen.getByRole('link', { name: 'Enter the Income ↓' })).toHaveAttribute(
      'href',
      '#income'
    )
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
  })

  // Item 4c (owner ruling 10-05): on a revived duplicate's hold only, Release… reads Keep This
  // Request…: the same release, the same note. No Keep the Other here.
  it('offers a revived duplicate Keep This Request…, which releases its hold with the note', async () => {
    render(
      <HoldActions
        request={withHold('duplicate_survivor_withdrawn')}
        code="duplicate_survivor_withdrawn"
      />
    )
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Keep the Other/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Keep This Request…' }))
    await userEvent.type(screen.getByLabelText('Release note'), 'The family re-applied{Enter}')
    expect(release).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { code: 'duplicate_survivor_withdrawn', released: true, note: 'The family re-applied' },
    })
  })

  it('puts what it is handed after (the withdrawn request link) after Keep This Request…', () => {
    render(
      <HoldActions
        request={withHold('duplicate_survivor_withdrawn')}
        code="duplicate_survivor_withdrawn"
        after={<a href="#request-reqwithdrawn001">Go to the Withdrawn Request ↓</a>}
      />
    )
    const keep = screen.getByRole('button', { name: 'Keep This Request…' })
    const link = screen.getByRole('link', { name: 'Go to the Withdrawn Request ↓' })
    expect(keep.nextElementSibling).toBe(link)
  })

  it("puts what it is handed (Use X's Form) before the fix link (round 3, section 3)", () => {
    render(
      <HoldActions
        request={withHold('household_income_conflict')}
        code="household_income_conflict"
        before={<button type="button">Use Emma&apos;s Form</button>}
      />
    )
    const use = screen.getByRole('button', { name: "Use Emma's Form" })
    const fix = screen.getByRole('link', { name: 'Enter the Income ↓' })
    expect(use.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // B26 (ruled 10-04 late): the banner names the three fixes; the amount is the card's own editor.
  it('names the three fixes of an above-cost hold, and links the amount to the card', () => {
    const request = householdRequest(
      gridRow({
        ...ROW_EMMA,
        rounds: [roundOut(1, 'posted', { decided: 1800, posted: 1800 }), roundOut(3, 'held')],
        holds: [{ code: 'award_above_cost', severity: 'hold', message: 'm' }],
      })
    )
    render(<HoldActions request={request} code="award_above_cost" />)
    expect(
      screen.getByText('Three fixes: the cost, the grants, or the amount.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change the Amount ↓' })).toHaveAttribute(
      'href',
      '#request-reqemma00000001'
    )
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
  })

  it('keeps the words but draws no amount link when the card offers no money edit', () => {
    const request = householdRequest(
      gridRow({
        ...ROW_EMMA,
        cancellation: { by: 'kindred', on: '2027-05-02', reason: 'schedule', note: '' },
        holds: [{ code: 'award_above_cost', severity: 'hold', message: 'm' }],
      })
    )
    render(<HoldActions request={request} code="award_above_cost" />)
    expect(
      screen.getByText('Three fixes: the cost, the grants, or the amount.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it("offers no release for a warning the server doesn't hold the award on", () => {
    render(<HoldActions request={withHold('income_missing', 'warn')} code="income_missing" />)
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
  })

  it('lifts the manual hold, not releases it', async () => {
    render(<HoldActions request={withHold('manual_hold')} code="manual_hold" />)
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Lift…' }))
    await userEvent.type(screen.getByLabelText('Why lift the hold'), 'Call done{Enter}')
    expect(manual).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { held: false, note: 'Call done' },
    })
  })

  it('puts a released hold back with a note', async () => {
    const request = householdRequest({
      ...ROW_EMMA,
      released_holds: [
        {
          code: 'py_confirm_tier_change',
          note: 'ok',
          released_by: 'Emma Johnson',
          released_at: '2027-03-01T10:00:00Z',
        },
      ],
    })
    render(<ReleasedHolds request={request} />)
    await userEvent.click(screen.getByRole('button', { name: 'Put Back…' }))
    await userEvent.type(screen.getByLabelText('Why put it back'), 'Mistake{Enter}')
    expect(release).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { code: 'py_confirm_tier_change', released: false, note: 'Mistake' },
    })
  })
})

// Owner, sitting B: a released hold's line names the person as the History tab does, never an email.
describe('a released hold names who released it', () => {
  const released = (by: string) =>
    householdRequest({
      ...ROW_EMMA,
      released_holds: [
        {
          code: 'py_confirm_tier_change',
          note: 'Checked the file',
          released_by: by,
          released_at: '2027-03-01T10:00:00Z',
        },
      ],
    })

  it("reads a sign-in as its email's first word, capitalised", () => {
    render(<ReleasedHolds request={released('emma.chen@example.org')} />)
    expect(screen.getByText(/ by Emma: Checked the file$/)).toBeInTheDocument()
    expect(screen.queryByText(/example\.org/)).toBeNull()
  })

  it('reads a sign-in the receipts name as that first name', () => {
    render(
      <ReleasedHolds
        request={released('emma.chen@example.org')}
        names={new Map([['emma.chen@example.org', 'Emmy']])}
      />
    )
    expect(screen.getByText(/ by Emmy: Checked the file$/)).toBeInTheDocument()
  })
})

describe('holds on a request that is no longer live (m2)', () => {
  const withdrawn = (over: Record<string, unknown>) =>
    householdRequest(gridRow({ ...ROW_EMMA, request_status: 'withdrawn', ...over }))

  it('offers no Release or Lift', () => {
    const request = withdrawn({
      holds: [
        { code: 'py_confirm_tier_change', severity: 'hold', message: 'm' },
        { code: 'manual_hold', severity: 'hold', message: 'm' },
      ],
    })
    render(
      <>
        <HoldActions request={request} code="py_confirm_tier_change" />
        <HoldActions request={request} code="manual_hold" />
      </>
    )
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lift…' })).toBeNull()
  })

  it('offers no Put back', () => {
    const request = withdrawn({
      released_holds: [
        {
          code: 'py_confirm_tier_change',
          note: 'ok',
          released_by: 'Emma Johnson',
          released_at: '2027-03-01T10:00:00Z',
        },
      ],
    })
    render(<ReleasedHolds request={request} />)
    expect(screen.queryByRole('button', { name: 'Put Back…' })).toBeNull()
  })
})
