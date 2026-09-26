import { act, render, renderHook, screen } from '@testing-library/react'
import { StrictMode, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HOUSEHOLD, PERSON, noteRow } from '../../test/notesScope'
import { useSubjectNotesScope } from './subjectNotesContext'
import { SubjectNotesScope } from './SubjectNotesScope'
import { useNoteSlots } from './useNoteSlots'

const notesSpy = vi.fn()
let notesData: { notes: Array<ReturnType<typeof noteRow>> } | undefined = { notes: [] }
let notesIsError = false
let notesError: unknown = null
const saveNote = vi.fn()
const promoteNote = vi.fn()
vi.mock('../../hooks/useSubjectNotes', () => ({
  // Mirrors the real helper's shape (hooks/useSubjectNotes.ts) closely enough
  // for these tests, without pulling the real query hooks into a mocked module.
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  useSubjectNotes: (args: unknown) => {
    notesSpy(args)
    return { data: notesData, isError: notesIsError, error: notesError }
  },
  useSaveSubjectNote: () => ({ mutateAsync: (...a: unknown[]) => saveNote(...a) }),
  usePromoteSubjectNote: () => ({ mutateAsync: (...a: unknown[]) => promoteNote(...a) }),
}))

const toastError = vi.fn()
vi.mock('react-hot-toast', () => {
  const stub = { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) }
  return { default: stub, toast: stub }
})

function scope(props: Partial<Parameters<typeof SubjectNotesScope>[0]> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SubjectNotesScope
        year={2026}
        sessionCmId={1000005}
        scenarioId="scnA"
        scenarioName="Draft A"
        canManage={true}
        {...props}
      >
        {children}
      </SubjectNotesScope>
    )
  }
}

beforeEach(() => {
  notesSpy.mockReset()
  saveNote.mockReset().mockResolvedValue({ note: null, deleted: false })
  promoteNote.mockReset().mockResolvedValue({ note: null, deleted: false })
  notesData = { notes: [] }
  notesIsError = false
  notesError = null
  toastError.mockReset()
})

