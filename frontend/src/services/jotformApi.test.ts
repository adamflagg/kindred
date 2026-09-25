import { describe, expect, it, vi } from 'vitest'

import {
  fetchJotformForms,
  ignoreJotformSubmission,
  linkJotformSubmission,
  saveJotformForm,
  unlinkJotformSubmission,
} from './jotformApi'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('jotformApi', () => {
  it('reads the forms for a year through fetchWithAuth', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(json({ year: 2026, rows: [] }))
    await expect(fetchJotformForms(fetchWithAuth, 2026)).resolves.toEqual({ year: 2026, rows: [] })
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/jotform/forms?year=2026')
  })

  it('PUTs a form setting as JSON', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValue(json({ session_cm_id: 1000002, session_name: "Women's Weekend" }))
    await saveJotformForm(fetchWithAuth, 2026, 1000002, {
      form_ref: '261700000000001',
      field_map: { first_name: '3' },
      enabled: true,
    })
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/jotform/forms/1000002?year=2026')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      form_ref: '261700000000001',
      field_map: { first_name: '3' },
      enabled: true,
    })
  })

  it('surfaces the server detail on a refused save', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValue(json({ detail: "That link does not contain the form's ID." }, 422))
    await expect(
      saveJotformForm(fetchWithAuth, 2026, 1000002, {
        form_ref: 'x',
        field_map: {},
        enabled: false,
      })
    ).rejects.toThrow("That link does not contain the form's ID.")
  })

  it('posts link, ignore and unlink to the submission', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await linkJotformSubmission(fetchWithAuth, '6600000000000000001', 1000005)
    await ignoreJotformSubmission(fetchWithAuth, '6600000000000000001')
    await unlinkJotformSubmission(fetchWithAuth, '6600000000000000001')
    expect(fetchWithAuth.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['/api/jotform/submissions/6600000000000000001/link', 'POST'],
      ['/api/jotform/submissions/6600000000000000001/ignore', 'POST'],
      ['/api/jotform/submissions/6600000000000000001/unlink', 'POST'],
    ])
    expect(JSON.parse(String((fetchWithAuth.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      person_cm_id: 1000005,
    })
  })
})
