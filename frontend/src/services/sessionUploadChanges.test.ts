import { describe, it, expect, vi } from 'vitest'
import {
  fetchSessionUploadChanges,
  countsFromUploadChangeRows,
  type UploadChangeRow,
} from './sessionUploadChanges'

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

// kindred#1713 Part 1: the "new" chip must count these rows (one per final
// bunk_request), not traces (one per form-field row, which can fan out into
// several of these rows — a note naming three friends is one trace but three
// rows here).
describe('countsFromUploadChangeRows', () => {
  const row = (final_status: string): UploadChangeRow => ({
    requester_cm_id: 1,
    requester_name: 'Emma Johnson',
    target_name: 'Olivia Chen',
    request_type: 'bunk_with',
    final_status,
    session_cm_id: 1000001,
  })

  it('counts one per row, not one per camper — a camper with 3 rows counts as 3', () => {
    const rows = [row('RESOLVED'), row('RESOLVED'), row('DECLINED')]
    expect(countsFromUploadChangeRows(rows)).toEqual({ total: 3, autoMatched: 3, needReview: 0 })
  })

  it('treats PENDING (case-insensitive) as needReview and everything else as autoMatched', () => {
    const rows = [row('pending'), row('RESOLVED'), row('DECLINED'), row('SKIPPED'), row('DEDUPED')]
    expect(countsFromUploadChangeRows(rows)).toEqual({ total: 5, autoMatched: 4, needReview: 1 })
  })

  it('returns all-zero counts for an empty row list', () => {
    expect(countsFromUploadChangeRows([])).toEqual({ total: 0, autoMatched: 0, needReview: 0 })
  })
})