describe('SubjectNotesScope', () => {
  it('reads nothing and provides nothing without bunking.manage', () => {
    const { result } = renderHook(() => useSubjectNotesScope(), {
      wrapper: scope({ canManage: false }),
    })
    expect(result.current).toBeNull()
    expect(notesSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('exposes nothing (corners, menu items, panel section) while the read is pending', () => {
    notesData = undefined
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    expect(result.current).toBeNull()
  })

  it('toasts once on a read error, and still exposes nothing', () => {
    notesData = undefined
    notesIsError = true
    notesError = new Error('the board could not be reached')
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    expect(result.current).toBeNull()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('could not be reached'),
      expect.objectContaining({ id: 'subject-notes-read' })
    )
  })

  it('passes a fixed id, so a StrictMode double effect run cannot double the toast', () => {
    notesData = undefined
    notesIsError = true
    notesError = new Error('the board could not be reached')
    const Wrapper = scope()
    render(
      <StrictMode>
        <Wrapper>
          <div />
        </Wrapper>
      </StrictMode>
    )
    expect(toastError).toHaveBeenCalled()
    const ids = toastError.mock.calls.map((call) => (call[1] as { id?: string } | undefined)?.id)
    expect(new Set(ids)).toEqual(new Set(['subject-notes-read']))
  })

  it('keeps its children mounted when the permission arrives (no remount)', () => {
    const mounted = vi.fn()
    function Child() {
      useEffect(() => {
        mounted()
      }, [])
      return <span>board</span>
    }
    const { rerender } = render(
      <SubjectNotesScope
        year={2026}
        sessionCmId={1000005}
        scenarioId=""
        scenarioName=""
        canManage={false}
      >
        <Child />
      </SubjectNotesScope>
    )
    rerender(
      <SubjectNotesScope
        year={2026}
        sessionCmId={1000005}
        scenarioId=""
        scenarioName=""
        canManage={true}
      >
        <Child />
      </SubjectNotesScope>
    )
    expect(screen.getByText('board')).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1) // a remount would run the mount effect again
  })

  it('indexes the board read by subject', () => {
    notesData = {
      notes: [
        noteRow(HOUSEHOLD, 'Grandma comes Saturday.'),
        noteRow(HOUSEHOLD, 'Try Pine', 'scnA'),
      ],
    }
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    expect(result.current?.notesFor(HOUSEHOLD).standard?.body).toBe('Grandma comes Saturday.')
    expect(result.current?.notesFor(HOUSEHOLD).plan?.body).toBe('Try Pine')
    expect(result.current?.notesFor(PERSON)).toEqual({})
  })

  it('saves the standard layer with no scenario and the plan layer with the editor’s scenario', async () => {
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    await act(() => result.current!.save(HOUSEHOLD, { standard: 'A', plan: 'B' }, 'scnA'))
    expect(saveNote.mock.calls.map((c) => [c[0].scenario, c[0].body])).toEqual([
      ['', 'A'],
      ['scnA', 'B'],
    ])
  })

  it('never writes a plan layer from the live view', async () => {
    const { result } = renderHook(() => useSubjectNotesScope(), {
      wrapper: scope({ scenarioId: '' }),
    })
    await act(() => result.current!.save(HOUSEHOLD, { plan: 'B' }, ''))
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('promote saves dirty layers first, then promotes', async () => {
    const order: string[] = []
    saveNote.mockImplementation(async () => order.push('save'))
    promoteNote.mockImplementation(async () => order.push('promote'))
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    await act(() => result.current!.promote(HOUSEHOLD, { plan: 'Try Pine' }, 'scnA'))
    expect(order).toEqual(['save', 'promote'])
    expect(promoteNote).toHaveBeenCalledWith({ subject: HOUSEHOLD, year: 2026, scenario: 'scnA' })
  })

  it('stamps the open editor with the scenario it was opened in, and closes it when the scenario changes', () => {
    let scenarioId = 'scnA'
    const { result, rerender } = renderHook(() => useSubjectNotesScope(), {
      wrapper: ({ children }) => scope({ scenarioId })({ children }),
    })
    act(() =>
      result.current!.openEditor({
        subject: PERSON,
        label: 'Emma Johnson',
        surface: 'panel',
        anchorEl: null,
      })
    )
    expect(result.current?.editor?.scenarioId).toBe('scnA')
    scenarioId = 'scnB'
    rerender()
    expect(result.current?.editor).toBeNull()
  })

  it('also closes the open editor when the board SESSION changes, same scenario', () => {
    let sessionCmId = 1000005
    const { result, rerender } = renderHook(() => useSubjectNotesScope(), {
      wrapper: ({ children }) => scope({ sessionCmId })({ children }),
    })
    act(() =>
      result.current!.openEditor({
        subject: PERSON,
        label: 'Emma Johnson',
        surface: 'panel',
        anchorEl: null,
      })
    )
    expect(result.current?.editor).not.toBeNull()
    sessionCmId = 1000006
    rerender()
    expect(result.current?.editor).toBeNull()
  })

  it('also closes the open editor when the board YEAR changes, same session id and live view', () => {
    // CampMinder reuses session ids across years, so a year switch on the
    // live view (scenario '') leaves the session id and scenario unchanged.
    let year = 2026
    const { result, rerender } = renderHook(() => useSubjectNotesScope(), {
      wrapper: ({ children }) => scope({ year, scenarioId: '' })({ children }),
    })
    act(() =>
      result.current!.openEditor({
        subject: PERSON,
        label: 'Emma Johnson',
        surface: 'panel',
        anchorEl: null,
      })
    )
    expect(result.current?.editor).not.toBeNull()
    year = 2025
    rerender()
    expect(result.current?.editor).toBeNull()
  })

  it('closeEditor(target) ignores a target that is no longer open', () => {
    const { result } = renderHook(() => useSubjectNotesScope(), { wrapper: scope() })
    act(() =>
      result.current!.openEditor({
        subject: PERSON,
        label: 'Emma Johnson',
        surface: 'panel',
        anchorEl: null,
      })
    )
    const stale = result.current!.editor!
    act(() =>
      result.current!.openEditor({
        subject: HOUSEHOLD,
        label: 'Johnson',
        surface: 'panel',
        anchorEl: null,
      })
    )
    act(() => result.current!.closeEditor(stale))
    expect(result.current?.editor?.subject).toEqual(HOUSEHOLD)
  })
})

describe('useNoteSlots', () => {
  it('returns nothing without the scope, or for a subject-less party', () => {
    const bare = renderHook(() => useNoteSlots('family'))
    expect(bare.result.current(HOUSEHOLD, 'Johnson')).toBeUndefined()
    const scoped = renderHook(() => useNoteSlots('family'), { wrapper: scope() })
    expect(scoped.result.current(null, 'Johnson')).toBeUndefined()
  })

  it('hands a memo’d card the SAME slots object across renders and note changes', () => {
    const { result, rerender } = renderHook(() => useNoteSlots('family'), { wrapper: scope() })
    const fn = result.current
    const first = fn(HOUSEHOLD, 'Johnson')
    notesData = { notes: [noteRow(HOUSEHOLD, 'Now it has a note')] }
    rerender()
    expect(result.current).toBe(fn)
    expect(result.current(HOUSEHOLD, 'Johnson')).toBe(first)
    expect(first?.corner).toBeTruthy()
  })
})
