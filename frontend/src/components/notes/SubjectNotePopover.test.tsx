import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import { HOUSEHOLD, noteRow, PERSON } from '../../test/notesScope'
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

  it('a press in an outside scroll container’s scrollbar gutter does not close it', async () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })

    // A stand-in scroll container (the unplaced queue, a SlideInPanel, a
    // CamperDetailsPanel list): offsetWidth > clientWidth is what "has a
    // scrollbar gutter" means; jsdom never lays these out, so both are
    // stubbed. offsetX derives from clientX (jsdom has no layout engine, so
    // offsetX/offsetY fall back to pageX/pageY, which fall back to
    // clientX/clientY) -- passing `clientX` to `fireEvent` is what actually
    // reaches `event.offsetX`, since jsdom's PointerEvent does not accept
    // `offsetX` directly through the init dict (it is a getter with no
    // setter on MouseEvent's prototype).
    const scrollArea = document.createElement('div')
    Object.defineProperty(scrollArea, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(scrollArea, 'offsetWidth', { value: 115, configurable: true })
    // No VERTICAL gutter: pinned equal, so a default offsetY of 0 doesn't
    // coincidentally satisfy `offsetY >= clientHeight` against jsdom's
    // unstubbed 0/0 default and false-flag the second, genuinely-outside press.
    Object.defineProperty(scrollArea, 'clientHeight', { value: 50, configurable: true })
    Object.defineProperty(scrollArea, 'offsetHeight', { value: 50, configurable: true })
    document.body.appendChild(scrollArea)

    try {
      // Past clientWidth (100) but within offsetWidth (115): the gutter itself.
      fireEvent.pointerDown(scrollArea, { clientX: 105 })
      expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
      expect(saveNote).not.toHaveBeenCalled()

      // The SAME element's own content area is still a genuine outside press.
      fireEvent.pointerDown(scrollArea, { clientX: 50 })
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
      )
      expect(saveNote).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: '', body: 'Arriving late Friday.' })
      )
    } finally {
      scrollArea.remove()
    }
  })

  it('a second press on the same corner keeps it open', () => {
    render(<Board />)
    openPopover()
    // The corner's own trigger -- the dialog now has a "Close note" button too.
    fireEvent.pointerDown(document.querySelector('[data-note-corner] button') as HTMLElement)
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
  })

  it('the eater actually eats the click that follows a second corner press', () => {
    render(<Board />)
    openPopover()
    const cornerButton = document.querySelector('[data-note-corner] button') as HTMLElement
    // Attached directly to the corner button, not the document: the eater's
    // capture-phase `stopPropagation()` at `document` halts the event before
    // it descends anywhere near this node, so a listener planted here proves
    // the click never reaches the corner at all -- which is what stops its
    // own `onClick` (`openEditor`) from re-running.
    const cornerClick = vi.fn()
    cornerButton.addEventListener('click', cornerClick)
    try {
      fireEvent.pointerDown(cornerButton)
      fireEvent.click(cornerButton)
      expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
      expect(cornerClick).not.toHaveBeenCalled()
    } finally {
      cornerButton.removeEventListener('click', cornerClick)
    }
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

  it('restores focus to the corner button when Escape closes it', () => {
    render(<Board />)
    openPopover()
    const cornerButton = document.querySelector('[data-note-corner] button') as HTMLElement
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(document.activeElement).toBe(cornerButton)
  })

  it('leaves focus where the user clicked, once an outside-click save resolves', async () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    fireEvent.pointerDown(elsewhere)
    // jsdom's pointerDown never moves focus the way a real click does --
    // simulate that side effect explicitly, before the save's round trip
    // resolves (the popover only unmounts once save() has settled).
    elsewhere.focus()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    )
    expect(document.activeElement).toBe(elsewhere)
  })

  it('a press on the queue’s own toggle button keeps the popover open, no save, and the toggle’s own click still fires', () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })

    // A stand-in for FloatingQueueBadge's own toggle button -- marked with
    // the same `data-queue-toggle` attribute, elsewhere in the document.
    const badge = document.createElement('div')
    badge.setAttribute('data-floating-badge', '')
    const toggle = document.createElement('button')
    toggle.setAttribute('data-queue-toggle', '')
    const toggleClick = vi.fn()
    toggle.addEventListener('click', toggleClick)
    badge.appendChild(toggle)
    document.body.appendChild(badge)

    try {
      fireEvent.pointerDown(toggle)
      // The exemption only proves itself if the click that follows the same
      // physical press still reaches the toggle's own handler -- a
      // regression that installed the corner's click-eater on the toggle
      // path too would still pass a pointerDown-only assertion, since
      // nothing here would ever fire the eaten click to notice.
      fireEvent.click(toggle)
      expect(toggleClick).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
      expect(saveNote).not.toHaveBeenCalled()
    } finally {
      badge.remove()
    }
  })

  it('a press on the expanded queue’s own close button keeps the popover open, no save', () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })

    // A stand-in for FloatingQueueBadge's own expanded-state close ✕ --
    // marked with the same `data-queue-close` attribute, elsewhere in the
    // document.
    const badge = document.createElement('div')
    badge.setAttribute('data-floating-badge', '')
    const close = document.createElement('button')
    close.setAttribute('data-queue-close', '')
    badge.appendChild(close)
    document.body.appendChild(badge)

    try {
      fireEvent.pointerDown(close)
      expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
      expect(saveNote).not.toHaveBeenCalled()
    } finally {
      badge.remove()
    }
  })

  it('a press elsewhere in the queue badge (not its toggle) still saves the open note first', async () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })

    // Deliberately NOT the whole `[data-floating-badge]`: a press on another
    // queue card's corner must still save the open note first.
    const badge = document.createElement('div')
    badge.setAttribute('data-floating-badge', '')
    const row = document.createElement('div')
    badge.appendChild(row)
    document.body.appendChild(badge)

    try {
      fireEvent.pointerDown(row)
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
      )
      expect(saveNote).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: '', body: 'Arriving late Friday.' })
      )
    } finally {
      badge.remove()
    }
  })

  it('a press on ANOTHER card’s real corner (not the queue) still saves the open note first', async () => {
    render(
      <SubjectNotesScope year={2026} sessionCmId={1000005} scenarioId="" scenarioName="" canManage>
        <div data-family-card className="group relative">
          <SubjectNoteCorner subject={HOUSEHOLD} label="Johnson" containing="padding" />
        </div>
        <div data-family-card className="group relative">
          <SubjectNoteCorner subject={PERSON} label="Chen" containing="padding" />
        </div>
      </SubjectNotesScope>
    )
    // Both corners read "Add note" (neither has an existing note), so grab
    // them by their own `data-note-corner-for` key rather than by role name.
    const corners = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-note-corner-for] button')
    )
    expect(corners).toHaveLength(2)
    const [firstCorner, secondCorner] = corners as [HTMLButtonElement, HTMLButtonElement]
    fireEvent.click(firstCorner)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })

    fireEvent.pointerDown(secondCorner)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    )
    expect(saveNote).toHaveBeenCalledWith(
      expect.objectContaining({ subject: HOUSEHOLD, scenario: '', body: 'Arriving late Friday.' })
    )
  })

  it('removes the pending click-eater when the popover unmounts', () => {
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

describe('SubjectNotePopover — Escape acts on whatever has focus', () => {
  it('does nothing when focus is on a control outside it, leaving that control to handle Escape itself', () => {
    const outsideKeyDown = vi.fn()
    render(
      <SubjectNotesScope year={2026} sessionCmId={1000005} scenarioId="" scenarioName="" canManage>
        <div data-family-card className="group relative">
          <SubjectNoteCorner subject={HOUSEHOLD} label="Johnson" containing="padding" />
        </div>
        <input aria-label="Queue search" onKeyDown={outsideKeyDown} />
      </SubjectNotesScope>
    )
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    const outside = screen.getByRole('textbox', { name: 'Queue search' })
    outside.focus()
    fireEvent.keyDown(outside, { key: 'Escape' })

    expect(outsideKeyDown).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('typed')
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('still discards when focus is inside the popover', () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Note' }))
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('still discards when focus has moved to the body', () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('still discards when focus has landed on the note’s own corner (a second press on it can leave focus there, on some browsers)', () => {
    render(<Board />)
    openPopover()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    const cornerButton = document.querySelector('[data-note-corner] button') as HTMLElement
    cornerButton.focus()
    expect(document.activeElement).toBe(cornerButton)
    fireEvent.keyDown(cornerButton, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument()
    expect(saveNote).not.toHaveBeenCalled()
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
