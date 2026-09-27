import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HOUSEHOLD, NotesScopeFixture, noteRow, scopeValue } from '../../test/notesScope'
import { SubjectNoteCorner } from './SubjectNoteCorner'
import { subjectKey } from './subjectNoteModel'

function renderCorner(
  rows = [noteRow(HOUSEHOLD, 'Grandma is coming Saturday only.')],
  overrides = {}
) {
  const value = scopeValue(rows, overrides)
  // ONE handler for all three: dnd-kit's `MouseSensor`/`TouchSensor` (the
  // sensors both real boards register) key off `mousedown`/`touchstart`,
  // never `pointerdown` -- pinning all three here is what would have caught
  // the corner stopping only `pointerdown` and still leaking a real
  // mousedown/touchstart drag start to the card.
  const onCardPointerDown = vi.fn()
  const view = render(
    <NotesScopeFixture value={value}>
      {/* A stand-in card frame: FamilyCard's geometry, inline so jsdom computes it. */}
      <div
        data-family-card
        className="group relative"
        style={{ borderTopRightRadius: '12px', borderTopWidth: '2px', borderStyle: 'solid' }}
        onPointerDown={onCardPointerDown}
        onMouseDown={onCardPointerDown}
        onTouchStart={onCardPointerDown}
      >
        <SubjectNoteCorner subject={HOUSEHOLD} label="Johnson" containing="padding" />
      </div>
    </NotesScopeFixture>
  )
  const holder = view.container.querySelector<HTMLElement>('[data-note-corner]')
  return { ...view, value, holder, onCardPointerDown }
}

