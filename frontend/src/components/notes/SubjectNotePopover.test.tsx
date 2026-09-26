import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import { HOUSEHOLD, noteRow } from '../../test/notesScope'
import { cardFor } from './cardFor'
import { SubjectNoteCorner } from './SubjectNoteCorner'
import { SubjectNotesScope } from './SubjectNotesScope'

let notesData: { notes: Array<ReturnType<typeof noteRow>> } = { notes: [] }
const saveNote = vi.fn()
vi.mock('../../hooks/useSubjectNotes', () => ({
  useSubjectNotes: () => ({ data: notesData }),
  useSaveSubjectNote: () => ({ mutateAsync: (...a: unknown[]) => saveNote(...a) }),
  usePromoteSubjectNote: () => ({ mutateAsync: vi.fn() }),
}))

const panelEscape = vi.fn()
function PanelStandIn() {
  // A slide-in panel already open beneath the popover, holding its own token.
  useOverlayEscape(true, panelEscape)
  return <div data-testid="panel" />
}

function Board({ withPanel = false }: { withPanel?: boolean }) {
  return (
    <SubjectNotesScope year={2026} sessionCmId={1000005} scenarioId="" scenarioName="" canManage>
      {withPanel && <PanelStandIn />}
      <div data-family-card className="group relative">
        <SubjectNoteCorner subject={HOUSEHOLD} label="Johnson" containing="padding" />
      </div>
      <button type="button">Elsewhere</button>
    </SubjectNotesScope>
  )
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /note/i }))
  return screen.getByRole('dialog', { name: 'Note' })
}

beforeEach(() => {
  notesData = { notes: [] }
  saveNote.mockReset().mockResolvedValue({ note: null, deleted: false })
  panelEscape.mockReset()
})

describe('SubjectNotePopover', () => {
  it('opens from the corner, portaled, titled with the card’s name', () => {
    render(<Board />)
    const dialog = openPopover()
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toHaveTextContent('Note · Johnson')
  })

  it('Escape discards, and closes the popover BEFORE the panel beneath it', () => {
    render(<Board withPanel />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    expect(panelEscape).not.toHaveBeenCalled()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('clicking outside with unsaved text SAVES it', async () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    )
    expect(saveNote).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: '', body: 'Arriving late Friday.' })
    )
  })

  it('clicking outside with nothing typed just closes', () => {
    render(<Board />)
    openPopover()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('a second press on the same corner keeps it open', () => {
    render(<Board />)
    openPopover()
    // The corner's own trigger -- the dialog now has a "Close note" button too.
    fireEvent.pointerDown(document.querySelector('[data-note-corner] button') as HTMLElement)
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
  })

  it('scrolling — inside its textarea or the page — never closes it', () => {
    render(<Board />)
    openPopover()
    fireEvent.scroll(screen.getByRole('textbox', { name: 'Note' }))
    fireEvent.scroll(window)
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
  })

  it('a mousedown inside it never reaches a document listener (the unplaced queue’s click-outside)', () => {
    const documentMouseDown = vi.fn()
    document.addEventListener('mousedown', documentMouseDown)
    try {
      render(<Board />)
      openPopover()
      fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Note' }))
      expect(documentMouseDown).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('mousedown', documentMouseDown)
    }
  })

  it('shows no hover preview on the corner while its popover is open', async () => {
    notesData = { notes: [noteRow(HOUSEHOLD, 'Grandma is coming Saturday only.')] }
    render(<Board />)
    openPopover()
    await act(async () => {
      fireEvent.focus(document.querySelector('[data-note-corner] button') as HTMLElement)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('removes the pending click-eater when the popover unmounts (b1)', () => {
    // A press on the corner installs a capture-phase document click-eater
    // (swallowing the click that follows the same physical press). Left
    // untracked, that guard outlives the popover and eats a LATER click meant
    // for something else entirely -- in a test file, the next test's corner
    // click; in the app, a click within 400ms of the press.
    const view = render(<Board />)
    openPopover()
    fireEvent.pointerDown(document.querySelector('[data-note-corner] button') as HTMLElement)
    view.unmount()

    // A native default action (checkbox toggling) proves the eater is gone:
    // if it had leaked, its capture-phase preventDefault() would suppress
    // this click's default action before it ever reaches the checkbox.
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="note-eater-probe" />')
    const probe = document.getElementById('note-eater-probe') as HTMLInputElement
    try {
      fireEvent.click(probe)
      expect(probe.checked).toBe(true)
    } finally {
      probe.remove()
    }
  })
})

describe('cardFor', () => {
  it('finds a family card around the corner, or a camper card beside it', () => {
    const family = document.createElement('div')
    family.setAttribute('data-family-card', '')
    const familyCorner = document.createElement('span')
    family.appendChild(familyCorner)
    expect(cardFor(familyCorner)).toBe(family)

    const wrapper = document.createElement('div')
    const camper = document.createElement('button')
    camper.setAttribute('data-camper-card', '')
    const camperCorner = document.createElement('span')
    wrapper.append(camper, camperCorner)
    expect(cardFor(camperCorner)).toBe(camper)
  })
})
