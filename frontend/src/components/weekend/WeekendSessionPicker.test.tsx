/**
 * The picker spans both program types: family sessions place households,
 * adult weekends place individuals. They share one lodging inventory, so
 * they share one picker — but the type stays labelled.
 *
 * It is a control, not content. Staff choose a weekend once and then work
 * inside it, so it stays compact rather than spending the top of the page on
 * twelve near-identical buttons.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { WeekendSession } from '../../types/lodging'
import { formatSessionDates } from './sessionDates'
import { WeekendSessionPicker } from './WeekendSessionPicker'

function session(overrides: Partial<WeekendSession> = {}): WeekendSession {
  return {
    session_id: 's1',
    session_cm_id: 1000001,
    name: 'Family Camp 1',
    session_type: 'family',
    start_date: '2026-09-04',
    end_date: '2026-09-07',
    ...overrides,
  }
}

describe('formatSessionDates', () => {
  it('collapses a same-month range', () => {
    expect(formatSessionDates('2026-09-04', '2026-09-07')).toBe('Sep 4–7, 2026')
  })

  it('spells out both months when the weekend spans one', () => {
    expect(formatSessionDates('2026-10-30', '2026-11-01')).toBe('Oct 30 – Nov 1, 2026')
  })

  it('shows a single date when start and end match', () => {
    expect(formatSessionDates('2026-09-04', '2026-09-04')).toBe('Sep 4, 2026')
  })

  it('reads the PocketBase datetime the API actually sends', () => {
    // The wire format is a datetime, not a bare date. Splitting on "-" leaves
    // "22 07:00:00.000Z" as the day and yields NaN — which fails silently as
    // an empty string, so no dates render anywhere.
    expect(formatSessionDates('2026-05-22 07:00:00.000Z', '2026-05-25 07:00:00.000Z')).toBe(
      'May 22–25, 2026'
    )
  })

  it('takes the calendar date rather than converting the instant', () => {
    // 07:00Z IS local midnight at camp, so the leading calendar date is what
    // the field means. `new Date(...)` in a negative offset would land on the
    // right day only by accident.
    expect(formatSessionDates('2026-05-22 07:00:00.000Z', '2026-05-22 07:00:00.000Z')).toBe(
      'May 22, 2026'
    )
  })

  it('spans months in the PocketBase format too', () => {
    expect(formatSessionDates('2026-10-30 07:00:00.000Z', '2026-11-01 07:00:00.000Z')).toBe(
      'Oct 30 – Nov 1, 2026'
    )
  })

  it('returns an empty string when dates are missing or unparseable', () => {
    expect(formatSessionDates(undefined, undefined)).toBe('')
    expect(formatSessionDates('2026-09-04', undefined)).toBe('')
    expect(formatSessionDates('not a date', '2026-09-04')).toBe('')
  })
})

describe('WeekendSessionPicker', () => {
  it('explains an empty year rather than rendering a dead control', () => {
    render(<WeekendSessionPicker sessions={[]} selectedCmId={null} onSelect={vi.fn()} />)
    expect(screen.getByText(/No family or adult sessions found/)).toBeInTheDocument()
  })

  it('separates family weekends from adult weekends', () => {
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
    expect(screen.getByRole('group', { name: 'Family weekends' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Adult weekends' })).toBeInTheDocument()
  })

  it('prompts for a choice when nothing is selected', () => {
    render(<WeekendSessionPicker sessions={[session()]} selectedCmId={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: /weekend/i })).toHaveValue('')
  })

  it('shows the chosen weekend as the control value', () => {
    render(
      <WeekendSessionPicker
        sessions={[session(), session({ session_cm_id: 1000002, name: 'Family Camp 2' })]}
        selectedCmId={1000002}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: /weekend/i })).toHaveValue('1000002')
  })

  it('reports the chosen session by CampMinder id, as a number', () => {
    const onSelect = vi.fn()
    render(
      <WeekendSessionPicker
        sessions={[session({ session_cm_id: 1000007, name: 'Keshet' })]}
        selectedCmId={null}
        onSelect={onSelect}
      />
    )

    return userEvent
      .selectOptions(screen.getByRole('combobox', { name: /weekend/i }), '1000007')
      .then(() => {
        expect(onSelect).toHaveBeenCalledWith(1000007)
      })
  })

  it('puts the dates beside each weekend so staff can tell them apart', () => {
    render(<WeekendSessionPicker sessions={[session()]} selectedCmId={null} onSelect={vi.fn()} />)
    expect(
      screen.getByRole('option', { name: /Family Camp 1 — Sep 4–7, 2026/ })
    ).toBeInTheDocument()
  })
})
