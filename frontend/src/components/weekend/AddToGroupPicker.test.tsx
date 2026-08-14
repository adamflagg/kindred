/**
 * kindred#2237 — AddToGroupPicker's Escape handling now goes through the
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

import { AddToGroupPicker } from './AddToGroupPicker'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from '../ui/modalStack'
import type { FriendGroupRow } from '../../types/friendGroups'

function group(overrides: Partial<FriendGroupRow> = {}): FriendGroupRow {
  return {
    group_id: 'group-1',
    year: 2026,
    session_cm_id: 5001,
    name: 'The Riveras',
    color: '#84cc16',
    source: 'staff_manual',
    ...overrides,
  }
}

function renderPicker() {
  return render(<AddToGroupPicker groups={[group()]} onSelect={vi.fn()} disabled={false} />)
}

describe('AddToGroupPicker — Escape', () => {
  it('closes on Escape when it is the only open overlay', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does NOT close on Escape once a further overlay has opened on top of it', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    const topToken = acquireOverlayToken()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    releaseOverlayToken(topToken)
  })

  it('releases its overlay token on unmount, so the stack does not leak', () => {
    const { unmount } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    unmount()

    expect(hasOpenModal()).toBe(false)
  })

  it('registers no token while closed', () => {
    renderPicker()
    expect(hasOpenModal()).toBe(false)
  })
})
