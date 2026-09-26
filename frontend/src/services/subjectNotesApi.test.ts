/**
 * The board-notes client must route through fetchWithAuth: the PocketBase JWT
 * lives in localStorage, so a raw fetch silently 401s (frontend/CLAUDE.md).
 * Fictional data throughout.
 */
import { describe, expect, it, vi } from 'vitest'

import { fetchSubjectNotes, promoteSubjectNote, saveSubjectNote } from './subjectNotesApi'

const SUBJECT = { kind: 'household' as const, cmId: 2000001, sessionCmId: 1000005 }

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('fetchSubjectNotes', () => {
  it('reads the board session and omits an empty scenario', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(ok({ notes: [] }))
    await fetchSubjectNotes(fetchWithAuth, { year: 2026, sessionCmId: 1000005, scenario: '' })
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/subject-notes?session_cm_id=1000005&year=2026')
  })

  it('names the scenario when there is one', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(ok({ notes: [] }))
    await fetchSubjectNotes(fetchWithAuth, {
      year: 2026,
      sessionCmId: 1000005,
      scenario: 'scn7x2k9qw3mnbv',
    })
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/subject-notes?session_cm_id=1000005&year=2026&scenario=scn7x2k9qw3mnbv'
    )
  })

  it('throws with the status when the response is not ok', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 422, json: async () => ({}) })
    await expect(
      fetchSubjectNotes(fetchWithAuth, { year: 2026, sessionCmId: 1000005, scenario: 'x' })
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('saveSubjectNote', () => {
  it('PUTs the snake-cased key and body', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(ok({ note: null, deleted: true }))
    await saveSubjectNote(fetchWithAuth, { subject: SUBJECT, year: 2026, scenario: '', body: '' })
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/subject-notes')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      subject_kind: 'household',
      subject_cm_id: 2000001,
      session_cm_id: 1000005,
      year: 2026,
      scenario: '',
      body: '',
    })
  })

  it('surfaces the server detail', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Scenario scnA belongs to a different session than 1000005' }),
    })
    await expect(
      saveSubjectNote(fetchWithAuth, { subject: SUBJECT, year: 2026, scenario: 'scnA', body: 'x' })
    ).rejects.toThrow('belongs to a different session')
  })
})

describe('promoteSubjectNote', () => {
  it('POSTs to /promote with the plan key', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(ok({ note: null, deleted: false }))
    await promoteSubjectNote(fetchWithAuth, { subject: SUBJECT, year: 2026, scenario: 'scnA' })
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/subject-notes/promote')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      scenario: 'scnA',
      subject_cm_id: 2000001,
    })
  })
})
