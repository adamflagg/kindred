/**
 * The picker spans both program types: family sessions place households,
 * adult weekends place individuals. They share one lodging inventory, so
 * they share one picker — but the type stays labelled.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { WeekendSession } from '../../types/lodging'
import { WeekendSessionPicker } from './WeekendSessionPicker'

function session(overrides: Partial<WeekendSession> = {}): WeekendSession {
  return {
    session_id: 's1',
    session_cm_id: 1000001,
    name: 'Family Camp 1',
    session_type: 'family',
    start_date: '2026-06-19',
    end_date: '2026-06-21',
    ...overrides,
  }
}

describe('WeekendSessionPicker', () => {
  it('explains an empty year rather than rendering an empty group', () => {
    render(<WeekendSessionPicker sessions={[]} selectedCmId={null} onSelect={vi.fn()} />)
    expect(screen.getByText(/No family or adult sessions found/)).toBeInTheDocument()
  })

  it('labels family and adult weekends distinctly', () => {
    render(
      <WeekendSessionPicker
        sessions={[
          session(),
          session({
            session_id: 's2',
            session_cm_id: 1000002,
            name: "Women's Weekend",
            session_type: 'adult',
          }),
        ]}
        selectedCmId={null}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('Adult')).toBeInTheDocument()
  })

  it('marks the selected weekend as pressed', () => {
    render(
      <WeekendSessionPicker
        sessions={[
          session(),
          session({ session_id: 's2', session_cm_id: 1000002, name: 'Family Camp 2' }),
        ]}
        selectedCmId={1000002}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Family Camp 2/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /Family Camp 1/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('reports the chosen session by CampMinder id', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <WeekendSessionPicker
        sessions={[session({ session_cm_id: 1000007, name: 'Keshet' })]}
        selectedCmId={null}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByRole('button', { name: /Keshet/ }))
    expect(onSelect).toHaveBeenCalledWith(1000007)
  })
})