describe('SubjectNoteCorner', () => {
  it('renders nothing outside a scope (a viewer without bunking.manage)', () => {
    const { container } = render(
      <SubjectNoteCorner subject={HOUSEHOLD} label="Johnson" containing="padding" />
    )
    expect(container.querySelector('[data-note-corner]')).toBeNull()
  })

  it('is a faint ghost on an empty card, visible only on hover or focus-within', () => {
    const { holder } = renderCorner([])
    expect(holder).toHaveAttribute('data-note-corner', 'ghost')
    expect(holder?.className).toContain('opacity-0')
    expect(holder?.className).toContain('group-hover:opacity-60')
    expect(holder?.className).toContain('group-focus-within:opacity-60')
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
  })

  it('traces the card’s own border corner: its radius, stepped out over its border', () => {
    const { holder } = renderCorner()
    expect(holder?.style.top).toBe('-2px')
    expect(holder?.style.right).toBe('-2px')
    expect(holder?.style.width).toBe('20px')
    expect(holder?.querySelector('path')?.getAttribute('d')).toContain('A 12 12 0 0 1 16 12')
  })

  it('fills a standard note sticky yellow with a solid edge', () => {
    const { holder } = renderCorner()
    expect(holder).toHaveAttribute('data-note-corner', 'standard')
    const [fill, edge] = Array.from(holder?.querySelectorAll('path') ?? [])
    expect(fill).toHaveAttribute('fill', '#fef08a')
    expect(edge).toHaveAttribute('stroke', '#eab308')
    expect(edge).not.toHaveAttribute('stroke-dasharray')
  })

  it('draws a plan-only note paler with a dashed edge', () => {
    const { holder } = renderCorner([noteRow(HOUSEHOLD, 'Try Pine', 'scnA')])
    expect(holder).toHaveAttribute('data-note-corner', 'plan')
    const [fill, edge] = Array.from(holder?.querySelectorAll('path') ?? [])
    expect(fill).toHaveAttribute('fill', '#fefce8')
    expect(edge).toHaveAttribute('stroke-dasharray', '2 1.5')
  })

  it('shows the standard solid fill with a dashed inner edge (not a dot) when both kinds of note exist, and says "+1 more" in the preview', () => {
    const { holder } = renderCorner([
      noteRow(HOUSEHOLD, 'Standard'),
      noteRow(HOUSEHOLD, 'Plan', 'scnA'),
    ])
    expect(holder).toHaveAttribute('data-note-corner', 'standard')
    const [fill, edge] = Array.from(holder?.querySelectorAll('path') ?? [])
    expect(fill).toHaveAttribute('fill', '#fef08a')
    expect(edge).toHaveAttribute('stroke-dasharray', '2 1.5')
    expect(holder?.querySelector('[data-note-dot]')).toBeNull()
    fireEvent.focus(screen.getByRole('button', { name: 'Note' }))
    expect(within(screen.getByRole('tooltip')).getByText('+1 more')).toBeInTheDocument()
  })

  it('previews the first 120 characters in the real Tooltip', () => {
    const long = `${'a'.repeat(118)} bcdef`
    renderCorner([noteRow(HOUSEHOLD, long)])
    fireEvent.focus(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(`${'a'.repeat(118)} b…`)
  })

  it('pointerdown, mousedown and touchstart on the corner do not reach the card (never a drag start)', () => {
    const { onCardPointerDown } = renderCorner()
    const note = screen.getByRole('button', { name: 'Note' })
    fireEvent.pointerDown(note)
    fireEvent.mouseDown(note)
    fireEvent.touchStart(note)
    expect(onCardPointerDown).not.toHaveBeenCalled()
  })

  it('a click opens the popover editor anchored to this corner', () => {
    const { value, holder } = renderCorner()
    // `detail: 1` -- a real mouse click; native `detail` is the click count
    // (>= 1) for a pointer click, 0 for a keyboard (Enter/Space) activation.
    fireEvent.click(screen.getByRole('button', { name: 'Note' }), { detail: 1 })
    expect(value.openEditor).toHaveBeenCalledWith({
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'popover',
      anchorEl: holder,
      openedViaKeyboard: false,
    })
  })

  it('flags a keyboard (Enter/Space) activation for the popover’s own focus-restore rule', () => {
    const { value, holder } = renderCorner()
    // No explicit `detail` -- jsdom's own default, 0, matching a native
    // keyboard-triggered click exactly (see the comment above).
    fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    expect(value.openEditor).toHaveBeenCalledWith({
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'popover',
      anchorEl: holder,
      openedViaKeyboard: true,
    })
  })

  it('names itself for the popover’s outside-click check', () => {
    const { holder } = renderCorner()
    expect(holder).toHaveAttribute('data-note-corner-for', subjectKey(HOUSEHOLD))
  })

  it('shows the Draft pill beside "Note" in the preview for a plan-only note', () => {
    renderCorner([noteRow(HOUSEHOLD, 'Try Pine', 'scnA')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    fireEvent.focus(screen.getByRole('button', { name: 'Note' }))
    expect(within(screen.getByRole('tooltip')).getByText('Draft A')).toBeInTheDocument()
  })

  it('shows no pill in the preview for a standard-only note', () => {
    // A named scenario is open, so a pill wrongly shown here would read
    // 'Draft A' -- without it this assertion could never fail.
    renderCorner(undefined, { scenarioId: 'scnA', scenarioName: 'Draft A' })
    fireEvent.focus(screen.getByRole('button', { name: 'Note' }))
    expect(within(screen.getByRole('tooltip')).queryByText('Draft A')).toBeNull()
  })

  it('shows no pill in the preview when both kinds of note exist (the "+1 more" line still does)', () => {
    renderCorner([noteRow(HOUSEHOLD, 'Standard'), noteRow(HOUSEHOLD, 'Plan', 'scnA')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    fireEvent.focus(screen.getByRole('button', { name: 'Note' }))
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).queryByText('Draft A')).toBeNull()
    expect(within(tooltip).getByText('+1 more')).toBeInTheDocument()
  })
})

describe('SubjectNoteCorner — containing="border" (CamperCard’s own path, summer parity)', () => {
  // Every other test here uses `containing="padding"` (FamilyCard's path):
  // the holder measures its own PARENT. CamperCard passes `containing="border"`
  // instead -- the holder is a SIBLING of the card, not nested inside it
  // (`useNoteSlots.tsx`), so the measurement instead queries a sibling
  // `[data-camper-card]`. The fill/dash/no-dot rendering itself (`CornerCap`)
  // never reads `containing`, so it does not need re-proving here -- only the
  // measurement path that camper cards actually exercise.
  function renderCamperCorner(rows = [noteRow(HOUSEHOLD, 'Grandma is coming Saturday only.')]) {
    const value = scopeValue(rows)
    const view = render(
      <NotesScopeFixture value={value}>
        <div className="group relative">
          <button
            type="button"
            data-camper-card
            style={{ borderTopRightRadius: '10px', borderTopWidth: '3px', borderStyle: 'solid' }}
          >
            Emma Johnson
          </button>
          <SubjectNoteCorner subject={HOUSEHOLD} label="Emma Johnson" containing="border" />
        </div>
      </NotesScopeFixture>
    )
    return { ...view, holder: view.container.querySelector<HTMLElement>('[data-note-corner]') }
  }

  it('measures the sibling camper card’s own corner, not the holder’s parent', () => {
    const { holder } = renderCamperCorner()
    // `containing="border"` never applies the padding path's negative
    // outward offset (`offset = containing === 'padding' ? -frame.border : 0`).
    expect(holder?.style.top).toBe('0px')
    expect(holder?.style.right).toBe('0px')
    expect(holder?.querySelector('path')?.getAttribute('d')).toContain('A 10 10 0 0 1 16 10')
  })

  it('still shows the standard solid fill with a dashed edge and no dot for a camper with both note kinds', () => {
    const { holder } = renderCamperCorner([
      noteRow(HOUSEHOLD, 'Standard'),
      noteRow(HOUSEHOLD, 'Plan', 'scnA'),
    ])
    expect(holder).toHaveAttribute('data-note-corner', 'standard')
    const [fill, edge] = Array.from(holder?.querySelectorAll('path') ?? [])
    expect(fill).toHaveAttribute('fill', '#fef08a')
    expect(edge).toHaveAttribute('stroke-dasharray', '2 1.5')
    expect(holder?.querySelector('[data-note-dot]')).toBeNull()
  })
})
