import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROW_EMMA } from '../requests/gridFixtures'
import { HoldActions, ReleasedHolds } from './HoldActions'
import { householdRequest } from './householdFixtures'

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
    render(<HoldActions request={householdRequest(ROW_EMMA)} code="py_confirm_tier_change" />)
    await userEvent.click(screen.getByRole('button', { name: 'Release…' }))
    await userEvent.type(screen.getByLabelText('Release note'), 'Checked{Enter}')
    expect(release).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { code: 'py_confirm_tier_change', released: true, note: 'Checked' },
    })
  })

  it('offers the fix, and no release, for a hold only its cause clears', () => {
    render(<HoldActions request={householdRequest(ROW_EMMA)} code="household_income_conflict" />)
    expect(screen.getByRole('link', { name: 'Enter income ↓' })).toHaveAttribute('href', '#income')
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
  })

  it('lifts the manual hold, not releases it', async () => {
    render(<HoldActions request={householdRequest(ROW_EMMA)} code="manual_hold" />)
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
          released_by: 'Staff Sam',
          released_at: '2027-03-01T10:00:00Z',
        },
      ],
    })
    render(<ReleasedHolds request={request} />)
    await userEvent.click(screen.getByRole('button', { name: 'Put back…' }))
    await userEvent.type(screen.getByLabelText('Why put it back'), 'Mistake{Enter}')
    expect(release).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { code: 'py_confirm_tier_change', released: false, note: 'Mistake' },
    })
  })
})
