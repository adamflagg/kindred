/**
 * freshnessRun — which run a freshness line dates a job by.
 *
 * The status payload keeps a dry run in the job's slot so Manage > Sync can show it with its
 * chip, but a dry run wrote nothing: every "<noun> synced N ago" line must read the job's last
 * REAL run instead, which the backend attaches to a dry run's entry as `last_real_run`.
 */
import { describe, expect, it } from 'vitest'

import type { SyncStatus } from '../hooks/useSyncStatusAPI'
import { freshnessRun } from './syncFreshness'

const real: SyncStatus = { status: 'success', end_time: '2026-10-01T12:00:00Z' }

describe('freshnessRun', () => {
  it('answers a real run with the run itself', () => {
    expect(freshnessRun(real)).toBe(real)
  })

  it("answers a finished dry run with the job's last real run, never the dry run", () => {
    const dry: SyncStatus = {
      status: 'success',
      end_time: '2026-10-01T17:59:00Z',
      dry_run: true,
      last_real_run: real,
    }
    expect(freshnessRun(dry)).toBe(real)
  })

  it('answers a running dry run with the last real run too: it refreshes nothing', () => {
    expect(freshnessRun({ status: 'running', dry_run: true, last_real_run: real })).toBe(real)
  })

  it('answers nothing for a dry run with no real run on record', () => {
    expect(
      freshnessRun({ status: 'success', end_time: '2026-10-01T17:59:00Z', dry_run: true })
    ).toBeUndefined()
  })

  it('answers nothing for an absent job', () => {
    expect(freshnessRun(undefined)).toBeUndefined()
  })
})
