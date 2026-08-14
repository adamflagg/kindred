/**
 * kindred#2237 — AddHouseholdPicker's Escape handling now goes through the
 * shared kindred#2205 token stack (`useOverlayEscape`) instead of a
 * capture-phase `document` listener with `stopPropagation` — a mechanism
 * that only ever beat the ONE outer listener it was written against, and
 * still let two overlays close on a single Escape press once a second one
 * opened on top of THIS picker (kindred#2237's whole point).
 *
 * Fictional data throughout.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddHouseholdPicker } from './AddHouseholdPicker'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from '../ui/modalStack'
import type { RosterPartyRow } from '../../types/lodging'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 201,
    person_cm_id: 0,
    display_name: 'The Chen Family',
    sort_name: 'Chen',
    adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: 'Mother' }],
    children: [],
    party_size: 1,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

function renderPicker() {
  return render(
    <AddHouseholdPicker
      groupName="The Chen Family"
      households={[party()]}
      memberCmIds={new Set()}
      householdToGroup={new Map()}
      disabled={false}
      onAdd={vi.fn()}
    />
  )
}

describe('AddHouseholdPicker — Escape', () => {
  it('closes on Escape when it is the only open overlay', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add household/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does NOT close on Escape once a further overlay has opened on top of it', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add household/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    const topToken = acquireOverlayToken()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    releaseOverlayToken(topToken)
  })

  it('releases its overlay token on unmount, so the stack does not leak', () => {
    const { unmount } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add household/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    unmount()

    expect(hasOpenModal()).toBe(false)
  })

  it('registers no token while closed', () => {
    renderPicker()
    expect(hasOpenModal()).toBe(false)
  })
})
