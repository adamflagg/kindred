/** The reporting controls (spec §9.2; D129, D130, D138; S4-3): off by default, one request set at a time. */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AidRequestSet } from '../../../services/camperships/aidApi'
import { ReportControls } from './ReportControls'

function renderControls(requestSet: AidRequestSet, decided?: boolean) {
  const onRequestSet = vi.fn<(next: AidRequestSet) => void>()
  const onDecided = vi.fn<(next: boolean) => void>()
  render(
    <ReportControls
      requestSet={requestSet}
      onRequestSet={onRequestSet}
      decided={decided}
      onDecided={decided === undefined ? undefined : onDecided}
      asOfWords="As of Apr 10, 2027 (live) · rules v3"
    />
  )
  return { onRequestSet, onDecided }
}

describe('ReportControls', () => {
  it('turns the deadline switch on and off', async () => {
    const { onRequestSet } = renderControls({ kind: 'all' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Through the Round 1 deadline' }))
    expect(onRequestSet).toHaveBeenLastCalledWith({ kind: 'deadline' })
  })

  it('takes a received-through date, and clears it', async () => {
    const { onRequestSet } = renderControls({ kind: 'date', date: '2027-02-01' })
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '2027-02-15' } })
    expect(onRequestSet).toHaveBeenLastCalledWith({ kind: 'date', date: '2027-02-15' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onRequestSet).toHaveBeenLastCalledWith({ kind: 'all' })
  })

  it('holds one request set at a time: the date waits while the deadline switch is on', () => {
    renderControls({ kind: 'deadline' })
    expect(screen.getByLabelText('Received through')).toBeDisabled()
  })

  it('offers "Include not yet offered" only where the page passes it (Statistics)', async () => {
    const { onDecided } = renderControls({ kind: 'all' }, false)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include not yet offered' }))
    expect(onDecided).toHaveBeenLastCalledWith(true)
    renderControls({ kind: 'all' })
    expect(screen.getAllByRole('checkbox', { name: 'Include not yet offered' })).toHaveLength(1)
  })
})
