import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import { HOUSEHOLD, NotesScopeFixture, noteRow, scopeValue } from '../../test/notesScope'
import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { SubjectNotesSection } from './SubjectNotesSection'

/** A promise this test can resolve on its own schedule, to pin the "second
 * call while one is still in flight" races. */
function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const panelTarget: EditorTarget = {
  subject: HOUSEHOLD,
  label: 'Johnson',
  surface: 'panel',
  anchorEl: null,
  scenarioId: '',
}

function Panel({
  value,
  onPanelEscape = vi.fn(),
}: {
  value: SubjectNotesScopeValue
  onPanelEscape?: () => void
}) {
  useOverlayEscape(true, onPanelEscape)
  return (
    <NotesScopeFixture value={value}>
      <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
    </NotesScopeFixture>
  )
}

describe('SubjectNotesSection — reading', () => {
  it('is absent until a note exists (the card corner adds the first one)', () => {
    const { container } = render(<Panel value={scopeValue()} />)
    expect(container.querySelector('[data-notes-section]')).toBeNull()
  })

  it('is absent for a viewer without bunking.manage', () => {
    const { container } = render(
      <NotesScopeFixture value={null}>
        <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
      </NotesScopeFixture>
    )
    expect(container.querySelector('[data-notes-section]')).toBeNull()
  })

  it('shows the standard note with no pill, and the plan-only note under its Draft pill', () => {
    render(
      <Panel
        value={scopeValue(
          [noteRow(HOUSEHOLD, 'Grandma comes Saturday.'), noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
          {
            scenarioId: 'scnA',
            scenarioName: 'Draft A',
          }
        )}
      />
    )
    expect(screen.getByRole('heading', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByText('Grandma comes Saturday.').closest('button')).not.toHaveTextContent(
      'Draft A'
    )
    expect(screen.getByText('Try Pine').closest('button')).toHaveTextContent('Draft A')
  })

  it('edits in place: the standard block opens the panel editor; the plan block asks for the plan box', () => {
    const value = scopeValue(
      [noteRow(HOUSEHOLD, 'Grandma comes Saturday.'), noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
      {
        scenarioId: 'scnA',
        scenarioName: 'Draft A',
      }
    )
    render(<Panel value={value} />)
    fireEvent.click(screen.getByText('Grandma comes Saturday.'))
    expect(value.openEditor).toHaveBeenLastCalledWith({
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
    })
    fireEvent.click(screen.getByText('Try Pine'))
    expect(value.openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ want: 'plan' }))
  })

  it('offers the missing layer: "+ Add note for all plans" and "+ Note just for ‹scenario›"', () => {
    render(
      <Panel
        value={scopeValue([noteRow(HOUSEHOLD, 'Try Pine', 'scnA')], {
          scenarioId: 'scnA',
          scenarioName: 'Draft A',
        })}
      />
    )
    expect(screen.getByRole('button', { name: '+ Add note for all plans' })).toBeInTheDocument()
    render(
      <Panel
        value={scopeValue([noteRow(HOUSEHOLD, 'Standard')], {
          scenarioId: 'scnA',
          scenarioName: 'Draft A',
        })}
      />
    )
    expect(screen.getByRole('button', { name: '+ Note just for Draft A' })).toBeInTheDocument()
  })
})

describe('SubjectNotesSection — editing', () => {
  it('remounts the panel editor when the same subject reopens in a different scenario, flushing the stale draft into the OLD scenario', async () => {
    const scnA: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnA',
    }
    const scnB: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnB',
    }
    const valueA = scopeValue([noteRow(HOUSEHOLD, 'Plan A', 'scnA')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
      editor: scnA,
    })
    const { rerender } = render(<Panel value={valueA} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'typed in A, unsaved' },
    })

    const valueB = scopeValue([noteRow(HOUSEHOLD, 'Plan B', 'scnB')], {
      scenarioId: 'scnB',
      scenarioName: 'Draft B',
      editor: scnB,
    })
    rerender(<Panel value={valueB} />)
    await act(async () => {
      await Promise.resolve()
    })

    // The OLD instance (scnA) unmounted under the key change and flushed its
    // own dirty draft -- stamped to the scenario it was opened in, never to
    // the scope's now-current one. It is saved, not discarded.
    expect(valueA.save).toHaveBeenCalledWith(HOUSEHOLD, { plan: 'typed in A, unsaved' }, 'scnA')
    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveValue('Plan B')
  })

  it('a save attempted while "Keep on all plans" is in flight is refused without unsettling the editor, so the unmount flush does not write again', async () => {
    const target: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnA',
    }
    const { promise, resolve } = deferred()
    const value = scopeValue(
      [noteRow(HOUSEHOLD, 'Standard'), noteRow(HOUSEHOLD, 'Plan A', 'scnA')],
      {
        scenarioId: 'scnA',
        scenarioName: 'Draft A',
        editor: target,
        promote: vi.fn().mockReturnValue(promise),
      }
    )
    const { unmount } = render(<Panel value={value} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'Plan A, revised' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Keep on all plans' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), {
      key: 'Enter',
      ctrlKey: true,
    })
    await act(async () => {
      await Promise.resolve()
    })

    resolve()
    await act(async () => {
      await promise
    })

    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(value.save).not.toHaveBeenCalled()
  })

  it('a second save (Ctrl+Enter) attempted while the first Save is in flight is refused, so the unmount flush does not write twice', async () => {
    // The Save BUTTON is `disabled={model.busy}`, so jsdom (matching real
    // browsers) drops a second literal button click outright -- that would
    // never reach the race this pins. Ctrl+Enter goes through the editor's
    // root `onKeyDown`, which has no busy gate of its own, so it is the one
    // path that can actually land a second concurrent `save()` call.
    const target: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: '',
    }
    const { promise, resolve } = deferred()
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], {
      editor: target,
      save: vi.fn().mockReturnValue(promise),
    })
    const { unmount } = render(<Panel value={value} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Standard, revised' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), {
      key: 'Enter',
      ctrlKey: true,
    })
    await act(async () => {
      await Promise.resolve()
    })

    resolve()
    await act(async () => {
      await promise
    })

    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(value.save).toHaveBeenCalledTimes(1)
  })

  it('resets the editor after a failed promote, so a later edit still flushes on unmount instead of being dropped', async () => {
    const target: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnA',
    }
    const value = scopeValue(
      [noteRow(HOUSEHOLD, 'Standard'), noteRow(HOUSEHOLD, 'Plan A', 'scnA')],
      {
        scenarioId: 'scnA',
        scenarioName: 'Draft A',
        editor: target,
        promote: vi.fn().mockRejectedValue(new Error('too long')),
      }
    )
    const { unmount } = render(<Panel value={value} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep on all plans' }))
    })

    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'Plan A, edited after the failed promote' },
    })

    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(value.save).toHaveBeenCalledWith(
      HOUSEHOLD,
      { plan: 'Plan A, edited after the failed promote' },
      'scnA'
    )
  })

  it('tolerates StrictMode double-invoke without flushing a live edit', async () => {
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor: panelTarget })
    render(
      <StrictMode>
        <Panel value={value} />
      </StrictMode>
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(value.closeEditor).not.toHaveBeenCalled()
    expect(value.save).not.toHaveBeenCalled()
  })

  it('Escape reverts the edit BEFORE the panel’s own Escape closes the panel', () => {
    const onPanelEscape = vi.fn()
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')])
    const { rerender } = render(<Panel value={value} onPanelEscape={onPanelEscape} />)
    // Editing starts in a LATER commit than the panel's own mount, as in the app.
    const editing = { ...value, editor: panelTarget }
    rerender(<Panel value={editing} onPanelEscape={onPanelEscape} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(editing.closeEditor).toHaveBeenCalledWith(panelTarget)
    expect(onPanelEscape).not.toHaveBeenCalled()
    expect(editing.save).not.toHaveBeenCalled()
  })

  it('flushes a pending edit when the panel closes under it', async () => {
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor: panelTarget })
    const { unmount } = render(<Panel value={value} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Standard, and more' },
    })
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(value.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: 'Standard, and more' }, '')
  })

  it('steals nothing and does not throw after the real open gesture (the read-view button is already gone by the time it mounts)', () => {
    function Harness({ editor }: { editor: EditorTarget | null }) {
      return (
        <NotesScopeFixture value={scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor })}>
          <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
        </NotesScopeFixture>
      )
    }
    const { rerender } = render(<Harness editor={null} />)
    const noteButton = screen.getByText('Standard').closest('button') as HTMLElement
    noteButton.focus()

    // The real gesture: a click on this SAME button both opens the editor
    // and removes this button, in one commit -- a rerender is the fixture's
    // way of landing both at once, exactly as a real state update would.
    expect(() => {
      rerender(<Harness editor={panelTarget} />)
    }).not.toThrow()
    // The editor's own textarea autofocuses -- unrelated to our restore
    // effect, whose captured element is already `document.body` by now.
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()

    expect(() => {
      rerender(<Harness editor={null} />)
    }).not.toThrow()
    // Nothing was ever captured to restore, so nothing is stolen -- focus is
    // simply wherever the textarea's own removal left it.
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus where it is when closing, if the user has since moved it elsewhere', () => {
    function Harness({ showEditor }: { showEditor: boolean }) {
      return (
        <>
          <button type="button">Elsewhere 1</button>
          <button type="button">Elsewhere 2</button>
          <NotesScopeFixture
            value={scopeValue([noteRow(HOUSEHOLD, 'Standard')], {
              editor: showEditor ? panelTarget : null,
            })}
          >
            <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
          </NotesScopeFixture>
        </>
      )
    }
    const { rerender } = render(<Harness showEditor={false} />)
    const elsewhere1 = screen.getByRole('button', { name: 'Elsewhere 1' })
    const elsewhere2 = screen.getByRole('button', { name: 'Elsewhere 2' })
    elsewhere1.focus()

    // The editor opens while `elsewhere1` (a real, unrelated control) holds
    // focus -- captured as this instance's `previouslyFocused`.
    rerender(<Harness showEditor />)
    // The user clicks away to something else entirely WHILE the editor is
    // still open, before it closes.
    elsewhere2.focus()

    rerender(<Harness showEditor={false} />)
    // Not restored to `elsewhere1`: focus is neither on `document.body` nor
    // inside this section by the time it closes.
    expect(document.activeElement).toBe(elsewhere2)
  })

  it('closes a clean editor when the panel closes, so it does not reopen stale', async () => {
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor: panelTarget })
    const { unmount } = render(<Panel value={value} />)
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(value.save).not.toHaveBeenCalled()
    expect(value.closeEditor).toHaveBeenCalledWith(panelTarget)
  })
})
