/**
 * Parity test: TypeScript evaluateRequest matches the shared JSON fixture.
 *
 * The fixture at bunking/satisfaction/test_fixtures/predicate_cases.json is
 * the single source of truth. The Python counterpart
 * (test_predicate_parity.py) loads the same file and asserts the same
 * expectations.
 *
 * For bunk_with and not_bunk_with cases, both expected_satisfied and
 * expected_detail are asserted. For age_preference cases, only
 * expected_satisfied is asserted — TS prefixes the detail with a bunk-grade
 * breakdown for drag-preview UX while Python returns the raw detail. This
 * divergence is intentional.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateRequest, type BunkmateInfo } from './satisfactionLookup'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'

interface FixtureCase {
  name: string
  request: {
    requester_id: number
    requestee_id?: number
    request_type: string
    age_preference_target?: string
    requester_grade?: number
  }
  person_to_bunk: Record<string, number>
  bunkmate_grades?: Record<string, number[]>
  expected_satisfied: boolean
  expected_detail?: string
}

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../bunking/satisfaction/test_fixtures/predicate_cases.json'
)
const cases: FixtureCase[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))

describe('evaluateRequest — fixture parity with Python evaluate_request', () => {
  it.each(cases)('$name', (c) => {
    const requesterBunkCmId = c.person_to_bunk[String(c.request.requester_id)] ?? null
    const targetBunkCmId =
      c.request.requestee_id != null
        ? (c.person_to_bunk[String(c.request.requestee_id)] ?? null)
        : null
    const requesterBunkmates: BunkmateInfo[] =
      c.bunkmate_grades != null
        ? (c.bunkmate_grades[String(c.request.requester_id)] ?? []).map((g, i) => ({
            cmId: 9000 + i,
            grade: g,
          }))
        : []

    const result = evaluateRequest({
      request: c.request as unknown as EnhancedBunkRequest,
      requesterBunkCmId,
      requesterBunkmates,
      targetBunkCmId,
      requesterGrade: c.request.requester_grade ?? null,
    })

    const tsSatisfied = result.status === 'satisfied'
    expect(tsSatisfied).toBe(c.expected_satisfied)
    if (c.expected_detail !== undefined) {
      expect(result.detail).toBe(c.expected_detail)
    }
  })
})
