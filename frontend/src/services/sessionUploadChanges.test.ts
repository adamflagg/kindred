import { describe, it, expect, vi } from 'vitest'
import { fetchSessionUploadChanges, type UploadChangeRow } from './sessionUploadChanges'

describe('fetchSessionUploadChanges', () => {
  it('filters by run_id and all session cm_ids', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            requester_cm_id: 1,
            requester_name: 'Emma Johnson',
            target_name: 'Olivia Chen',
            request_type: 'bunk_with',
            final_status: 'resolved',
            session_cm_id: 1000001,
          },
        ],
      }),
    })
    const rows: UploadChangeRow[] = await fetchSessionUploadChanges(
      'r1',
      [1000001, 1000099],
      fetchWithAuth
    )
    const call = fetchWithAuth.mock.calls[0]
    const url = decodeURIComponent((call?.[0] ?? '') as string)
    expect(url).toContain("run_id = 'r1'")
    expect(url).toContain('session_cm_id = 1000001')
    expect(url).toContain('session_cm_id = 1000099')
    expect(rows[0]?.requester_name).toBe('Emma Johnson')
  })

  it('returns [] for empty sessionCmIds (no query)', async () => {
    const fetchWithAuth = vi.fn()
    expect(await fetchSessionUploadChanges('r1', [], fetchWithAuth)).toEqual([])
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  it('returns [] on non-ok response', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: false })
    expect(await fetchSessionUploadChanges('r1', [1000001], fetchWithAuth)).toEqual([])
  })
})
