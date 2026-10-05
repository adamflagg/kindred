import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, ROW_EMMA } from '../requests/gridFixtures'
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
    expect(screen.getByRole('link', { name: 'Enter income ↓' })).toHaveAttribute('href', '#income')
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
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
