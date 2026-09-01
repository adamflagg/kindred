/**
 * The attribution queue's occupancy evidence, reduced to what the row draws.
 *
 * Pure over the endpoint's payload, so the wire shape's traps are pinned here
 * rather than inside a rendered component: every field on
 * `SessionAttributionConflictsResponse` is OPTIONAL in TypeScript (Pydantic
 * defaults render that way), so a reader that trusts one to be present breaks
 * on a row the server filled in perfectly.
 */
import { describe, expect, it } from 'vitest'

import type { SessionAttributionConflicts } from '../../../types/lodging'
import { occupantClause, rowEvidenceByIssueId } from './attributionEvidence'

function response(over: Partial<SessionAttributionConflicts> = {}): SessionAttributionConflicts {
  return {
    year: 2026,
    rows: [
      {
        issue_id: 'q1',
        raw_value: 'Health Center - Upstairs 1',
        resolved_unit_names: ['HC Upstairs 1'],
        candidates: [
          {
            session_cm_id: 1309514,
            session_name: 'Family Camp 1: Memorial Day',
            verdict: 'conflict',
            occupants: [
              {
                kind: 'placement',
                label: 'The Garcia Family',
                leaf_code: 'HC-UP-1',
                leaf_name: 'HC Upstairs 1',
                container_name: '',
              },
            ],
          },
          {
            session_cm_id: 1309515,
            session_name: 'Family Camp 2: Keshet',
            verdict: 'free',
            occupants: [],
          },
        ],
        conflict_in_every_candidate: false,
        timestamp_suggested_session_cm_id: 1309514,
        conflict_aware_suggested_session_cm_id: 1309515,
        demotion_applied: true,
      },
    ],
    ...over,
  }
}

describe('rowEvidenceByIssueId', () => {
  it('keys every row by its issue id, so a queue row finds its own evidence', () => {
    const evidence = rowEvidenceByIssueId(response())
    expect([...evidence.keys()]).toEqual(['q1'])
  })

  it('carries BOTH suggestions — the conflict-aware pick and the stored date-heuristic one', () => {
    // Publishing only the conflict-aware answer would make the UI silently
    // disagree with the row PocketBase stores. Both is what lets it say
    // "FC2, because FC1 is taken".
    const row = rowEvidenceByIssueId(response()).get('q1')
    expect(row?.suggestedSessionCmId).toBe(1309515)
    expect(row?.timestampSessionCmId).toBe(1309514)
    expect(row?.demotionApplied).toBe(true)
  })

  it('carries each candidate weekend’s verdict and its occupants', () => {
    const row = rowEvidenceByIssueId(response()).get('q1')
    expect(row?.byCandidate.get(1309514)?.verdict).toBe('conflict')
    expect(row?.byCandidate.get(1309514)?.occupants).toEqual([
      {
        kind: 'placement',
        label: 'The Garcia Family',
        leafName: 'HC Upstairs 1',
        containerName: '',
      },
    ])
    expect(row?.byCandidate.get(1309515)?.verdict).toBe('free')
  })

  it('reads a row whose optional fields all arrive absent, rather than throwing', () => {
    // Every field on the generated type is optional; a row with nothing but
    // an id is what a future writer, or a validation-error path, produces.
    const evidence = rowEvidenceByIssueId({ rows: [{ issue_id: 'q2' }] })
    const row = evidence.get('q2')
    expect(row?.byCandidate.size).toBe(0)
    expect(row?.suggestedSessionCmId).toBeUndefined()
    expect(row?.timestampSessionCmId).toBeUndefined()
    expect(row?.demotionApplied).toBe(false)
    expect(row?.conflictInEveryCandidate).toBe(false)
  })

  it('drops a row with no issue id — it can never be matched to a queue row', () => {
    expect(rowEvidenceByIssueId({ rows: [{ issue_id: '' }, { raw_value: 'Ridge K' }] }).size).toBe(
      0
    )
  })

  it('drops a candidate with no session id, rather than filing it under weekend 0', () => {
    // The same reasoning as the issue-id guard above, one level down. `?? 0`
    // would file every unidentifiable candidate under one key, so the second
    // shadows the first and either could be handed to a real candidate that
    // happens to carry cm_id 0. A candidate the payload cannot name is a
    // candidate no card can ask for.
    const evidence = rowEvidenceByIssueId({
      rows: [
        {
          issue_id: 'q3',
          candidates: [
            { verdict: 'conflict' },
            { verdict: 'free' },
            { session_cm_id: 1309515, verdict: 'no_data' },
          ],
        },
      ],
    })
    const row = evidence.get('q3')
    expect(row?.byCandidate.size).toBe(1)
    expect(row?.byCandidate.get(0)).toBeUndefined()
    expect(row?.byCandidate.get(1309515)?.verdict).toBe('no_data')
  })

  it('answers an empty map for an unfetched or failed response, so the row degrades', () => {
    expect(rowEvidenceByIssueId(undefined).size).toBe(0)
    expect(rowEvidenceByIssueId({}).size).toBe(0)
  })

  it('maps a null suggestion to undefined — the rule declining to answer is not id 0', () => {
    const evidence = rowEvidenceByIssueId({
      rows: [
        {
          issue_id: 'q3',
          timestamp_suggested_session_cm_id: null,
          conflict_aware_suggested_session_cm_id: null,
        },
      ],
    })
    expect(evidence.get('q3')?.suggestedSessionCmId).toBeUndefined()
    expect(evidence.get('q3')?.timestampSessionCmId).toBeUndefined()
  })
})

describe('occupantClause', () => {
  it('names a placement and the leaf it sits in', () => {
    expect(
      occupantClause({
        kind: 'placement',
        label: 'The Garcia Family',
        leafName: 'HC Upstairs 1',
        containerName: '',
      })
    ).toBe('a placement for The Garcia Family in HC Upstairs 1')
  })

  it('calls a write-in a write-in — ruling 4, write-ins count as occupancy', () => {
    expect(
      occupantClause({
        kind: 'write_in',
        label: 'Staff hold',
        leafName: 'Ridge K',
        containerName: '',
      })
    ).toBe('a write-in for Staff hold in Ridge K')
  })

  it('says a leaf is a room inside the building the CampMinder value named', () => {
    expect(
      occupantClause({
        kind: 'placement',
        label: 'The Chen Family',
        leafName: 'Clouds Rest Loft',
        containerName: 'Clouds Rest',
      })
    ).toBe('a placement for The Chen Family in Clouds Rest Loft — a room inside Clouds Rest')
  })
})
